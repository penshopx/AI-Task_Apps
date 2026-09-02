import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";

const PORT = Number(process.env.PORT || 5000);
const ROOT = path.dirname(fileURLToPath(import.meta.url));
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const allowedCategories = new Set(["Kerja", "Pribadi", "Belajar", "Keuangan"]);
const allowedPriorities = new Set(["high", "medium", "low"]);
const idPattern = /^[a-zA-Z0-9_-]{6,80}$/;
const workspacePattern = /^[A-Za-z0-9-]{4,32}$/;

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".jpg": "image/jpeg",
  ".png": "image/png",
};

function sendJson(response, status, payload) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(JSON.stringify(payload));
}

function validateWorkspaceCode(value) {
  return typeof value === "string" && workspacePattern.test(value.trim().toUpperCase());
}

function getWorkspaceCode(requestUrl) {
  const code = new URL(requestUrl, `http://localhost:${PORT}`).searchParams.get("workspace");
  return validateWorkspaceCode(code) ? code.trim().toUpperCase() : null;
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 100_000) {
        request.destroy();
        reject(new Error("Payload terlalu besar"));
      }
    });
    request.on("end", () => {
      try {
        resolve(JSON.parse(body || "{}"));
      } catch {
        reject(new Error("Payload JSON tidak valid"));
      }
    });
    request.on("error", reject);
  });
}

function normalizeTask(task, { requireId = false } = {}) {
  const normalized = {
    id: typeof task.id === "string" ? task.id.trim() : "",
    title: typeof task.title === "string" ? task.title.trim() : "",
    category: task.category,
    priority: task.priority,
    dueDate: task.dueDate || null,
    notes: typeof task.notes === "string" ? task.notes.trim().slice(0, 240) : "",
    completed: Boolean(task.completed),
    createdAt: Number.isFinite(Number(task.createdAt)) ? Number(task.createdAt) : Date.now(),
  };
  if (requireId && !idPattern.test(normalized.id)) throw new Error("ID tugas tidak valid");
  if (!normalized.title || normalized.title.length > 100) throw new Error("Judul tugas wajib diisi");
  if (!allowedCategories.has(normalized.category)) throw new Error("Kategori tugas tidak valid");
  if (!allowedPriorities.has(normalized.priority)) throw new Error("Prioritas tugas tidak valid");
  if (normalized.dueDate && !/^\d{4}-\d{2}-\d{2}$/.test(normalized.dueDate)) throw new Error("Deadline tugas tidak valid");
  return normalized;
}

function rowToTask(row) {
  const dueDate = row.due_date instanceof Date
    ? row.due_date.toISOString().slice(0, 10)
    : row.due_date ? String(row.due_date).slice(0, 10) : "";
  return {
    id: row.id,
    title: row.title,
    category: row.category,
    priority: row.priority,
    dueDate,
    notes: row.notes || "",
    completed: row.completed,
    createdAt: Number(row.created_at),
  };
}

