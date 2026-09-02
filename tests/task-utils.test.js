import test from "node:test";
import assert from "node:assert/strict";
import {
  addDays,
  dateKeyInTimeZone,
  filterTasks,
  isOverdue,
  isToday,
  isWithinNextWeek,
  parseStoredTasks,
} from "../task-utils.js";

const currentDate = "2026-09-03";
const tasks = [
  { id: "overdue", title: "Bayar hosting", category: "Keuangan", priority: "high", dueDate: "2026-09-02", completed: false, createdAt: 1 },
  { id: "today", title: "Kirim proposal", category: "Kerja", priority: "high", dueDate: currentDate, completed: false, createdAt: 2 },
  { id: "tomorrow", title: "Review sprint", category: "Kerja", priority: "medium", dueDate: "2026-09-04", completed: false, createdAt: 3 },
  { id: "later", title: "Baca buku", category: "Pribadi", priority: "low", dueDate: "2026-09-15", completed: false, createdAt: 4 },
  { id: "done", title: "Arsipkan invoice", category: "Keuangan", priority: "low", dueDate: currentDate, completed: true, createdAt: 5 },
];

test("tanggal mengikuti zona waktu Asia/Bangkok di sekitar pergantian hari", () => {
  assert.equal(dateKeyInTimeZone("2026-09-02T17:00:00Z"), "2026-09-03");
  assert.equal(dateKeyInTimeZone("2026-09-02T16:59:59Z"), "2026-09-02");
  assert.equal(addDays(7, currentDate), "2026-09-10");
});

test("status deadline membedakan terlambat, hari ini, dan minggu berjalan", () => {
  assert.equal(isOverdue(tasks[0], currentDate), true);
  assert.equal(isOverdue(tasks[1], currentDate), false);
  assert.equal(isToday(tasks[1], currentDate), true);
  assert.equal(isWithinNextWeek(tasks[2], currentDate), true);
  assert.equal(isWithinNextWeek(tasks[3], currentDate), false);
  assert.equal(isOverdue(tasks[4], currentDate), false);
});

test("filter status tidak mencampur tugas selesai dan belum selesai", () => {
  assert.deepEqual(filterTasks(tasks, { view: "active", currentDate }).map((task) => task.id), ["overdue", "today", "tomorrow", "later"]);
  assert.deepEqual(filterTasks(tasks, { view: "completed", currentDate }).map((task) => task.id), ["done"]);
});

test("filter kategori, prioritas, deadline, dan pencarian dapat digabung", () => {
  assert.deepEqual(filterTasks(tasks, { category: "Kerja", priority: "high", date: "today", currentDate }).map((task) => task.id), ["today"]);
  assert.deepEqual(filterTasks(tasks, { search: "invoice", currentDate }).map((task) => task.id), ["done"]);
  assert.deepEqual(filterTasks(tasks, { date: "overdue", currentDate }).map((task) => task.id), ["overdue"]);
  assert.deepEqual(filterTasks(tasks, { date: "week", currentDate }).map((task) => task.id), ["today", "tomorrow", "done"]);
});

test("hasil filter tidak memutasi daftar tugas asal dan mengurutkan yang terlambat lebih dulu", () => {
  const originalOrder = tasks.map((task) => task.id);
  const result = filterTasks(tasks, { currentDate });
  assert.deepEqual(tasks.map((task) => task.id), originalOrder);
  assert.equal(result[0].id, "overdue");
});

test("data localStorage valid dipulihkan dan data rusak kembali ke fallback", () => {
  const fallback = [{ id: "fallback" }];
  assert.deepEqual(parseStoredTasks(JSON.stringify(tasks), fallback), tasks);
  assert.deepEqual(parseStoredTasks("{not-json}", fallback), fallback);
  assert.deepEqual(parseStoredTasks(JSON.stringify({ tasks }), fallback), fallback);
  assert.deepEqual(parseStoredTasks("", fallback), fallback);
});