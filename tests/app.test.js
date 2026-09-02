import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";
import {
  addDays as addDaysForDate,
  APP_TIME_ZONE,
  dateKeyInTimeZone,
  filterTasks as filterTasksForDate,
  isOverdue as isOverdueForDate,
  isToday as isTodayForDate,
  parseStoredTasks,
} from "../task-utils.js";

const appSource = readFileSync(new URL("../app.js", import.meta.url), "utf8").replace(/^import .+;\n/, "");
const STORAGE_KEY = "focusboard.tasks.v2";

class FakeElement {
  constructor(id = "") {
    this.id = id;
    this.value = "";
    this.textContent = "";
    this.innerHTML = "";
    this.hidden = false;
    this.style = {};
    this.dataset = {};
    this.handlers = {};
    this.classList = { toggle() {} };
  }

  addEventListener(type, handler) {
    (this.handlers[type] ||= []).push(handler);
  }

  async dispatch(type, event = {}) {
    const dispatchedEvent = {
      target: this,
      preventDefault() {},
      ...event,
    };
    await Promise.all((this.handlers[type] || []).map((handler) => handler(dispatchedEvent)));
  }

  focus() {}
}

class FakeDocument {
  constructor() {
    this.body = { style: {} };
    this.elements = new Map();
    this.navItems = ["dashboard", "all", "active", "completed"].map((view) => {
      const element = new FakeElement();
      element.dataset.view = view;
      return element;
    });
    this.categoryNavItems = ["Kerja", "Pribadi", "Belajar", "Keuangan"].map((category) => {
      const element = new FakeElement();
      element.dataset.category = category;
      return element;
    });
    this.categoryCounts = new Map();

    [
      "currentDate", "todayLabel", "statTotal", "statCompleted", "statToday", "statOverdue",
      "completedHelper", "allCount", "activeCount", "completedCount", "sidebarProgress",
      "sidebarProgressBar", "sidebarProgressText", "focusPercent", "focusDone", "focusMessage",
      "focusRing", "categoryBars", "breadcrumbCurrent", "taskSectionTitle", "searchInput",
      "categoryFilter", "priorityFilter", "dateFilter", "taskList", "addTaskButton",
      "quickAddButton", "taskForm", "closeModalButton", "cancelModalButton", "taskModal",
      "clearCompletedButton", "modalTitle", "saveTaskButton", "taskId", "taskTitle",
      "taskCategory", "taskPriority", "taskDueDate", "taskNotes", "syncDot",
      "workspaceCodeLabel", "syncNotice", "workspaceButton", "workspaceForm",
      "closeWorkspaceButton", "cancelWorkspaceButton", "workspaceModal", "workspaceCodeInput",
    ].forEach((id) => this.elements.set(`#${id}`, new FakeElement(id)));

    this.elements.get("#taskModal").hidden = true;
    this.elements.get("#workspaceModal").hidden = true;
    this.elements.get("#syncNotice").hidden = true;
    this.elements.get("#categoryFilter").value = "all";
    this.elements.get("#priorityFilter").value = "all";
    this.elements.get("#dateFilter").value = "all";
  }

  querySelector(selector) {
    const categoryMatch = selector.match(/^\[data-category-count="(.+)"\]$/);
    if (categoryMatch) {
      if (!this.categoryCounts.has(categoryMatch[1])) {
        this.categoryCounts.set(categoryMatch[1], new FakeElement());
      }
      return this.categoryCounts.get(categoryMatch[1]);
    }
    return this.elements.get(selector);
  }

  querySelectorAll(selector) {
    if (selector === ".nav-item") return this.navItems;
    if (selector === ".category-nav-item") return this.categoryNavItems;
    return [];
  }

  addEventListener() {}
}

