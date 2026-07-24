import mqtt, { IClientOptions, MqttClient } from "mqtt";
import { AppRepositories } from "./repositories";
import { ConsumerSessionRow } from "./types";
import { topicMatches, validatePublishTopic } from "./topic";
import { createId, safeJsonParse } from "./utils";
import { ResolvedTemplate } from "./template";

export type RealtimeEvent =
  | { type: "log.created"; payload: unknown }
  | { type: "consumer.updated"; payload: unknown }
  | { type: "consumer.message"; payload: unknown }
  | { type: "broker.status"; payload: unknown };

export type PublishOptions = { qos: number; retain: boolean };

const BROKER_CONNECTION_TIMEOUT_MS = 10_000;
const BROKER_CONNECTION_ERROR = "Unable to connect to MQTT broker";

export type BrokerConnectionConfig = {
  host: string;
  port: number;
  protocol: string;
  validateCertificate?: boolean | number | undefined;
  encryption?: boolean | number | undefined;
  username?: string | null | undefined;
  password?: string | null | undefined;
  clientId?: string | undefined;
  clean?: boolean | number | undefined;
  keepAlive?: number | undefined;
  reconnectPeriod?: number | undefined;
  caCert?: string | null | undefined;
  clientCert?: string | null | undefined;
  clientKey?: string | null | undefined;
};

type ActiveBroker = {
  client: MqttClient;
  ready: Promise<void>;
  subscriptions: Set<string>;
  refCount: number;
  connected: boolean;
  lastError: string | null;
};

type ActiveConsumer = {
  id: string;
  name: string;
  brokerProfileId: string;
  topics: string[];
  qos: number;
};

function brokerErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message.trim()) return error.message;
  if (error && typeof error === "object") {
    const details = error as { message?: unknown; code?: unknown; syscall?: unknown; address?: unknown; port?: unknown };
    if (typeof details.message === "string" && details.message.trim()) return details.message;
    const context = [details.code, details.syscall, details.address, details.port].filter(Boolean).join(" ");
    if (context) return context;
  }
  return fallback;
}

export interface BrokerConnectionStatus {
  profileId: string;
  connected: boolean;
  refCount: number;
  lastError: string | null;
}

export class RuntimeService {
  private readonly brokers = new Map<string, ActiveBroker>();
  private readonly consumers = new Map<string, ActiveConsumer>();

  constructor(private readonly repositories: AppRepositories, private readonly broadcast: (event: RealtimeEvent) => void) {}

  async snapshotConsumers() { return this.repositories.listSessions(); }

  listBrokerStatuses(): BrokerConnectionStatus[] {
    return Array.from(this.brokers.entries()).map(([profileId, broker]) => ({ profileId, connected: broker.connected, refCount: broker.refCount, lastError: broker.lastError }));
  }

  async connectBroker(profileId: string) { await this.ensureBroker(profileId); return this.getBrokerStatus(profileId); }

  async testBrokerConnection(profileId: string) {
    const profile = await this.repositories.getBroker(profileId);
    if (!profile) throw new Error(`Broker profile ${profileId} not found`);
    return this.testBrokerConfig(profile);
  }

  async testBrokerConfig(config: BrokerConnectionConfig) {
    const client = this.createBrokerClient(config);
    try {
      await this.awaitBrokerConnection(client);
      return { ok: true };
    } finally {
      client.end(true);
    }
  }

  async disconnectBroker(profileId: string) {
    const broker = this.brokers.get(profileId);
    if (!broker) return null;
    for (const [sessionId, consumer] of this.consumers.entries()) {
      if (consumer.brokerProfileId === profileId) {
        this.consumers.delete(sessionId);
        const session = await this.repositories.getSession(sessionId);
        if (session) await this.repositories.saveSession({ ...session, topics: [], active: 0 });
      }
    }
    broker.subscriptions.clear(); broker.client.end(true); this.brokers.delete(profileId);
    this.broadcast({ type: "broker.status", payload: { profileId, status: "disconnected" } });
    return this.getBrokerStatus(profileId);
  }

  getBrokerStatus(profileId: string): BrokerConnectionStatus { const broker = this.brokers.get(profileId); return { profileId, connected: Boolean(broker?.connected), refCount: broker?.refCount ?? 0, lastError: broker?.lastError ?? null }; }

  private buildOptionsFromConnection(profile: BrokerConnectionConfig): IClientOptions {
    const options: IClientOptions = { clientId: profile.clientId ?? "mqtt-postwoman-temp", clean: Boolean(profile.clean ?? true), keepalive: profile.keepAlive ?? 30, reconnectPeriod: profile.reconnectPeriod ?? 1000, connectTimeout: BROKER_CONNECTION_TIMEOUT_MS };
    if (profile.username) options.username = profile.username;
    if (profile.password) options.password = profile.password;
    if (this.isEncrypted(profile)) {
      options.protocol = profile.protocol === "ws" || profile.protocol === "wss" ? "wss" : "mqtts";
      options.rejectUnauthorized = Boolean(profile.validateCertificate ?? true);
      if (profile.caCert) options.ca = profile.caCert;
      if (profile.clientCert) options.cert = profile.clientCert;
      if (profile.clientKey) options.key = profile.clientKey;
    }
    return options;
  }

