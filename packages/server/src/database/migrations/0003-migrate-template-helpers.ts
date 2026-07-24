import { MigrationInterface, QueryRunner } from "typeorm";

type LegacyHelperRow = {
  id: string;
  name: string;
  kind: "literal" | "now" | "uuid" | "randomInt" | "env";
  configJson: string;
  createdAt: string;
  updatedAt: string;
};

function configOf(configJson: string) {
  try {
    const value: unknown = JSON.parse(configJson);
    return value && typeof value === "object" && !Array.isArray(value)
      ? value as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function legacyValue(helper: LegacyHelperRow) {
  const config = configOf(helper.configJson);
  switch (helper.kind) {
    case "literal":
      return String(config.value ?? "");
    case "now": {
      const format = typeof config.format === "string" ? config.format : "";
      return format ? `{{now:${format}}}` : "{{now}}";
    }
    case "uuid":
      return "{{uuid}}";
    case "randomInt":
      return `{{randomInt:${String(config.min ?? 0)}:${String(config.max ?? 999999)}}}`;
    case "env":
      return `$${String(config.key ?? "")}`;
  }
}

export class MigrateTemplateHelpers1760000000002 implements MigrationInterface {
  name = "MigrateTemplateHelpers1760000000002";

  async up(queryRunner: QueryRunner) {
    await queryRunner.query(`CREATE TABLE IF NOT EXISTS custom_functions (id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL UNIQUE, description TEXT, value TEXT NOT NULL, createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL)`);
    if (!(await queryRunner.hasTable("template_helpers"))) return;

    const helpers = await queryRunner.query("SELECT id, name, kind, configJson, createdAt, updatedAt FROM template_helpers") as LegacyHelperRow[];
    for (const helper of helpers) {
      await queryRunner.query(
        "INSERT OR IGNORE INTO custom_functions (id, name, description, value, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?)",
        [helper.id, helper.name, null, legacyValue(helper), helper.createdAt, helper.updatedAt],
      );
    }
    await queryRunner.query("DROP TABLE template_helpers");
  }

  async down(queryRunner: QueryRunner) {
    await queryRunner.query(`CREATE TABLE IF NOT EXISTS template_helpers (id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL UNIQUE, kind TEXT NOT NULL, configJson TEXT NOT NULL, createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL)`);
    await queryRunner.query("DROP TABLE IF EXISTS custom_functions");
  }
}