async function createApp(storedValue = "[]", now = "2026-09-02T00:00:00.000Z") {
  const document = new FakeDocument();
  const currentDate = dateKeyInTimeZone(now);
  const values = new Map([[STORAGE_KEY, storedValue]]);
  const storage = {
    get value() {
      return values.get(STORAGE_KEY);
    },
    getItem(key) {
      return values.get(key) ?? null;
    },
    setItem(key, value) {
      values.set(key, value);
    },
  };
  const serverTasks = [];
  const confirms = [];
  const RealDate = Date;
  class TestDate extends RealDate {
    constructor(...args) {
      super(...(args.length ? args : [now]));
    }

    static now() {
      return new RealDate(now).getTime();
    }
  }

  const context = vm.createContext({
    addDays(days) {
      return addDaysForDate(days, currentDate);
    },
    APP_TIME_ZONE,
    Array,
    Date: TestDate,
    filterTasks(taskList, options) {
      return filterTasksForDate(taskList, { ...options, currentDate });
    },
    Intl,
    isOverdue(task) {
      return isOverdueForDate(task, currentDate);
    },
    isToday(task) {
      return isTodayForDate(task, currentDate);
    },
    JSON,
    Math,
    Number,
    Object,
    RegExp,
    Set,
    String,
    clearTimeout,
    console: { warn() {} },
    document,
    async fetch(path, options = {}) {
      const method = options.method || "GET";
      const pathname = String(path).split("?")[0];
      let payload;
      if (pathname === "/api/tasks" && method === "GET") {
        payload = { tasks: serverTasks.map((task) => ({ ...task })) };
      } else if (pathname === "/api/tasks" && method === "POST") {
        const body = JSON.parse(options.body);
        serverTasks.push({ ...body.task });
        payload = { task: { ...body.task } };
      } else {
        const id = decodeURIComponent(pathname.slice("/api/tasks/".length));
        const index = serverTasks.findIndex((task) => task.id === id);
        if (method === "PATCH") {
          const body = JSON.parse(options.body);
          serverTasks[index] = { ...serverTasks[index], ...body.task };
          payload = { task: { ...serverTasks[index] } };
        } else {
          if (index >= 0) serverTasks.splice(index, 1);
          payload = {};
        }
      }
      return { ok: true, async json() { return payload; } };
    },
    localStorage: storage,
    parseStoredTasks,
    setTimeout(callback) {
      callback();
    },
    today() {
      return currentDate;
    },
    window: {
      clearTimeout,
      confirm(message) {
        confirms.push(message);
        return true;
      },
      setTimeout,
    },
  });
  vm.runInContext(appSource, context);
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  return { context, document, storage, confirms };
}

function tasksFrom(app) {
  return JSON.parse(JSON.stringify(vm.runInContext("tasks", app.context)));
}

function action(action, id) {
  return { closest: () => ({ dataset: { action, id } }) };
}

test("CRUD keeps task data and persists each mutation", async () => {
  const app = await createApp();
  const { document } = app;
  const modal = document.querySelector("#taskModal");
  const form = document.querySelector("#taskForm");
  const taskList = document.querySelector("#taskList");

  await document.querySelector("#addTaskButton").dispatch("click");
  assert.equal(modal.hidden, false);
  document.querySelector("#taskTitle").value = "Rancang laporan";
  document.querySelector("#taskCategory").value = "Belajar";
  document.querySelector("#taskPriority").value = "high";
  document.querySelector("#taskDueDate").value = "2026-09-04";
  document.querySelector("#taskNotes").value = "Gunakan data terbaru";
  await form.dispatch("submit");

  let [task] = tasksFrom(app);
  assert.deepEqual(
    { title: task.title, category: task.category, priority: task.priority, dueDate: task.dueDate, notes: task.notes },
    {
      title: "Rancang laporan",
      category: "Belajar",
      priority: "high",
      dueDate: "2026-09-04",
      notes: "Gunakan data terbaru",
    },
  );
  assert.equal(JSON.parse(app.storage.value).length, 1);

  await taskList.dispatch("click", { target: action("toggle", task.id) });
  assert.equal(tasksFrom(app)[0].completed, true);

  await taskList.dispatch("click", { target: action("edit", task.id) });
  assert.equal(modal.hidden, false);
  document.querySelector("#taskTitle").value = "Rancang laporan final";
  await form.dispatch("submit");
  task = tasksFrom(app)[0];
  assert.equal(task.title, "Rancang laporan final");
  assert.equal(task.completed, true);

  await taskList.dispatch("click", { target: action("delete", task.id) });
  assert.deepEqual(tasksFrom(app), []);
  assert.deepEqual(JSON.parse(app.storage.value), []);
});

