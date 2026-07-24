import "reflect-metadata";
import fs from "node:fs";
import path from "node:path";
import { DataSource } from "typeorm";
import { entities } from "./entities";
import { InitialSchema1760000000000 } from "./migrations/0001-initial-schema";
import { MigrateLegacyEnvironment1760000000001 } from "./migrations/0002-migrate-legacy-environment";
import { MigrateTemplateHelpers1760000000002 } from "./migrations/0003-migrate-template-helpers";
import { AddRequestPayloadFormat1760000000003 } from "./migrations/0004-add-request-payload-format";

export function databasePath() {
  return process.env.SQLITE_PATH ?? path.resolve(process.cwd(), "data", "mqtt-postwoman.db");
}

export function createDataSource() {
  const file = databasePath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  return new DataSource({
    type: "better-sqlite3",
    database: file,
    entities,
    migrations: [InitialSchema1760000000000, MigrateLegacyEnvironment1760000000001, MigrateTemplateHelpers1760000000002, AddRequestPayloadFormat1760000000003],
    synchronize: false,
    logging: false,
    prepareDatabase: (db) => {
      db.pragma("journal_mode = WAL");
      db.pragma("foreign_keys = ON");
    },
  });
}

export async function initializeDatabase(dataSource = createDataSource()) {
  if (!dataSource.isInitialized) await dataSource.initialize();
  await dataSource.runMigrations();
  return dataSource;
}
