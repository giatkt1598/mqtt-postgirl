import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { initializeDatabase } from "../src/database/data-source";
import { AppRepositories } from "../src/repositories";

async function withDatabase(run: (repositories: AppRepositories) => Promise<void>) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "mqtt-postwoman-"));
  const previous = process.env.SQLITE_PATH;
  process.env.SQLITE_PATH = path.join(directory, "test.db");
  const dataSource = await initializeDatabase();
  try { await run(new AppRepositories(dataSource)); } finally {
    await dataSource.destroy();
    if (previous === undefined) delete process.env.SQLITE_PATH; else process.env.SQLITE_PATH = previous;
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

test("supports variable collection and variable CRUD", async () => {
  await withDatabase(async (repositories) => {
    const collection = await repositories.saveVariableCollection({ name: "local" });
    await assert.rejects(() => repositories.saveVariableCollection({ name: " LOCAL " }), /already exists/);
    const variable = await repositories.saveVariable({ variableCollectionId: collection.id, name: "API_URL", value: "http://localhost" });
    assert.equal(variable.value, "http://localhost");
    await assert.rejects(() => repositories.saveVariable({ variableCollectionId: collection.id, name: "API_URL", value: "duplicate" }), /already exists/);
    await assert.rejects(() => repositories.saveVariable({ variableCollectionId: collection.id, name: "API-URL", value: "invalid" }), /letters, numbers, and underscores/);
    assert.equal((await repositories.listVariables(collection.id)).length, 1);
    await repositories.deleteVariable(variable.id);
    await repositories.deleteVariableCollection(collection.id);
    assert.equal((await repositories.listVariableCollections()).length, 0);
  });
});

test("migrates legacy environments and request references", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "mqtt-postwoman-legacy-"));
  const file = path.join(directory, "legacy.db");
  const previous = process.env.SQLITE_PATH;
  process.env.SQLITE_PATH = file;
  const legacy = new Database(file);
  legacy.exec(`CREATE TABLE collections (id TEXT PRIMARY KEY, name TEXT, description TEXT, sortOrder INTEGER DEFAULT 0, createdAt TEXT, updatedAt TEXT); CREATE TABLE environments (id TEXT PRIMARY KEY, name TEXT, variablesJson TEXT, createdAt TEXT, updatedAt TEXT); CREATE TABLE requests (id TEXT PRIMARY KEY, collectionId TEXT, name TEXT, topic TEXT, payloadTemplate TEXT, qos INTEGER, retain INTEGER, brokerProfileId TEXT, environmentId TEXT, sortOrder INTEGER DEFAULT 0, createdAt TEXT, updatedAt TEXT); CREATE TABLE template_helpers (id TEXT PRIMARY KEY, name TEXT, kind TEXT, configJson TEXT, createdAt TEXT, updatedAt TEXT); INSERT INTO collections VALUES ('collection-1', 'Collection', NULL, 0, 'now', 'now'); INSERT INTO environments VALUES ('env-1', 'local', '{"API_URL":"http://localhost","PORT":1883}', 'now', 'now'); INSERT INTO requests VALUES ('request-1', 'collection-1', 'Request', 'topic', '{}', 0, 0, NULL, 'env-1', 0, 'now', 'now'); INSERT INTO template_helpers VALUES ('helper-literal', 'requestId', 'literal', '{"value":"fixed"}', 'now', 'now'); INSERT INTO template_helpers VALUES ('helper-now', 'createdAt', 'now', '{"format":"yyyy-MM-dd"}', 'now', 'now'); INSERT INTO template_helpers VALUES ('helper-uuid', 'traceId', 'uuid', '{}', 'now', 'now'); INSERT INTO template_helpers VALUES ('helper-random', 'attempt', 'randomInt', '{"min":2,"max":9}', 'now', 'now'); INSERT INTO template_helpers VALUES ('helper-env', 'host', 'env', '{"key":"API_URL"}', 'now', 'now');`);
  legacy.close();
  const dataSource = await initializeDatabase();
  try {
    const repositories = new AppRepositories(dataSource);
    assert.equal((await repositories.listVariableCollections())[0]?.name, "local");
    assert.deepEqual((await repositories.listVariables("env-1")).map((item) => item.name), ["API_URL", "PORT"]);
    assert.equal((await repositories.getCollection("collection-1"))?.variableCollectionId, "env-1");
    assert.deepEqual(
      Object.fromEntries((await repositories.listCustomFunctions()).map((item) => [item.name, item.value])),
      {
        requestId: "fixed",
        createdAt: "{{now:yyyy-MM-dd}}",
        traceId: "{{uuid}}",
        attempt: "{{randomInt:2:9}}",
        host: "$API_URL",
      },
    );
  } finally {
    await dataSource.destroy();
    if (previous === undefined) delete process.env.SQLITE_PATH; else process.env.SQLITE_PATH = previous;
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
