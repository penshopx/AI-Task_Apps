import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import { Pool } from "pg";
import { clerkMiddleware, getAuth } from "@clerk/express";
import { publishableKeyFromHost } from "@clerk/shared/keys";
import {
  CLERK_PROXY_PATH,
  clerkProxyMiddleware,
  getClerkProxyHost,
} from "./server/middlewares/clerkProxyMiddleware.js";

const PORT = Number(process.env.PORT || 5000);
const ROOT = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const allowedCategories = new Set(["Kerja", "Pribadi", "Belajar", "Keuangan"]);
const allowedPriorities = new Set(["high", "medium", "low"]);
const idPattern = /^[a-zA-Z0-9_-]{6,80}$/;

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".jpg": "image/jpeg",
  ".png": "image/png",
};

function normalizeTask(task, { requireId = false } = {}) {
  const normalized = {
    id: typeof task?.id === "string" ? task.id.trim() : "",
    title: typeof task?.title === "string" ? task.title.trim() : "",
    category: task?.category,
    priority: task?.priority,
    dueDate: task?.dueDate || null,
    notes: typeof task?.notes === "string" ? task.notes.trim().slice(0, 240) : "",
    completed: Boolean(task?.completed),
    createdAt: Number.isFinite(Number(task?.createdAt)) ? Number(task.createdAt) : Date.now(),
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

function requireAuth(request, response, next) {
  const { userId } = getAuth(request);
  if (!userId) return response.status(401).json({ error: "Silakan masuk untuk mengakses tugas." });
  request.userId = userId;
  next();
}

function sendError(response, error) {
  if (error instanceof SyntaxError) return response.status(400).json({ error: "Payload JSON tidak valid" });
  if (error.message === "Payload terlalu besar") return response.status(413).json({ error: error.message });
  if (error.message.endsWith("tidak valid") || error.message === "Judul tugas wajib diisi") {
    return response.status(400).json({ error: error.message });
  }
  console.error(error);
  return response.status(500).json({ error: "Terjadi kesalahan pada server" });
}

app.use(CLERK_PROXY_PATH, clerkProxyMiddleware());
app.use(clerkMiddleware((request) => ({
  publishableKey: publishableKeyFromHost(
    getClerkProxyHost(request) ?? "",
    process.env.CLERK_PUBLISHABLE_KEY,
  ),
})));
app.use("/api", (_request, response, next) => {
  response.setHeader("Cache-Control", "no-store");
  next();
});
app.use(express.json({ limit: "100kb" }));

app.get("/api/session", requireAuth, (request, response) => {
  response.json({ userId: request.userId });
});

app.get("/api/tasks", requireAuth, async (request, response) => {
  const result = await pool.query(
    "SELECT id, title, category, priority, due_date, notes, completed, created_at FROM focusboard_tasks WHERE user_id = $1 ORDER BY completed ASC, due_date ASC NULLS LAST, created_at DESC",
    [request.userId],
  );
  response.json({ tasks: result.rows.map(rowToTask) });
});

app.post("/api/tasks", requireAuth, async (request, response) => {
  const task = normalizeTask(request.body?.task);
  const result = await pool.query(
    "INSERT INTO focusboard_tasks (id, workspace_code, user_id, title, category, priority, due_date, notes, completed, created_at, updated_at) VALUES ($1, 'PERSONAL', $2, $3, $4, $5, $6, $7, $8, $9, $9) RETURNING id, title, category, priority, due_date, notes, completed, created_at",
    [task.id, request.userId, task.title, task.category, task.priority, task.dueDate || null, task.notes, task.completed, task.createdAt],
  );
  response.status(201).json({ task: rowToTask(result.rows[0]) });
});

app.patch("/api/tasks/:id", requireAuth, async (request, response) => {
  const { id } = request.params;
  if (!idPattern.test(id)) return response.status(400).json({ error: "ID tugas tidak valid" });
  const existing = await pool.query(
    "SELECT id, title, category, priority, due_date, notes, completed, created_at FROM focusboard_tasks WHERE id = $1 AND user_id = $2",
    [id, request.userId],
  );
  if (!existing.rowCount) return response.status(404).json({ error: "Tugas tidak ditemukan" });
  const current = rowToTask(existing.rows[0]);
  const task = normalizeTask({ ...current, ...request.body?.task, id }, { requireId: true });
  const result = await pool.query(
    "UPDATE focusboard_tasks SET title = $1, category = $2, priority = $3, due_date = $4, notes = $5, completed = $6, updated_at = $7 WHERE id = $8 AND user_id = $9 RETURNING id, title, category, priority, due_date, notes, completed, created_at",
    [task.title, task.category, task.priority, task.dueDate || null, task.notes, task.completed, Date.now(), id, request.userId],
  );
  response.json({ task: rowToTask(result.rows[0]) });
});

app.delete("/api/tasks/:id", requireAuth, async (request, response) => {
  const { id } = request.params;
  if (!idPattern.test(id)) return response.status(400).json({ error: "ID tugas tidak valid" });
  const result = await pool.query(
    "DELETE FROM focusboard_tasks WHERE id = $1 AND user_id = $2 RETURNING id",
    [id, request.userId],
  );
  if (!result.rowCount) return response.status(404).json({ error: "Tugas tidak ditemukan" });
  response.json({ deleted: id });
});

async function sendIndex(response) {
  const html = await readFile(path.join(ROOT, "index.html"), "utf8");
  const publishableKey = process.env.VITE_CLERK_PUBLISHABLE_KEY || process.env.CLERK_PUBLISHABLE_KEY || "";
  const safeKey = publishableKey.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
  const clerkScript = process.env.NODE_ENV === "production"
    ? `${CLERK_PROXY_PATH}/clerk.browser.js`
    : "https://cdn.jsdelivr.net/npm/@clerk/clerk-js@5/dist/clerk.browser.js";
  const clerkProxyUrl = process.env.NODE_ENV === "production" ? CLERK_PROXY_PATH : "";
  response.type("html").send(html
    .replace("__CLERK_PUBLISHABLE_KEY__", safeKey)
    .replace("__CLERK_SCRIPT_URL__", clerkScript)
    .replace("__CLERK_PROXY_URL__", clerkProxyUrl));
}

app.get("/", async (_request, response) => {
  try {
    await sendIndex(response);
  } catch (error) {
    sendError(response, error);
  }
});

app.get("/index.html", async (_request, response) => {
  try {
    await sendIndex(response);
  } catch (error) {
    sendError(response, error);
  }
});

app.use(express.static(ROOT, {
  index: false,
  setHeaders(response) {
    response.setHeader("Cache-Control", "no-cache");
  },
  fallthrough: true,
}));

app.use((error, _request, response, _next) => sendError(response, error));

async function verifyDatabaseSchema() {
  const result = await pool.query(
    "SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'focusboard_tasks' AND column_name = 'user_id'",
  );
  if (!result.rowCount) {
    throw new Error("Database belum memiliki kolom focusboard_tasks.user_id.");
  }
}

await verifyDatabaseSchema();

const server = app.listen(PORT, "0.0.0.0", () => {
  console.log(`FocusBoard server listening on 0.0.0.0:${PORT}`);
});

async function shutdown() {
  await pool.end();
  server.close(() => process.exit(0));
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);