import {
  BootstrapState,
  BrokerProfileRow,
  CollectionRow,
  ConsumerSessionRow,
  MessageLogRow,
  RequestRow,
  CustomFunctionRow,
  VariableCollectionRow,
  VariableRow,
} from "../models";

const API_BASE_URL =
  import.meta.env.VITE_API_URL ??
  (import.meta.env.DEV ? "http://localhost:3000" : window.location.origin);
const WS_BASE_URL =
  import.meta.env.VITE_WS_URL ?? API_BASE_URL.replace(/^http/, "ws");

type CollectionWrite = {
  id?: string | undefined;
  name: string;
  description?: string | null | undefined;
  variableCollectionId?: string | null | undefined;
};
type RequestWrite = {
  id?: string | undefined;
  collectionId: string;
  name: string;
  topic: string;
  payloadTemplate: string;
  payloadFormat: "raw" | "xml" | "json";
  qos: number;
  retain: boolean;
  brokerProfileId?: string | null | undefined;
};
type VariableCollectionWrite = { id?: string | undefined; name: string };
type VariableWrite = {
  id?: string | undefined;
  variableCollectionId?: string | undefined;
  name: string;
  value: string;
  sortOrder?: number | undefined;
};
type BrokerWrite = {
  id?: string | undefined;
  name: string;
  host: string;
  port: number;
  protocol: string;
  validateCertificate: boolean;
  encryption: boolean;
  username?: string | null | undefined;
  password?: string | null | undefined;
  clientId: string;
  clean: boolean;
  keepAlive: number;
  reconnectPeriod: number;
  caCert?: string | null | undefined;
  clientCert?: string | null | undefined;
  clientKey?: string | null | undefined;
};

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}/api${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
    ...init,
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: response.statusText }));
    const message =
      typeof error.message === "string" && error.message.trim()
        ? error.message
        : response.statusText || "Request failed";
    throw new Error(message);
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export const apiClient = {
  bootstrap: () => request<BootstrapState>("/bootstrap"),
  collections: {
    create: (payload: CollectionWrite) =>
      request<CollectionRow>("/collections", {
        method: "POST",
        body: JSON.stringify(payload),
      }),
    update: (id: string, payload: CollectionWrite) =>
      request<CollectionRow>(`/collections/${id}`, {
        method: "PUT",
        body: JSON.stringify(payload),
      }),
    remove: (id: string) => request<void>(`/collections/${id}`, { method: "DELETE" }),
    duplicate: (id: string) =>
      request<{ collection: CollectionRow; requests: RequestRow[] }>(
        `/collections/${id}/duplicate`,
        { method: "POST" },
      ),
    export: async (id: string) => {
      const response = await fetch(`${API_BASE_URL}/api/collections/${id}/export`);
      if (!response.ok) throw new Error(response.statusText || "Unable to export collection");
      return response.blob();
    },
    import: async (file: File, name: string, description: string) => {
      const response = await fetch(`${API_BASE_URL}/api/collections/import`, {
        method: "POST",
        headers: {
          "Content-Type": "application/zip",
          "X-Collection-Name": name,
          "X-Collection-Description": description,
        },
        body: file,
      });
      if (!response.ok) {
        const error = await response.json().catch(() => ({ message: response.statusText }));
        const message = typeof error.message === "string" && error.message.trim()
          ? error.message
          : response.statusText || "Unable to import collection";
        throw new Error(message);
      }
      return (await response.json()) as { collection: CollectionRow; requests: RequestRow[] };
    },
    reorder: (collectionIds: string[]) =>
      request<CollectionRow[]>("/collections/order", {
        method: "PUT",
        body: JSON.stringify({ collectionIds }),
      }),
  },
  requests: {
    create: (payload: RequestWrite) =>
      request<RequestRow>("/requests", {
        method: "POST",
        body: JSON.stringify(payload),
      }),
    update: (id: string, payload: RequestWrite) =>
      request<RequestRow>(`/requests/${id}`, {
        method: "PUT",
        body: JSON.stringify(payload),
      }),
    remove: (id: string) => request<void>(`/requests/${id}`, { method: "DELETE" }),
    reorder: (collectionId: string, requestIds: string[]) =>
      request<RequestRow[]>(`/collections/${collectionId}/requests/order`, {
        method: "PUT",
        body: JSON.stringify({ requestIds }),
      }),
  },
  variableCollections: {
    create: (payload: VariableCollectionWrite) =>
      request<VariableCollectionRow>("/variable-collections", {
        method: "POST",
        body: JSON.stringify(payload),
      }),
    update: (id: string, payload: VariableCollectionWrite) =>
      request<VariableCollectionRow>(`/variable-collections/${id}`, {
        method: "PUT",
        body: JSON.stringify(payload),
      }),
    remove: (id: string) => request<void>(`/variable-collections/${id}`, { method: "DELETE" }),
    variables: (id: string) => request<VariableRow[]>(`/variable-collections/${id}/variables`),
    createVariable: (id: string, payload: VariableWrite) =>
      request<VariableRow>(`/variable-collections/${id}/variables`, {
        method: "POST",
        body: JSON.stringify(payload),
      }),
    updateVariable: (id: string, payload: VariableWrite) =>
      request<VariableRow>(`/variables/${id}`, {
        method: "PUT",
        body: JSON.stringify(payload),
      }),
    removeVariable: (id: string) => request<void>(`/variables/${id}`, { method: "DELETE" }),
    reorderVariables: (id: string, variableIds: string[]) =>
      request<VariableRow[]>(`/variable-collections/${id}/variables/order`, {
        method: "PUT",
        body: JSON.stringify({ variableIds }),
      }),
  },
  brokers: {
    statuses: () =>
      request<Array<{ profileId: string; connected: boolean; refCount: number; lastError: string | null }>>(
        "/brokers/status",
      ),
    create: (payload: BrokerWrite) =>
      request<BrokerProfileRow>("/brokers", { method: "POST", body: JSON.stringify(payload) }),
    update: (id: string, payload: BrokerWrite) =>
      request<BrokerProfileRow>(`/brokers/${id}`, { method: "PUT", body: JSON.stringify(payload) }),
    remove: (id: string) => request<void>(`/brokers/${id}`, { method: "DELETE" }),
    connect: (id: string) =>
      request<{ profileId: string; connected: boolean; refCount: number; lastError: string | null }>(
        `/brokers/${id}/connect`,
        { method: "POST" },
      ),
    test: (payload: Record<string, unknown>) =>
      request<{ ok: true }>("/brokers/test", { method: "POST", body: JSON.stringify(payload) }),
    disconnect: (id: string) => request<void>(`/brokers/${id}/disconnect`, { method: "POST" }),
  },
  customFunctions: {
    create: (payload: Record<string, unknown>) =>
      request<CustomFunctionRow>("/custom-functions", { method: "POST", body: JSON.stringify(payload) }),
    update: (id: string, payload: Record<string, unknown>) =>
      request<CustomFunctionRow>(`/custom-functions/${id}`, { method: "PUT", body: JSON.stringify(payload) }),
    remove: (id: string) => request<void>(`/custom-functions/${id}`, { method: "DELETE" }),
  },
  batchPublish: (payload: Record<string, unknown>) =>
    request<{
      count: number;
      results: Array<{
        ok: boolean;
        log: MessageLogRow;
      }>;
    }>("/publish/batch", { method: "POST", body: JSON.stringify(payload) }),
  resolveTemplate: (payload: Record<string, unknown>) =>
    request<{ text: string; json: unknown; value: unknown }>("/templates/resolve", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  consumers: {
    create: (payload: { name: string; brokerProfileId: string; topics: string[]; qos: number }) =>
      request<ConsumerSessionRow>("/consumer-sessions", {
        method: "POST",
        body: JSON.stringify(payload),
      }),
    remove: (id: string) => request<void>(`/consumer-sessions/${id}`, { method: "DELETE" }),
    unsubscribe: (id: string, topic: string) =>
      request<ConsumerSessionRow | void>(`/consumer-sessions/${id}/topics`, {
        method: "DELETE",
        body: JSON.stringify({ topic }),
      }),
  },
  logs: {
    list: () => request<MessageLogRow[]>("/logs"),
    clear: () => request<void>("/logs", { method: "DELETE" }),
  },
};

export function createRealtimeSocket() {
  return new WebSocket(`${WS_BASE_URL}/ws`);
}
