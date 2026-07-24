import { z } from "zod";
import { AppRepositories } from "../repositories";
import { RuntimeService } from "../runtime";
import { createTemplateHelperMap, resolveTemplatePayload } from "../template";
import { parseObjectLike } from "../utils";

export type CollectionInput = { id?: string | undefined; name: string; description?: string | null | undefined; variableCollectionId?: string | null | undefined };
export type RequestInput = { id?: string | undefined; collectionId: string; name: string; topic: string; payloadTemplate: string; qos?: number | undefined; retain?: boolean | number | undefined; brokerProfileId?: string | null | undefined };
export type VariableCollectionInput = { id?: string | undefined; name: string };
export type VariableInput = { id?: string | undefined; variableCollectionId: string; name: string; value?: string | undefined; sortOrder?: number | undefined };
export type BrokerInput = { id?: string | undefined; name: string; host: string; port: number; protocol: string; validateCertificate?: boolean | number | undefined; encryption?: boolean | number | undefined; username?: string | null | undefined; password?: string | null | undefined; clientId?: string | undefined; clean?: boolean | number | undefined; keepAlive?: number | undefined; reconnectPeriod?: number | undefined; caCert?: string | null | undefined; clientCert?: string | null | undefined; clientKey?: string | null | undefined };
export type PublishInput = { requestId?: string | undefined; brokerProfileId?: string | undefined; topic?: string | undefined; payloadTemplate?: string | undefined; qos?: number | undefined; retain?: boolean | undefined; variableCollectionId?: string | null | undefined; variables?: Record<string, unknown> | undefined; _sequenceOffset?: number | undefined };
export type BatchPublishInput = PublishInput & { count?: number | undefined; delayMs?: number | undefined; items?: Array<{ topic?: string | undefined; payloadTemplate?: string | undefined; variables?: Record<string, unknown> | undefined }> | undefined };

export class AppServices {
  constructor(public readonly repositories: AppRepositories, private readonly runtime: RuntimeService) {}

  private get repos() { return this.repositories; }
  collections = { list: () => this.repos.listCollections(), save: (input: CollectionInput) => this.repos.saveCollection(input), delete: (id: string) => this.repos.deleteCollection(id), reorder: (ids: string[]) => this.repos.reorderCollections(ids), duplicate: (id: string) => this.repos.duplicateCollection(id) };
  requests = { list: (collectionId?: string) => this.repos.listRequests(collectionId), get: (id: string) => this.repos.getRequest(id), save: (input: RequestInput) => this.repos.saveRequest(input), delete: (id: string) => this.repos.deleteRequest(id), reorder: (collectionId: string, ids: string[]) => this.repos.reorderRequests(collectionId, ids) };
  variables = { collections: () => this.repos.listVariableCollections(), collection: (id: string) => this.repos.getVariableCollection(id), saveCollection: (input: VariableCollectionInput) => this.repos.saveVariableCollection(input), deleteCollection: (id: string) => this.repos.deleteVariableCollection(id), list: (id?: string) => this.repos.listVariables(id), get: (id: string) => this.repos.getVariable(id), save: (input: VariableInput) => this.repos.saveVariable(input), delete: (id: string) => this.repos.deleteVariable(id), reorder: (id: string, ids: string[]) => this.repos.reorderVariables(id, ids) };
  brokers = { list: () => this.repos.listBrokers(), get: (id: string) => this.repos.getBroker(id), save: (input: BrokerInput) => this.repos.saveBroker(input), delete: (id: string) => this.repos.deleteBroker(id) };
  helpers = { list: () => this.repos.listHelpers(), save: (input: { id?: string | undefined; name: string; kind: string; configJson: string }) => this.repos.saveHelper(input), delete: (id: string) => this.repos.deleteHelper(id) };
  logs = { list: (limit?: number) => this.repos.listLogs(limit), clear: () => this.repos.clearLogs() };

  async resolve(template: string, variableCollectionId: string | null | undefined, variables: Record<string, unknown>, sequenceOffset = 0) {
    const values = variableCollectionId ? Object.fromEntries((await this.repos.listVariables(variableCollectionId)).map((item) => [item.name, item.value])) : {};
    const helpers = createTemplateHelperMap(await this.repos.listHelpers());
    return resolveTemplatePayload(template, { variableCollection: values, variables: parseObjectLike(variables), helpers, sequenceOffset });
  }

