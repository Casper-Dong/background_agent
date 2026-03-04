import fs from "fs";
import path from "path";
import { pool } from "./db";

async function migrate() {
  const schemaPath = path.join(__dirname, "schema.sql");
  const sql = fs.readFileSync(schemaPath, "utf-8");

  console.log("[migrate] Applying schema...");
  await pool.query(sql);
  console.log("[migrate] Schema applied successfully.");

  await pool.end();
}

migrate().catch((err) => {
  console.error("[migrate] Failed:", err);
  process.exit(1);
});
