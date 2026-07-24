import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { initializeDatabase } from "../src/database/data-source";
import { AppRepositories } from "../src/repositories";

async function withDatabase(run: (repositories: AppRepositories) => Promise<void>) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "mqtt-postwoman-functions-"));
  const previous = process.env.SQLITE_PATH;
  process.env.SQLITE_PATH = path.join(directory, "test.db");
  const dataSource = await initializeDatabase();
  try {
    await run(new AppRepositories(dataSource));
  } finally {
    await dataSource.destroy();
    if (previous === undefined) delete process.env.SQLITE_PATH;
    else process.env.SQLITE_PATH = previous;
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

test("validates custom function names and dependency loops", async () => {
  await withDatabase(async (repositories) => {
    const base = await repositories.saveCustomFunction({ name: "base", value: "hello" });
    await assert.rejects(() => repositories.saveCustomFunction({ name: "now", value: "x" }), /conflicts with a built-in/);
    await assert.rejects(() => repositories.saveCustomFunction({ name: "bad-name", value: "x" }), /letters, numbers, and underscores/);
    const child = await repositories.saveCustomFunction({ name: "child", value: "{{base}}" });
    await assert.rejects(() => repositories.saveCustomFunction({ id: base.id, name: "base", value: "{{child}}" }), /dependency loop/);
    await assert.rejects(() => repositories.deleteCustomFunction(base.id), /referenced by: child/);
    assert.equal(await repositories.deleteCustomFunction(child.id), true);
    assert.equal(await repositories.deleteCustomFunction(base.id), true);
  });
});