  private isEncrypted(profile: BrokerConnectionConfig) { return Boolean(profile.encryption) || profile.protocol === "mqtts" || profile.protocol === "wss"; }
  private transportProtocol(profile: BrokerConnectionConfig) { const protocol = profile.protocol.replace("://", ""); if (this.isEncrypted(profile)) return protocol === "ws" || protocol === "wss" ? "wss" : "mqtts"; return protocol === "ws" ? "ws" : "mqtt"; }
  private connectionUrl(profile: BrokerConnectionConfig) { return `${this.transportProtocol(profile)}://${profile.host}:${profile.port}`; }
  private createBrokerClient(profile: BrokerConnectionConfig) { return mqtt.connect(this.connectionUrl(profile), this.buildOptionsFromConnection(profile)); }

  private awaitBrokerConnection(client: MqttClient) {
    return new Promise<void>((resolve, reject) => {
      let settled = false;
      const finish = (handler: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        handler();
      };
      const timeout = setTimeout(
        () => finish(() => reject(new Error("MQTT connection timed out after 10 seconds"))),
        BROKER_CONNECTION_TIMEOUT_MS,
      );
      client.once("connect", () => finish(resolve));
      client.once("error", (error) => finish(() => reject(new Error(brokerErrorMessage(error, BROKER_CONNECTION_ERROR)))));
      client.once("close", () => finish(() => reject(new Error("MQTT connection closed before it was established"))));
    });
  }

  private async ensureBroker(profileId: string) {
    const profile = await this.repositories.getBroker(profileId);
    if (!profile) throw new Error(`Broker profile ${profileId} not found`);
    const existing = this.brokers.get(profileId);
    if (existing) {
      if (!existing.connected) { this.brokers.delete(profileId); existing.client.end(true); }
      else { existing.refCount += 1; await existing.ready; return existing; }
    }
    const client = this.createBrokerClient(profile);
    const broker: ActiveBroker = { client, ready: Promise.resolve(), subscriptions: new Set<string>(), refCount: 1, connected: false, lastError: null };
    broker.ready = this.awaitBrokerConnection(client)
      .then(() => {
        broker.connected = true;
        broker.lastError = null;
        this.broadcast({ type: "broker.status", payload: { profileId, status: "connected" } });
      })
      .catch((error: unknown) => {
        const message = brokerErrorMessage(error, BROKER_CONNECTION_ERROR);
        broker.lastError = message;
        this.broadcast({ type: "broker.status", payload: { profileId, status: "error", error: message } });
        throw new Error(message);
      });
    client.on("reconnect", () => this.broadcast({ type: "broker.status", payload: { profileId, status: "reconnecting" } }));
    client.on("close", () => { broker.connected = false; this.broadcast({ type: "broker.status", payload: { profileId, status: "closed" } }); });
    client.on("message", (topic, message, packet) => { void this.handleIncomingMessage(profileId, topic, message, packet?.messageId?.toString() ?? null); });
    this.brokers.set(profileId, broker);
    try { await broker.ready; } catch (error) { if (this.brokers.get(profileId) === broker) this.brokers.delete(profileId); broker.client.end(true); throw error; }
    return broker;
  }

  async publish(profileId: string, topic: string, payload: ResolvedTemplate, options: PublishOptions, requestId?: string | null, variables: Record<string, unknown> = {}) {
    validatePublishTopic(topic); await this.ensureBroker(profileId); const broker = this.brokers.get(profileId); if (!broker) throw new Error("Broker connection unavailable");
    await new Promise<void>((resolve, reject) => { broker.client.publish(topic, payload.text, { qos: options.qos as 0 | 1 | 2, retain: options.retain }, (error?: Error) => error ? reject(error) : resolve()); });
    const log = await this.repositories.addLog({ direction: "publish", topic, payloadText: payload.text, payloadJson: payload.json === null ? null : JSON.stringify(payload.json), status: "ok", error: null, brokerProfileId: profileId, requestId: requestId ?? null, consumerSessionId: null, messageKey: createId(), createdAt: new Date().toISOString() });
    this.broadcast({ type: "log.created", payload: log }); return { ok: true, log, variables };
  }

