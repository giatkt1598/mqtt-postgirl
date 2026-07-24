import { MigrationInterface, QueryRunner } from "typeorm";

export class AddRequestPayloadFormat1760000000003 implements MigrationInterface {
  name = "AddRequestPayloadFormat1760000000003";

  async up(queryRunner: QueryRunner) {
    if (!(await queryRunner.hasColumn("requests", "payloadFormat"))) {
      await queryRunner.query("ALTER TABLE requests ADD COLUMN payloadFormat TEXT NOT NULL DEFAULT 'json'");
    }
  }

  async down(queryRunner: QueryRunner) {
    // SQLite cannot drop a column without rebuilding the table. Keep this migration irreversible.
  }
}
