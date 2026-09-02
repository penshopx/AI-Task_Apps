import assert from "node:assert/strict";
import { test } from "node:test";
import { Pool } from "pg";

test("dua pengguna dapat menyimpan ID tugas sama tanpa mengakses data satu sama lain", {
  skip: !process.env.DATABASE_URL && "DATABASE_URL tidak tersedia",
}, async () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  const client = await pool.connect();
  const suffix = `${process.pid}-${Date.now()}`;
  const taskId = `shared-${suffix}`;
  const userA = `test-user-a-${suffix}`;
  const userB = `test-user-b-${suffix}`;
  const now = Date.now();

  try {
    await client.query("BEGIN");
    await client.query(
      "INSERT INTO focusboard_tasks (id, workspace_code, user_id, title, category, priority, completed, created_at, updated_at) VALUES ($1, 'PERSONAL', $2, 'Tugas A', 'Kerja', 'medium', false, $4, $4), ($1, 'PERSONAL', $3, 'Tugas B', 'Pribadi', 'high', false, $4, $4)",
      [taskId, userA, userB, now],
    );

    const accountA = await client.query(
      "SELECT title FROM focusboard_tasks WHERE user_id = $1 AND id = $2",
      [userA, taskId],
    );
    const accountB = await client.query(
      "SELECT title FROM focusboard_tasks WHERE user_id = $1 AND id = $2",
      [userB, taskId],
    );
    assert.deepEqual(accountA.rows.map((row) => row.title), ["Tugas A"]);
    assert.deepEqual(accountB.rows.map((row) => row.title), ["Tugas B"]);

    const crossUpdate = await client.query(
      "UPDATE focusboard_tasks SET title = 'Tidak boleh' WHERE user_id = $1 AND id = $2 AND title = 'Tugas B'",
      [userA, taskId],
    );
    const crossDelete = await client.query(
      "DELETE FROM focusboard_tasks WHERE user_id = $1 AND id = $2 AND title = 'Tugas B'",
      [userA, taskId],
    );
    assert.equal(crossUpdate.rowCount, 0);
    assert.equal(crossDelete.rowCount, 0);
  } finally {
    await client.query("ROLLBACK");
    client.release();
    await pool.end();
  }
});