async function handleApi(request, response, url) {
  const parts = url.pathname.split("/").filter(Boolean);
  const taskId = parts[2];
  if (request.method === "GET" && parts.length === 2 && parts[1] === "tasks") {
    const workspace = getWorkspaceCode(request.url);
    if (!workspace) return sendJson(response, 400, { error: "Kode ruang kerja tidak valid" });
    const result = await pool.query(
      "SELECT id, title, category, priority, due_date, notes, completed, created_at FROM focusboard_tasks WHERE workspace_code = $1 ORDER BY completed ASC, due_date ASC NULLS LAST, created_at DESC",
      [workspace],
    );
    return sendJson(response, 200, { tasks: result.rows.map(rowToTask) });
  }

  if (request.method === "POST" && parts.length === 2 && parts[1] === "tasks") {
    const payload = await readJson(request);
    const workspace = typeof payload.workspaceCode === "string" ? payload.workspaceCode.trim().toUpperCase() : "";
    if (!validateWorkspaceCode(workspace)) return sendJson(response, 400, { error: "Kode ruang kerja tidak valid" });
    const task = normalizeTask(payload.task);
    const result = await pool.query(
      "INSERT INTO focusboard_tasks (id, workspace_code, title, category, priority, due_date, notes, completed, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9) ON CONFLICT (workspace_code, id) DO UPDATE SET title = EXCLUDED.title, category = EXCLUDED.category, priority = EXCLUDED.priority, due_date = EXCLUDED.due_date, notes = EXCLUDED.notes, completed = EXCLUDED.completed, updated_at = EXCLUDED.updated_at RETURNING id, title, category, priority, due_date, notes, completed, created_at",
      [task.id, workspace, task.title, task.category, task.priority, task.dueDate || null, task.notes, task.completed, task.createdAt],
    );
    return sendJson(response, 201, { task: rowToTask(result.rows[0]) });
  }

  if ((request.method === "PATCH" || request.method === "DELETE") && parts.length === 3 && parts[1] === "tasks") {
    if (!idPattern.test(taskId)) return sendJson(response, 400, { error: "ID tugas tidak valid" });
    const workspace = getWorkspaceCode(request.url);
    if (!workspace) return sendJson(response, 400, { error: "Kode ruang kerja tidak valid" });
    if (request.method === "DELETE") {
      const result = await pool.query("DELETE FROM focusboard_tasks WHERE id = $1 AND workspace_code = $2 RETURNING id", [taskId, workspace]);
      if (!result.rowCount) return sendJson(response, 404, { error: "Tugas tidak ditemukan" });
      return sendJson(response, 200, { deleted: taskId });
    }
    const payload = await readJson(request);
    const existing = await pool.query("SELECT id, title, category, priority, due_date, notes, completed, created_at FROM focusboard_tasks WHERE id = $1 AND workspace_code = $2", [taskId, workspace]);
    if (!existing.rowCount) return sendJson(response, 404, { error: "Tugas tidak ditemukan" });
    const current = rowToTask(existing.rows[0]);
    const task = normalizeTask({ ...current, ...payload.task, id: taskId }, { requireId: true });
    const result = await pool.query(
      "UPDATE focusboard_tasks SET title = $1, category = $2, priority = $3, due_date = $4, notes = $5, completed = $6, updated_at = $7 WHERE id = $8 AND workspace_code = $9 RETURNING id, title, category, priority, due_date, notes, completed, created_at",
      [task.title, task.category, task.priority, task.dueDate || null, task.notes, task.completed, Date.now(), taskId, workspace],
    );
    return sendJson(response, 200, { task: rowToTask(result.rows[0]) });
  }

  return sendJson(response, 404, { error: "Endpoint tidak ditemukan" });
}

async function serveStatic(request, response, url) {
  const requestedPath = url.pathname === "/" ? "/index.html" : url.pathname;
  const filePath = path.resolve(ROOT, `.${requestedPath}`);
  if (!filePath.startsWith(ROOT) || filePath.includes(`${path.sep}.`)) {
    response.writeHead(403);
    return response.end("Forbidden");
  }
  try {
    const file = await readFile(filePath);
    response.writeHead(200, {
      "Content-Type": mimeTypes[path.extname(filePath)] || "application/octet-stream",
      "Cache-Control": "no-cache",
    });
    response.end(file);
  } catch {
    response.writeHead(404);
    response.end("Not found");
  }
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
  try {
    if (url.pathname.startsWith("/api/")) await handleApi(request, response, url);
    else await serveStatic(request, response, url);
  } catch (error) {
    console.error(error);
    sendJson(response, 500, { error: "Terjadi kesalahan pada server" });
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`FocusBoard server listening on 0.0.0.0:${PORT}`);
});

async function shutdown() {
  await pool.end();
  server.close(() => process.exit(0));
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);