  async batchPublish(profileId: string, items: Array<{ topic: string; payload: ResolvedTemplate }>, options: PublishOptions, requestId?: string | null, delayMs = 0) { const results = []; for (const item of items) { results.push(await this.publish(profileId, item.topic, item.payload, options, requestId)); if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs)); } return results; }

  async startConsumer(input: { name: string; brokerProfileId: string; topics: string[]; qos?: number }) {
    if (!(await this.repositories.getBroker(input.brokerProfileId))) throw new Error("Broker profile not found");
    const uniqueTopics = [...new Set(input.topics.map((topic) => topic.trim()).filter(Boolean))];
    if (uniqueTopics.length !== input.topics.length) throw new Error("Topic already subscribed in this request");
    const existing = (await this.repositories.listSessions()).find((session) => session.name === input.name && session.brokerProfileId === input.brokerProfileId);
    const currentTopics = existing ? JSON.parse(existing.topicsJson) as string[] : [];
    const duplicateTopics = uniqueTopics.filter((topic) => currentTopics.includes(topic));
    if (duplicateTopics.length) throw new Error(`Topic already subscribed: ${duplicateTopics.join(", ")}`);
    const session = await this.repositories.saveSession({ ...(existing ?? {}), name: input.name, brokerProfileId: input.brokerProfileId, topics: [...currentTopics, ...uniqueTopics], qos: input.qos ?? existing?.qos ?? 0, active: 1 });
    await this.ensureBroker(input.brokerProfileId);
    const activeBroker = this.brokers.get(input.brokerProfileId); if (!activeBroker) throw new Error("Broker connection unavailable");
    this.consumers.set(session.id, { id: session.id, name: session.name, brokerProfileId: session.brokerProfileId, topics: JSON.parse(session.topicsJson) as string[], qos: session.qos });
    for (const topic of uniqueTopics) if (!activeBroker.subscriptions.has(topic)) await new Promise<void>((resolve, reject) => activeBroker.client.subscribe(topic, { qos: (input.qos ?? 0) as 0 | 1 | 2 }, (error: Error | null) => { if (error) reject(error); else { activeBroker.subscriptions.add(topic); resolve(); } }));
    this.broadcast({ type: "consumer.updated", payload: session }); return session;
  }

  async stopConsumer(sessionId: string) {
    const session = await this.repositories.getSession(sessionId); if (!session) return null;
    await this.repositories.saveSession({ ...session, topics: [], active: 0 });
    const topics = JSON.parse(session.topicsJson) as string[]; const activeBroker = this.brokers.get(session.brokerProfileId); this.consumers.delete(sessionId);
    if (activeBroker) for (const topic of topics) { activeBroker.subscriptions.delete(topic); if (![...this.consumers.values()].some((consumer) => consumer.brokerProfileId === session.brokerProfileId && consumer.topics.includes(topic))) await new Promise<void>((resolve) => activeBroker.client.unsubscribe(topic, () => resolve())); }
    this.broadcast({ type: "consumer.updated", payload: { ...session, topicsJson: "[]", active: 0 } }); return { ...session, topicsJson: "[]", active: 0 };
  }

  async unsubscribeConsumerTopic(sessionId: string, topic: string) {
    const session = await this.repositories.getSession(sessionId); if (!session) return null;
    const currentTopics = JSON.parse(session.topicsJson) as string[]; if (!currentTopics.includes(topic)) throw new Error(`Topic is not subscribed: ${topic}`);
    const remainingTopics = currentTopics.filter((item) => item !== topic); await this.repositories.saveSession({ ...session, topics: remainingTopics, active: remainingTopics.length ? 1 : 0 });
    const consumer = this.consumers.get(sessionId); if (consumer) consumer.topics = remainingTopics; if (!remainingTopics.length) this.consumers.delete(sessionId);
    const activeBroker = this.brokers.get(session.brokerProfileId); if (activeBroker && ![...this.consumers.values()].some((item) => item.brokerProfileId === session.brokerProfileId && item.topics.includes(topic))) { activeBroker.subscriptions.delete(topic); await new Promise<void>((resolve) => activeBroker.client.unsubscribe(topic, () => resolve())); }
    const updated: ConsumerSessionRow = { ...session, topicsJson: JSON.stringify(remainingTopics), active: remainingTopics.length ? 1 : 0, updatedAt: new Date().toISOString() }; this.broadcast({ type: "consumer.updated", payload: updated }); return updated;
  }

  private async handleIncomingMessage(profileId: string, topic: string, message: Buffer, messageKey: string | null) {
    const payloadText = message.toString("utf8"); const payloadJson = safeJsonParse(payloadText);
    for (const consumer of [...this.consumers.values()].filter((item) => item.brokerProfileId === profileId)) if (consumer.topics.some((filter) => topicMatches(filter, topic))) {
      const log = await this.repositories.addLog({ direction: "consume", topic, payloadText, payloadJson: payloadJson === null ? null : JSON.stringify(payloadJson), status: "ok", error: null, brokerProfileId: profileId, requestId: null, consumerSessionId: consumer.id, messageKey, createdAt: new Date().toISOString() });
      this.broadcast({ type: "consumer.message", payload: { consumerSessionId: consumer.id, topic, payloadText, payloadJson, log } }); this.broadcast({ type: "log.created", payload: log });
    }
  }
}
