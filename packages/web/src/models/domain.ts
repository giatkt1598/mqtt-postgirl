export interface CollectionRow {
  id: string;
  name: string;
  description: string | null;
  variableCollectionId: string | null;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface RequestRow {
  id: string;
  collectionId: string;
  name: string;
  topic: string;
  payloadTemplate: string;
  payloadFormat: PayloadFormat;
  qos: number;
  retain: boolean;
  brokerProfileId: string | null;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export type PayloadFormat = "raw" | "xml" | "json";

export interface VariableCollectionRow {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

export interface VariableRow {
  id: string;
  variableCollectionId: string;
  name: string;
  value: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface BrokerProfileRow {
  id: string;
  name: string;
  host: string;
  port: number;
  protocol: string;
  validateCertificate: boolean;
  encryption: boolean;
  username: string | null;
  password: string | null;
  clientId: string;
  clean: boolean;
  keepAlive: number;
  reconnectPeriod: number;
  caCert: string | null;
  clientCert: string | null;
  clientKey: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CustomFunctionRow {
  id: string;
  name: string;
  description: string | null;
  value: string;
  createdAt: string;
  updatedAt: string;
}

export interface ConsumerSessionRow {
  id: string;
  name: string;
  brokerProfileId: string;
  topicsJson: string;
  qos: number;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface MessageLogRow {
  id: string;
  direction: "publish" | "consume";
  topic: string;
  payloadText: string;
  payloadJson: string | null;
  status: string;
  error: string | null;
  brokerProfileId: string | null;
  requestId: string | null;
  consumerSessionId: string | null;
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

export interface ConsumerMessageEvent {
  consumerSessionId: string;
  topic: string;
  payloadText: string;
  payloadJson: unknown;
  log: MessageLogRow;
}

export interface DraftRequest {
  id?: string;
  collectionId: string;
  name: string;
  topic: string;
  payloadTemplate: string;
  payloadFormat: PayloadFormat;
  qos: number;
  retain: boolean;
  brokerProfileId: string;
}