test("status, category, priority, date, and search filters do not lose tasks", async () => {
  const storedTasks = [
    { id: "today-work", title: "Rapat klien", category: "Kerja", priority: "high", dueDate: "2026-09-02", notes: "Ruang rapat A", completed: false, createdAt: 1 },
    { id: "tomorrow-study", title: "Baca laporan", category: "Belajar", priority: "low", dueDate: "2026-09-03", notes: "", completed: false, createdAt: 2 },
    { id: "next-week-finance", title: "Cek invoice", category: "Keuangan", priority: "medium", dueDate: "2026-09-09", notes: "", completed: false, createdAt: 3 },
    { id: "overdue-personal", title: "Telepon dokter", category: "Pribadi", priority: "medium", dueDate: "2026-09-01", notes: "Pagi", completed: false, createdAt: 4 },
    { id: "done-today", title: "Kirim ringkasan", category: "Kerja", priority: "medium", dueDate: "2026-09-02", notes: "", completed: true, createdAt: 5 },
    { id: "no-deadline", title: "Rapikan catatan", category: "Belajar", priority: "low", dueDate: "", notes: "arsip", completed: false, createdAt: 6 },
  ];
  const app = await createApp(JSON.stringify(storedTasks));
  const { context, document } = app;
  const filteredIds = () => JSON.parse(JSON.stringify(vm.runInContext("getFilteredTasks().map((task) => task.id)", context)));

  assert.deepEqual(filteredIds(), ["overdue-personal", "today-work", "tomorrow-study", "next-week-finance", "no-deadline", "done-today"]);

  document.querySelector("#categoryFilter").value = "Kerja";
  document.querySelector("#categoryFilter").dispatch("change");
  assert.deepEqual(filteredIds(), ["today-work", "done-today"]);

  document.querySelector("#categoryFilter").value = "all";
  document.querySelector("#priorityFilter").value = "low";
  document.querySelector("#priorityFilter").dispatch("change");
  assert.deepEqual(filteredIds(), ["tomorrow-study", "no-deadline"]);

  document.querySelector("#priorityFilter").value = "all";
  document.querySelector("#dateFilter").value = "today";
  document.querySelector("#dateFilter").dispatch("change");
  assert.deepEqual(filteredIds(), ["today-work", "done-today"]);

  document.querySelector("#dateFilter").value = "week";
  document.querySelector("#dateFilter").dispatch("change");
  assert.deepEqual(filteredIds(), ["today-work", "tomorrow-study", "next-week-finance", "done-today"]);

  document.querySelector("#dateFilter").value = "overdue";
  document.querySelector("#dateFilter").dispatch("change");
  assert.deepEqual(filteredIds(), ["overdue-personal"]);

  document.querySelector("#dateFilter").value = "all";
  document.querySelector("#searchInput").value = "ARSIP";
  document.querySelector("#searchInput").dispatch("input");
  assert.deepEqual(filteredIds(), ["no-deadline"]);

  document.querySelector("#searchInput").value = "";
  document.querySelector("#searchInput").dispatch("input");
  document.navItems?.[2]?.dispatch("click");
  assert.deepEqual(filteredIds(), ["overdue-personal", "today-work", "tomorrow-study", "next-week-finance", "no-deadline"]);
  document.navItems?.[3]?.dispatch("click");
  assert.deepEqual(filteredIds(), ["done-today"]);
});

test("invalid localStorage falls back safely and valid records survive partial corruption", async () => {
  const invalidJson = await createApp("{not-json");
  assert.equal(tasksFrom(invalidJson).length, 6);

  const partiallyCorrupt = await createApp(JSON.stringify([
    { id: "kept", title: "Tugas tetap ada", category: "unknown", priority: "broken", dueDate: "2026-99-99", notes: null, completed: "yes", createdAt: 0 },
    null,
    { title: "" },
  ]));
  assert.deepEqual(tasksFrom(partiallyCorrupt), [{
    id: "kept",
    title: "Tugas tetap ada",
    category: "Kerja",
    priority: "medium",
    dueDate: "",
    notes: "",
    completed: false,
    createdAt: 0,
  }]);

  const empty = await createApp("[]");
  assert.deepEqual(tasksFrom(empty), []);
});

test("today and overdue calculations use the Asia/Bangkok calendar date", () => {
  assert.equal(dateKeyInTimeZone("2026-09-02T16:59:59.000Z"), "2026-09-02");
  assert.equal(dateKeyInTimeZone("2026-09-02T17:00:00.000Z"), "2026-09-03");
  assert.equal(isOverdueForDate({ dueDate: "2026-09-01", completed: false }, "2026-09-02"), true);
  assert.equal(isOverdueForDate({ dueDate: "2026-09-02", completed: true }, "2026-09-02"), false);
  assert.equal(isTodayForDate({ dueDate: "2026-09-02" }, "2026-09-02"), true);
});