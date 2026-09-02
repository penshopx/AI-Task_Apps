import { addDays, APP_TIME_ZONE, filterTasks, isOverdue, isToday, parseStoredTasks, today } from "./task-utils.js";

const STORAGE_KEY = "focusboard.tasks.v2";
const WORKSPACE_KEY = "focusboard.workspace.v1";
const MIGRATION_KEY = "focusboard.workspace.migrated.v1";
const CATEGORY_CLASS = { Kerja: "work", Pribadi: "personal", Belajar: "learning", Keuangan: "finance" };
const PRIORITY_LABEL = { high: "Tinggi", medium: "Sedang", low: "Rendah" };
const CATEGORY_NAMES = ["Kerja", "Pribadi", "Belajar", "Keuangan"];

const seedTasks = [
  { id: "seed-1", title: "Finalisasi proposal klien", category: "Kerja", priority: "high", dueDate: addDays(0), notes: "Periksa angka dan lampiran sebelum dikirim.", completed: false, createdAt: Date.now() - 8400000 },
  { id: "seed-2", title: "Jadwalkan review sprint", category: "Kerja", priority: "medium", dueDate: addDays(1), notes: "", completed: false, createdAt: Date.now() - 7200000 },
  { id: "seed-3", title: "Baca 20 halaman buku", category: "Pribadi", priority: "low", dueDate: addDays(2), notes: "", completed: false, createdAt: Date.now() - 6200000 },
  { id: "seed-4", title: "Perbarui portfolio", category: "Belajar", priority: "high", dueDate: addDays(4), notes: "Tambahkan studi kasus terbaru.", completed: false, createdAt: Date.now() - 5100000 },
  { id: "seed-5", title: "Bayar langganan hosting", category: "Keuangan", priority: "medium", dueDate: addDays(-1), notes: "", completed: false, createdAt: Date.now() - 4100000 },
  { id: "seed-6", title: "Rancang flow onboarding", category: "Kerja", priority: "medium", dueDate: addDays(0), notes: "", completed: true, createdAt: Date.now() - 12400000 },
];

