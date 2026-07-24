import { EntitySchema } from "typeorm";
import { BrokerProfileRow, CollectionRow, ConsumerSessionRow, CustomFunctionRow, MessageLogRow, RequestRow, VariableCollectionRow, VariableRow } from "../types";

const baseColumns = {
  id: { type: String, primary: true },
  createdAt: { type: String },
  updatedAt: { type: String },
};

export const CollectionEntity = new EntitySchema<CollectionRow>({
  name: "Collection",
  tableName: "collections",
  columns: {
    ...baseColumns,
    name: { type: String }, description: { type: String, nullable: true },
    variableCollectionId: { type: String, nullable: true }, sortOrder: { type: Number, default: 0 },
  },
});

export const RequestEntity = new EntitySchema<RequestRow>({
  name: "Request",
  tableName: "requests",
  columns: {
    ...baseColumns,
    collectionId: { type: String }, name: { type: String }, topic: { type: String }, payloadTemplate: { type: String },
    qos: { type: Number, default: 0 }, retain: { type: Number, default: 0 }, brokerProfileId: { type: String, nullable: true }, sortOrder: { type: Number, default: 0 },
  },
});

export const VariableCollectionEntity = new EntitySchema<VariableCollectionRow>({
  name: "VariableCollection", tableName: "variable_collections",
  columns: { ...baseColumns, name: { type: String } },
});

export const VariableEntity = new EntitySchema<VariableRow>({
  name: "Variable", tableName: "variables",
  columns: {
    ...baseColumns, variableCollectionId: { type: String }, name: { type: String }, value: { type: String, default: "" }, sortOrder: { type: Number, default: 0 },
  },
});

export const BrokerProfileEntity = new EntitySchema<BrokerProfileRow>({
  name: "BrokerProfile", tableName: "broker_profiles",
  columns: {
    ...baseColumns, name: { type: String }, host: { type: String }, port: { type: Number }, protocol: { type: String },
    validateCertificate: { type: Number, default: 1 }, encryption: { type: Number, default: 0 }, username: { type: String, nullable: true }, password: { type: String, nullable: true }, clientId: { type: String }, clean: { type: Number }, keepAlive: { type: Number }, reconnectPeriod: { type: Number }, caCert: { type: String, nullable: true }, clientCert: { type: String, nullable: true }, clientKey: { type: String, nullable: true },
  },
});

export const CustomFunctionEntity = new EntitySchema<CustomFunctionRow>({
  name: "CustomFunction", tableName: "custom_functions",
  columns: { ...baseColumns, name: { type: String }, description: { type: String, nullable: true }, value: { type: String } },
});

export const ConsumerSessionEntity = new EntitySchema<ConsumerSessionRow>({
  name: "ConsumerSession", tableName: "consumer_sessions",
  columns: { ...baseColumns, name: { type: String }, brokerProfileId: { type: String }, topicsJson: { type: String }, qos: { type: Number }, active: { type: Number } },
});

export const MessageLogEntity = new EntitySchema<MessageLogRow>({
  name: "MessageLog", tableName: "message_logs",
  columns: {
    id: { type: String, primary: true }, direction: { type: String }, topic: { type: String }, payloadText: { type: String }, payloadJson: { type: String, nullable: true }, status: { type: String }, error: { type: String, nullable: true }, brokerProfileId: { type: String, nullable: true }, requestId: { type: String, nullable: true }, consumerSessionId: { type: String, nullable: true }, messageKey: { type: String, nullable: true }, createdAt: { type: String },
  },
});

export const entities = [CollectionEntity, RequestEntity, VariableCollectionEntity, VariableEntity, BrokerProfileEntity, CustomFunctionEntity, ConsumerSessionEntity, MessageLogEntity];