  async publish(input: PublishInput) {
    const request = input.requestId ? await this.repos.getRequest(input.requestId) : undefined;
    if (input.requestId && !request) throw new Error("Request not found");
    const collection = request ? await this.repos.getCollection(request.collectionId) : undefined;
    const brokerProfileId = input.brokerProfileId ?? request?.brokerProfileId ?? null;
    if (!brokerProfileId) throw new Error("Broker profile is required");
    const variableCollectionId = input.variableCollectionId ?? collection?.variableCollectionId ?? null;
    const topic = input.topic ?? request?.topic ?? "";
    if (!topic) throw new Error("Topic is required");
    const variables = parseObjectLike(input.variables);
    const resolvedTopic = await this.resolve(topic, variableCollectionId, variables, input._sequenceOffset ?? 0);
    if (!resolvedTopic.text.trim()) throw new Error("Topic is required");
    const payload = await this.resolve(input.payloadTemplate ?? request?.payloadTemplate ?? "{}", variableCollectionId, variables, input._sequenceOffset ?? 0);
    return this.runtime.publish(brokerProfileId, resolvedTopic.text, payload, { qos: input.qos ?? request?.qos ?? 0, retain: input.retain ?? Boolean(request?.retain) }, input.requestId ?? request?.id ?? null, variables);
  }

  async batchPublish(input: BatchPublishInput) {
    const count = input.count ?? 10;
    const items: Array<{ topic?: string | undefined; payloadTemplate?: string | undefined; variables?: Record<string, unknown> | undefined }> = input.items?.length ? input.items : Array.from({ length: count }, () => ({}));
    const results = [];
    for (const [index, item] of items.entries()) {
      results.push(await this.publish({ ...input, topic: item.topic ?? input.topic, payloadTemplate: item.payloadTemplate ?? input.payloadTemplate, variables: item.variables ?? input.variables, requestId: input.requestId, _sequenceOffset: index }));
      if ((input.delayMs ?? 0) > 0) await new Promise((resolve) => setTimeout(resolve, input.delayMs ?? 0));
    }
    return { count: results.length, results };
  }
}

const persistedBoolean = z
  .union([z.boolean(), z.literal(0), z.literal(1)])
  .transform((value) => value === true || value === 1);

export const schemas = {
  collection: z.object({ id: z.string().optional(), name: z.string().min(1), description: z.string().optional().nullable(), variableCollectionId: z.string().optional().nullable() }),
  request: z.object({ id: z.string().optional(), collectionId: z.string().min(1), name: z.string().min(1), topic: z.string().default(""), payloadTemplate: z.string().default("{}"), qos: z.number().int().min(0).max(2).default(0), retain: z.boolean().default(false), brokerProfileId: z.string().optional().nullable() }),
  variableCollection: z.object({ id: z.string().optional(), name: z.string().trim().min(1) }),
  variable: z.object({ id: z.string().optional(), variableCollectionId: z.string().min(1), name: z.string().trim().regex(/^[A-Za-z0-9_]+$/, "Variable name may only contain letters, numbers, and underscores."), value: z.string().default(""), sortOrder: z.number().int().nonnegative().optional() }),
  broker: z.object({ id: z.string().optional(), name: z.string().min(1), host: z.string().min(1), port: z.number().int().min(1).max(65535), protocol: z.enum(["mqtt", "ws", "mqtts", "wss"]).default("mqtt"), validateCertificate: persistedBoolean.default(true), encryption: persistedBoolean.default(false), username: z.string().optional().nullable(), password: z.string().optional().nullable(), clientId: z.string().optional(), clean: persistedBoolean.default(true), keepAlive: z.number().int().min(1).max(3600).default(30), reconnectPeriod: z.number().int().min(250).max(60000).default(1000), caCert: z.string().optional().nullable(), clientCert: z.string().optional().nullable(), clientKey: z.string().optional().nullable() }),
};
