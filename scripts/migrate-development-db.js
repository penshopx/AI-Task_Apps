import { readFile } from "node:fs/promises";
import { Pool } from "pg";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL tidak tersedia untuk migrasi database pengembangan.");
}

const migrationUrl = new URL("../database/migrations/001_user_owned_tasks.sql", import.meta.url);
const sql = await readFile(migrationUrl, "utf8");
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });

try {
  await pool.query(sql);
  console.log("Database development schema is up to date.");
} finally {
  await pool.end();
}