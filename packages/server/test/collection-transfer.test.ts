import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import unzipper from "unzipper";
import { initializeDatabase } from "../src/database/data-source";
import { AppRepositories } from "../src/repositories";
import { CollectionTransferService } from "../src/services/collection-transfer";

async function withDatabase(run: (service: CollectionTransferService, repositories: AppRepositories) => Promise<void>) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "mqtt-postwoman-transfer-"));
  const previous = process.env.SQLITE_PATH;
  process.env.SQLITE_PATH = path.join(directory, "test.db");
  const dataSource = await initializeDatabase();
  try {
    const repositories = new AppRepositories(dataSource);
    await run(new CollectionTransferService(repositories), repositories);
  } finally {
    await dataSource.destroy();
    if (previous === undefined) delete process.env.SQLITE_PATH;
    else process.env.SQLITE_PATH = previous;
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

test("exports and imports a collection as request JSON files", async () => {
  await withDatabase(async (service, repositories) => {
    const collection = await repositories.saveCollection({ name: "Orders", description: "MQTT requests" });
    const variableCollection = await repositories.saveVariableCollection({ name: "local" });
    await repositories.saveVariable({ variableCollectionId: variableCollection.id, name: "API_URL", value: "http://localhost" });
    await repositories.saveVariable({ variableCollectionId: variableCollection.id, name: "TOKEN", value: "secret" });
    await repositories.saveCollection({ id: collection.id, name: collection.name, description: collection.description, variableCollectionId: variableCollection.id });
    await repositories.saveRequest({ collectionId: collection.id, name: "Create order", topic: "orders/create", payloadTemplate: '<id>1</id>', payloadFormat: "xml", qos: 1, retain: true, sortOrder: 0 });
    const exported = await service.exportCollection(collection.id);
    const directory = await unzipper.Open.buffer(exported.buffer);
    const names = directory.files.map((entry) => entry.path).sort();
    assert.deepEqual(names, ["collection.json", "requests/001-Create-order.json", "variables.json"]);
    const imported = await service.importCollection(exported.buffer, "Orders");
    assert.equal(imported.collection.name, "Orders (Imported)");
    assert.equal(imported.collection.variableCollectionId, variableCollection.id);
    assert.deepEqual((await repositories.listVariables(variableCollection.id)).map((variable) => variable.name), ["API_URL", "TOKEN"]);
    assert.deepEqual(imported.requests.map((request) => ({ name: request.name, topic: request.topic, payloadTemplate: request.payloadTemplate, payloadFormat: request.payloadFormat, retain: request.retain })), [{ name: "Create order", topic: "orders/create", payloadTemplate: "<id>1</id>", payloadFormat: "xml", retain: 1 }]);
    const createdWithVariables = await repositories.importCollection({ name: "With variables", variableCollection: { name: "remote", variables: [{ name: "HOST", value: "broker" }] }, requests: [] });
    assert.ok(createdWithVariables.collection.variableCollectionId);
    assert.equal((await repositories.listVariables(createdWithVariables.collection.variableCollectionId ?? ""))[0]?.value, "broker");
  });
});

test("rejects an invalid ZIP without creating a collection", async () => {
  await withDatabase(async (service, repositories) => {
    const collection = await repositories.saveCollection({ name: "Existing" });
    await assert.rejects(() => service.importCollection(Buffer.from("not a zip"), "Broken"));
    assert.equal((await repositories.listCollections()).length, 1);
  });
});
