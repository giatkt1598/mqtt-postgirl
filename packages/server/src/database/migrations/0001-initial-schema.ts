import { MigrationInterface, QueryRunner } from "typeorm";

export class InitialSchema1760000000000 implements MigrationInterface {
  name = "InitialSchema1760000000000";

  async up(queryRunner: QueryRunner) {
    await queryRunner.query(`CREATE TABLE IF NOT EXISTS collections (id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, description TEXT, variableCollectionId TEXT, sortOrder INTEGER NOT NULL DEFAULT 0, createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL)`);
    await queryRunner.query(`CREATE TABLE IF NOT EXISTS variable_collections (id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL)`);
    await queryRunner.query(`CREATE TABLE IF NOT EXISTS variables (id TEXT PRIMARY KEY NOT NULL, variableCollectionId TEXT NOT NULL, name TEXT NOT NULL, value TEXT NOT NULL DEFAULT '', sortOrder INTEGER NOT NULL DEFAULT 0, createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL, CONSTRAINT UQ_variables_collection_name UNIQUE (variableCollectionId, name), FOREIGN KEY (variableCollectionId) REFERENCES variable_collections(id) ON DELETE CASCADE)`);
    await queryRunner.query(`CREATE TABLE IF NOT EXISTS broker_profiles (id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, host TEXT NOT NULL, port INTEGER NOT NULL, protocol TEXT NOT NULL, validateCertificate INTEGER NOT NULL DEFAULT 1, encryption INTEGER NOT NULL DEFAULT 0, username TEXT, password TEXT, clientId TEXT NOT NULL, clean INTEGER NOT NULL, keepAlive INTEGER NOT NULL, reconnectPeriod INTEGER NOT NULL, caCert TEXT, clientCert TEXT, clientKey TEXT, createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL)`);
    await queryRunner.query(`CREATE TABLE IF NOT EXISTS requests (id TEXT PRIMARY KEY NOT NULL, collectionId TEXT NOT NULL, name TEXT NOT NULL, topic TEXT NOT NULL, payloadTemplate TEXT NOT NULL, payloadFormat TEXT NOT NULL DEFAULT 'json', qos INTEGER NOT NULL DEFAULT 0, retain INTEGER NOT NULL DEFAULT 0, brokerProfileId TEXT, sortOrder INTEGER NOT NULL DEFAULT 0, createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL, FOREIGN KEY (collectionId) REFERENCES collections(id) ON DELETE CASCADE)`);
    await queryRunner.query(`CREATE TABLE IF NOT EXISTS custom_functions (id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL UNIQUE, description TEXT, value TEXT NOT NULL, createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL)`);
    await queryRunner.query(`CREATE TABLE IF NOT EXISTS consumer_sessions (id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, brokerProfileId TEXT NOT NULL, topicsJson TEXT NOT NULL, qos INTEGER NOT NULL, active INTEGER NOT NULL, createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL)`);
    await queryRunner.query(`CREATE TABLE IF NOT EXISTS message_logs (id TEXT PRIMARY KEY NOT NULL, direction TEXT NOT NULL, topic TEXT NOT NULL, payloadText TEXT NOT NULL, payloadJson TEXT, status TEXT NOT NULL, error TEXT, brokerProfileId TEXT, requestId TEXT, consumerSessionId TEXT, messageKey TEXT, createdAt TEXT NOT NULL)`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS IDX_variables_collection_order ON variables (variableCollectionId, sortOrder, createdAt)`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS IDX_requests_collection_order ON requests (collectionId, sortOrder, createdAt)`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS IDX_logs_created_at ON message_logs (createdAt)`);
  }

  async down(queryRunner: QueryRunner) {
    for (const table of ["message_logs", "consumer_sessions", "custom_functions", "requests", "variables", "variable_collections", "broker_profiles", "collections"]) await queryRunner.query(`DROP TABLE IF EXISTS ${table}`);
  }
}