function createWorkspaceCode() {
  return `RUANG-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
}

function loadWorkspaceCode() {
  const stored = localStorage.getItem(WORKSPACE_KEY);
  if (stored && /^[A-Za-z0-9-]{4,32}$/.test(stored)) return stored.toUpperCase();
  const created = createWorkspaceCode();
  localStorage.setItem(WORKSPACE_KEY, created);
  return created;
}

let workspaceCode = loadWorkspaceCode();
let tasks = loadTasks();
let activeView = "dashboard";
let editingTaskId = null;
let canMigrateLocal = localStorage.getItem(MIGRATION_KEY) !== workspaceCode;

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));

function loadTasks() {
  return parseStoredTasks(localStorage.getItem(STORAGE_KEY), seedTasks).map((task) => ({
    ...task,
    dueDate: typeof task.dueDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(task.dueDate) ? task.dueDate : "",
  }));
}

function saveTasks() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
  } catch (error) {
    console.warn("Perubahan tidak dapat disimpan di browser.", error);
  }
}

function setSyncStatus(state, message) {
  const dot = $("#syncDot");
  const copy = $("#workspaceCodeLabel");
  if (copy) copy.textContent = workspaceCode;
  if (!dot) return;
  dot.className = state;
  dot.title = message;
}

function setNotice(message, state = "error") {
  const notice = $("#syncNotice");
  if (!notice) return;
  notice.textContent = message;
  notice.className = `sync-notice ${state}`;
  notice.hidden = false;
  window.clearTimeout(setNotice.timeout);
  setNotice.timeout = window.setTimeout(() => { notice.hidden = true; }, 4500);
}

async function apiRequest(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || "Tidak dapat terhubung ke server");
  return payload;
}

async function syncWorkspace({ migrateLocal = false } = {}) {
  setSyncStatus("syncing", "Menyinkronkan tugas...");
  try {
    const params = `?workspace=${encodeURIComponent(workspaceCode)}`;
    const payload = await apiRequest(`/api/tasks${params}`);
    if (migrateLocal && tasks.length) {
      for (const task of tasks) {
        await apiRequest("/api/tasks", {
          method: "POST",
          body: JSON.stringify({ workspaceCode, task }),
        });
      }
      const refreshed = await apiRequest(`/api/tasks${params}`);
      tasks = refreshed.tasks;
    } else {
      tasks = payload.tasks;
    }
    canMigrateLocal = false;
    localStorage.setItem(MIGRATION_KEY, workspaceCode);
    saveTasks();
    setSyncStatus("synced", "Tugas tersinkron");
    render();
    return true;
  } catch (error) {
    setSyncStatus("error", "Sinkronisasi gagal");
    setNotice(`Sinkronisasi gagal: ${error.message}. Perubahan belum dikirim.`, "error");
    return false;
  }
}

function escapeHtml(value = "") {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;",
  }[character]));
}

function formatDate(dateString) {
  if (!dateString) return "Tanpa deadline";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateString)) return "Deadline belum valid";
  const date = new Date(`${dateString}T12:00:00`);
  if (Number.isNaN(date.getTime())) return "Deadline belum valid";
  return new Intl.DateTimeFormat("id-ID", { day: "numeric", month: "short" }).format(date);
}

function getFilteredTasks() {
  return filterTasks(tasks, {
    view: activeView,
    search: $("#searchInput").value,
    category: $("#categoryFilter").value,
    priority: $("#priorityFilter").value,
    date: $("#dateFilter").value,
  });
}

function renderDate() {
  const date = new Date();
  const longDate = new Intl.DateTimeFormat("id-ID", { timeZone: APP_TIME_ZONE, weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(date);
  $("#currentDate").textContent = longDate;
  $("#todayLabel").textContent = longDate.toUpperCase();
}

function renderStats() {
  const total = tasks.length;
  const completed = tasks.filter((task) => task.completed).length;
  const dueToday = tasks.filter((task) => isToday(task) && !task.completed).length;
  const overdue = tasks.filter(isOverdue).length;
  const percent = total ? Math.round((completed / total) * 100) : 0;
  $("#statTotal").textContent = total;
  $("#statCompleted").textContent = completed;
  $("#statToday").textContent = dueToday;
  $("#statOverdue").textContent = overdue;
  $("#completedHelper").textContent = `${percent}% dari total tugas`;
  $("#allCount").textContent = total;
  $("#activeCount").textContent = total - completed;
  $("#completedCount").textContent = completed;
  $("#sidebarProgress").textContent = `${percent}%`;
  $("#sidebarProgressBar").style.width = `${percent}%`;
  $("#sidebarProgressText").textContent = percent >= 100 ? "Semua tugas terselesaikan." : `${completed} selesai dari ${total} tugas saat ini.`;
  CATEGORY_NAMES.forEach((category) => {
    $(`[data-category-count="${category}"]`).textContent = tasks.filter((task) => task.category === category && !task.completed).length;
  });
}

function renderFocus() {
  const dueToday = tasks.filter((task) => isToday(task));
  const done = dueToday.filter((task) => task.completed).length;
  const percent = dueToday.length ? Math.round((done / dueToday.length) * 100) : 0;
  $("#focusPercent").textContent = `${percent}%`;
  $("#focusDone").textContent = `${done} dari ${dueToday.length}`;
  $("#focusMessage").textContent = dueToday.length === 0
    ? "Tidak ada deadline hari ini. Ruang untuk berpikir."
    : percent === 100 ? "Selesai. Nikmati ritme yang sudah terjaga." : "Selesaikan satu hal penting berikutnya.";
  $("#focusRing").style.background = `conic-gradient(#4b91ff ${percent * 3.6}deg, #29415e 0deg)`;
}

function renderCategoryBars() {
  const total = tasks.length || 1;
  $("#categoryBars").innerHTML = CATEGORY_NAMES.map((category) => {
    const count = tasks.filter((task) => task.category === category).length;
    const percent = Math.round((count / total) * 100);
    return `<div class="category-row">
      <div class="category-row-top"><span>${category}</span><strong>${count} tugas</strong></div>
      <div class="category-row-track"><span style="width: ${percent}%"></span></div>
    </div>`;
  }).join("");
}

function renderTasks() {
  const list = $("#taskList");
  const filteredTasks = getFilteredTasks();
  if (!filteredTasks.length) {
    const hasFilters = $("#searchInput").value || $("#categoryFilter").value !== "all" || $("#priorityFilter").value !== "all" || $("#dateFilter").value !== "all" || activeView !== "dashboard";
    list.innerHTML = `<div class="empty-state">
      <div class="empty-icon"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 6h13M8 12h13M8 18h13"></path><path d="M3 6h.01M3 12h.01M3 18h.01"></path></svg></div>
      <h3>${hasFilters ? "Tidak ada tugas yang cocok" : "Ruang kerja masih kosong"}</h3>
      <p>${hasFilters ? "Coba ubah filter atau kata pencarian Anda." : "Tambahkan tugas pertama untuk mulai membangun momentum."}</p>
      ${hasFilters ? "" : '<button class="primary-button" type="button" data-action="add">Tambah tugas pertama</button>'}
    </div>`;
    return;
  }
  list.innerHTML = filteredTasks.map((task, index) => {
    const dueClass = isOverdue(task) ? "is-overdue" : isToday(task) ? "is-today" : "";
    const dueText = isOverdue(task) ? `Terlambat · ${formatDate(task.dueDate)}` : isToday(task) ? "Hari ini" : formatDate(task.dueDate);
    return `<article class="task-item ${task.completed ? "is-completed" : ""}" style="animation-delay:${index * 35}ms">
      <button class="task-check" type="button" data-action="toggle" data-id="${escapeHtml(task.id)}" aria-label="${task.completed ? "Tandai belum selesai" : "Tandai selesai"}">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 4.5 4.5L19 7"></path></svg>
      </button>
      <div class="task-content">
        <span class="task-title" title="${escapeHtml(task.title)}">${escapeHtml(task.title)}</span>
        <div class="task-meta">
          <span class="task-category ${CATEGORY_CLASS[task.category]}">${escapeHtml(task.category)}</span>
          <span class="task-meta-separator">•</span>
          <span class="priority-pill ${escapeHtml(task.priority)}">${PRIORITY_LABEL[task.priority]}</span>
          <span class="task-meta-separator">•</span>
          <span class="due-date ${dueClass}"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="5" width="16" height="15" rx="2"></rect><path d="M8 3v4M16 3v4M4 10h16"></path></svg>${dueText}</span>
        </div>
      </div>
      <div class="task-actions">
        <button class="icon-button" type="button" data-action="edit" data-id="${escapeHtml(task.id)}" aria-label="Edit ${escapeHtml(task.title)}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m4 16-.7 4.7L8 20l11.6-11.6a2.1 2.1 0 0 0-3-3L5 17"></path><path d="m14.5 6.5 3 3"></path></svg></button>
        <button class="icon-button" type="button" data-action="delete" data-id="${escapeHtml(task.id)}" aria-label="Hapus ${escapeHtml(task.title)}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M10 11v5M14 11v5M6 7l1 13h10l1-13M9 7V4h6v3"></path></svg></button>
      </div>
    </article>`;
  }).join("");
}

function updateSectionLabels() {
  const labels = { dashboard: ["Ringkasan", "Semua tugas"], all: ["Semua tugas", "Semua tugas"], active: ["Belum selesai", "Belum selesai"], completed: ["Selesai", "Tugas selesai"] };
  const [breadcrumb, title] = labels[activeView];
  $("#breadcrumbCurrent").textContent = breadcrumb;
  $("#taskSectionTitle").textContent = title;
  $$(".nav-item").forEach((button) => button.classList.toggle("is-active", button.dataset.view === activeView));
}

function render() {
  renderDate();
  renderStats();
  renderFocus();
  renderCategoryBars();
  updateSectionLabels();
  renderTasks();
  if ($("#workspaceCodeLabel")) $("#workspaceCodeLabel").textContent = workspaceCode;
}

function openWorkspaceModal() {
  $("#workspaceCodeInput").value = workspaceCode;
  $("#workspaceModal").hidden = false;
  document.body.style.overflow = "hidden";
  setTimeout(() => $("#workspaceCodeInput").focus(), 50);
}

function closeWorkspaceModal() {
  $("#workspaceModal").hidden = true;
  document.body.style.overflow = "";
}

async function submitWorkspace(event) {
  event.preventDefault();
  const nextCode = $("#workspaceCodeInput").value.trim().toUpperCase();
  if (!/^[A-Z0-9-]{4,32}$/.test(nextCode)) return;
  if (nextCode === workspaceCode) {
    closeWorkspaceModal();
    return;
  }
  const previousCode = workspaceCode;
  const previousTasks = tasks;
  workspaceCode = nextCode;
  localStorage.setItem(WORKSPACE_KEY, workspaceCode);
  canMigrateLocal = false;
  tasks = [];
  closeWorkspaceModal();
  render();
  const connected = await syncWorkspace();
  if (!connected) {
    workspaceCode = previousCode;
    localStorage.setItem(WORKSPACE_KEY, previousCode);
    tasks = previousTasks;
    render();
  }
}

function openModal(task = null) {
  editingTaskId = task?.id || null;
  $("#modalTitle").textContent = task ? "Edit tugas" : "Tambah tugas baru";
  $("#saveTaskButton").textContent = task ? "Simpan perubahan" : "Simpan tugas";
  $("#taskId").value = task?.id || "";
  $("#taskTitle").value = task?.title || "";
  $("#taskCategory").value = task?.category || "Kerja";
  $("#taskPriority").value = task?.priority || "medium";
  $("#taskDueDate").value = task?.dueDate || today();
  $("#taskNotes").value = task?.notes || "";
  $("#taskModal").hidden = false;
  document.body.style.overflow = "hidden";
  setTimeout(() => $("#taskTitle").focus(), 50);
}

function closeModal() {
  $("#taskModal").hidden = true;
  document.body.style.overflow = "";
  editingTaskId = null;
}

async function submitTask(event) {
  event.preventDefault();
  const taskData = {
    title: $("#taskTitle").value.trim(),
    category: $("#taskCategory").value,
    priority: $("#taskPriority").value,
    dueDate: $("#taskDueDate").value,
    notes: $("#taskNotes").value.trim(),
  };
  if (!taskData.title) return;
  try {
    if (editingTaskId) {
      const saved = await apiRequest(`/api/tasks/${encodeURIComponent(editingTaskId)}?workspace=${encodeURIComponent(workspaceCode)}`, {
        method: "PATCH",
        body: JSON.stringify({ task: taskData }),
      });
      tasks = tasks.map((task) => task.id === editingTaskId ? saved.task : task);
    } else {
      const task = { ...taskData, id: `task-${Date.now()}`, completed: false, createdAt: Date.now() };
      const saved = await apiRequest("/api/tasks", {
        method: "POST",
        body: JSON.stringify({ workspaceCode, task }),
      });
      tasks.push(saved.task);
    }
  } catch (error) {
    setSyncStatus("error", "Perubahan belum tersimpan");
    setNotice(`Perubahan belum tersimpan: ${error.message}`, "error");
    return;
  }
  saveTasks();
  setSyncStatus("synced", "Tugas tersinkron");
  closeModal();
  render();
}

async function deleteTask(id) {
  const task = tasks.find((item) => item.id === id);
  if (!task || !window.confirm(`Hapus tugas "${task.title}"?`)) return;
  try {
    await apiRequest(`/api/tasks/${encodeURIComponent(id)}?workspace=${encodeURIComponent(workspaceCode)}`, { method: "DELETE" });
    tasks = tasks.filter((item) => item.id !== id);
  } catch (error) {
    setSyncStatus("error", "Tugas belum terhapus");
    setNotice(`Tugas belum terhapus: ${error.message}`, "error");
    return;
  }
  saveTasks();
  setSyncStatus("synced", "Tugas tersinkron");
  render();
}

async function handleTaskAction(event) {
  const actionButton = event.target.closest("[data-action]");
  if (!actionButton) return;
  const { action, id } = actionButton.dataset;
  if (action === "add") openModal();
  if (action === "toggle") {
    const current = tasks.find((task) => task.id === id);
    if (!current) return;
    try {
      const saved = await apiRequest(`/api/tasks/${encodeURIComponent(id)}?workspace=${encodeURIComponent(workspaceCode)}`, {
        method: "PATCH",
        body: JSON.stringify({ task: { ...current, completed: !current.completed } }),
      });
      tasks = tasks.map((task) => task.id === id ? saved.task : task);
    } catch (error) {
      setSyncStatus("error", "Status belum tersimpan");
      setNotice(`Status belum tersimpan: ${error.message}`, "error");
      return;
    }
    saveTasks();
    setSyncStatus("synced", "Tugas tersinkron");
    render();
  }
  if (action === "edit") openModal(tasks.find((task) => task.id === id));
  if (action === "delete") deleteTask(id);
}

$$(".nav-item").forEach((button) => button.addEventListener("click", () => {
  activeView = button.dataset.view;
  render();
}));

$$(".category-nav-item").forEach((button) => button.addEventListener("click", () => {
  activeView = "all";
  $("#categoryFilter").value = button.dataset.category;
  render();
}));

["#searchInput", "#categoryFilter", "#priorityFilter", "#dateFilter"].forEach((selector) => $(selector).addEventListener("input", render));
$("#taskList").addEventListener("click", handleTaskAction);
$("#addTaskButton").addEventListener("click", () => openModal());
$("#quickAddButton").addEventListener("click", () => openModal());
$("#taskForm").addEventListener("submit", submitTask);
$("#closeModalButton").addEventListener("click", closeModal);
$("#cancelModalButton").addEventListener("click", closeModal);
$("#taskModal").addEventListener("click", (event) => { if (event.target === $("#taskModal")) closeModal(); });
$("#workspaceButton").addEventListener("click", openWorkspaceModal);
$("#workspaceForm").addEventListener("submit", submitWorkspace);
$("#closeWorkspaceButton").addEventListener("click", closeWorkspaceModal);
$("#cancelWorkspaceButton").addEventListener("click", closeWorkspaceModal);
$("#workspaceModal").addEventListener("click", (event) => { if (event.target === $("#workspaceModal")) closeWorkspaceModal(); });
document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  if (!$("#taskModal").hidden) closeModal();
  if (!$("#workspaceModal").hidden) closeWorkspaceModal();
});
$("#clearCompletedButton").addEventListener("click", async () => {
  if (!tasks.some((task) => task.completed)) return;
  if (window.confirm("Hapus semua tugas yang sudah selesai?")) {
    const completedTasks = tasks.filter((task) => task.completed);
    try {
      await Promise.all(completedTasks.map((task) => apiRequest(`/api/tasks/${encodeURIComponent(task.id)}?workspace=${encodeURIComponent(workspaceCode)}`, { method: "DELETE" })));
      tasks = tasks.filter((task) => !task.completed);
    } catch (error) {
      setSyncStatus("error", "Tugas selesai belum terhapus");
      setNotice(`Tugas selesai belum terhapus: ${error.message}`, "error");
      return;
    }
    saveTasks();
    setSyncStatus("synced", "Tugas tersinkron");
    render();
  }
});

render();
syncWorkspace({ migrateLocal: canMigrateLocal });