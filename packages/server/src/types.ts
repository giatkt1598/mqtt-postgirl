export type Id = string;

export interface CollectionRow {
  [key: string]: unknown;
  id: Id;
  name: string;
  description: string | null;
  variableCollectionId: Id | null;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface RequestRow {
  [key: string]: unknown;
  id: Id;
  collectionId: Id;
  name: string;
  topic: string;
  payloadTemplate: string;
  payloadFormat: string;
  qos: number;
  retain: number;
  brokerProfileId: Id | null;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface VariableCollectionRow {
  [key: string]: unknown;
  id: Id;
  name: string;
  createdAt: string;
  updatedAt: string;
}

export interface VariableRow {
  [key: string]: unknown;
  id: Id;
  variableCollectionId: Id;
  name: string;
  value: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface BrokerProfileRow {
  [key: string]: unknown;
  id: Id;
  name: string;
  host: string;
  port: number;
  protocol: string;
  validateCertificate: number;
  encryption: number;
  username: string | null;
  password: string | null;
  clientId: string;
  clean: number;
  keepAlive: number;
  reconnectPeriod: number;
  caCert: string | null;
  clientCert: string | null;
  clientKey: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CustomFunctionRow {
  [key: string]: unknown;
  id: Id;
  name: string;
  description: string | null;
  value: string;
  createdAt: string;
  updatedAt: string;
}

export interface ConsumerSessionRow {
  [key: string]: unknown;
  id: Id;
  name: string;
  brokerProfileId: Id;
  topicsJson: string;
  qos: number;
  active: number;
  createdAt: string;
  updatedAt: string;
}

export type MessageDirection = "publish" | "consume";

export interface MessageLogRow {
  [key: string]: unknown;
  id: Id;
  direction: MessageDirection;
  topic: string;
  payloadText: string;
  payloadJson: string | null;
  status: string;
  error: string | null;
  brokerProfileId: Id | null;
  requestId: Id | null;
  consumerSessionId: Id | null;
  messageKey: string | null;
  createdAt: string;
}

export interface BootstrapState {
  collections: CollectionRow[];
  requests: RequestRow[];
  variableCollections: VariableCollectionRow[];
  variables: VariableRow[];
  brokers: BrokerProfileRow[];
  customFunctions: CustomFunctionRow[];
  consumerSessions: ConsumerSessionRow[];
  logs: MessageLogRow[];
}
