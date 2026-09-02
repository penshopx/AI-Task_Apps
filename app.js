import { APP_TIME_ZONE, filterTasks, isOverdue, isToday, parseStoredTasks, today } from "./task-utils.js";
import { isSameAuthenticatedUser } from "./auth-utils.js";

const LEGACY_STORAGE_KEY = "focusboard.tasks.v2";
const USER_STORAGE_PREFIX = "focusboard.tasks.user.";
const MIGRATION_PREFIX = "focusboard.account.migrated.";
const CATEGORY_CLASS = { Kerja: "work", Pribadi: "personal", Belajar: "learning", Keuangan: "finance" };
const PRIORITY_LABEL = { high: "Tinggi", medium: "Sedang", low: "Rendah" };
const CATEGORY_NAMES = ["Kerja", "Pribadi", "Belajar", "Keuangan"];
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));

let clerk;
let currentUser;
let tasks = [];
let activeView = "dashboard";
let editingTaskId = null;
let isLoadingTasks = false;
let authMode = "sign-in";
let authSequence = 0;

const clerkAppearance = {
  options: {
    logoPlacement: "inside",
    logoLinkUrl: "/",
    logoImageUrl: `${window.location.origin}/logo.svg`,
    socialButtonsPlacement: "bottom",
  },
  variables: {
    colorPrimary: "#3278f5",
    colorForeground: "#eaf2ff",
    colorMutedForeground: "#9bacbf",
    colorBackground: "#0d1b2d",
    colorInput: "#14253a",
    colorInputForeground: "#ffffff",
    colorDanger: "#ff7b80",
    colorNeutral: "#31445c",
    fontFamily: '"DM Sans", sans-serif',
    borderRadius: "10px",
  },
  elements: {
    rootBox: { width: "100%" },
    cardBox: { width: "100%", boxShadow: "none", background: "transparent" },
    card: { width: "100%", boxShadow: "none", background: "transparent", padding: 0 },
    header: { display: "none" },
    footer: { display: "none" },
    footerAction: { display: "none" },
    formButtonPrimary: { fontWeight: 700, minHeight: "44px" },
    formFieldLabel: { color: "#dce9f8" },
    formFieldInput: { color: "#ffffff", background: "#14253a", borderColor: "#31445c" },
    socialButtonsBlockButton: { color: "#eaf2ff", background: "#14253a", borderColor: "#31445c" },
    socialButtonsBlockButtonText: { color: "#eaf2ff", fontWeight: 600 },
    dividerText: { color: "#8295aa" },
    dividerLine: { background: "#31445c" },
    identityPreviewText: { color: "#eaf2ff" },
    identityPreviewEditButton: { color: "#77a9ff" },
    formFieldSuccessText: { color: "#6ee7b7" },
    alertText: { color: "#ffffff" },
    otpCodeFieldInput: { color: "#ffffff", background: "#14253a", borderColor: "#31445c" },
  },
};

function isValidDate(dateString) {
  if (!dateString || !DATE_PATTERN.test(dateString)) return false;
  const date = new Date(`${dateString}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === dateString;
}

function normalizeCachedTask(task, index, usedIds) {
  if (!task || typeof task !== "object" || Array.isArray(task)) return null;
  const title = typeof task.title === "string" ? task.title.trim() : "";
  if (!title) return null;
  let id = typeof task.id === "string" && task.id.trim() ? task.id : `restored-${index}-${Date.now()}`;
  while (usedIds.has(id)) id = `${id}-${index}`;
  return {
    id,
    title,
    category: CATEGORY_NAMES.includes(task.category) ? task.category : "Kerja",
    priority: Object.hasOwn(PRIORITY_LABEL, task.priority) ? task.priority : "medium",
    dueDate: task.dueDate === "" ? "" : isValidDate(task.dueDate) ? task.dueDate : "",
    notes: typeof task.notes === "string" ? task.notes.trim().slice(0, 240) : "",
    completed: task.completed === true,
    createdAt: Number.isFinite(Number(task.createdAt)) ? Number(task.createdAt) : Date.now() - index,
  };
}

function readTaskCache(key) {
  try {
    const parsed = parseStoredTasks(localStorage.getItem(key), []);
    const restored = [];
    const usedIds = new Set();
    parsed.forEach((task, index) => {
      const normalized = normalizeCachedTask(task, index, usedIds);
      if (normalized) {
        restored.push(normalized);
        usedIds.add(normalized.id);
      }
    });
    return restored;
  } catch (error) {
    console.warn("Cache tugas tidak dapat dibaca.", error);
    return [];
  }
}

function userCacheKey() {
  return `${USER_STORAGE_PREFIX}${currentUser?.id || "signed-out"}`;
}

function saveTaskCache() {
  if (!currentUser) return;
  try {
    localStorage.setItem(userCacheKey(), JSON.stringify(tasks));
  } catch (error) {
    console.warn("Cache tugas tidak dapat diperbarui.", error);
  }
}

function setSyncStatus(state, message) {
  const dot = $("#syncDot");
  const label = $("#syncStatusLabel");
  if (label) label.textContent = message;
  if (dot) {
    dot.className = state;
    dot.title = message;
  }
}

function setNotice(message, state = "error") {
  const notice = $("#syncNotice");
  notice.textContent = message;
  notice.className = `sync-notice ${state}`;
  notice.hidden = false;
  window.clearTimeout(setNotice.timeout);
  setNotice.timeout = window.setTimeout(() => { notice.hidden = true; }, 5000);
}

async function apiRequest(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    credentials: "same-origin",
    cache: "no-store",
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
  });
  const payload = await response.json().catch(() => ({}));
  if (response.status === 401) throw new Error("Sesi Anda berakhir. Silakan masuk kembali.");
  if (!response.ok) throw new Error(payload.error || "Tidak dapat terhubung ke server");
  return payload;
}

async function loadTasksForUser(user) {
  const sequence = ++authSequence;
  currentUser = user;
  tasks = readTaskCache(userCacheKey());
  isLoadingTasks = true;
  setSyncStatus("syncing", "Memuat tugas...");
  render();
  try {
    let payload = await apiRequest("/api/tasks");
    const migrationKey = `${MIGRATION_PREFIX}${user.id}`;
    const migrationPending = !localStorage.getItem(migrationKey);
    const legacyTasks = migrationPending ? readTaskCache(LEGACY_STORAGE_KEY) : [];
    if (legacyTasks.length > 0) {
      setSyncStatus("syncing", "Memindahkan tugas lama...");
      const persistedIds = new Set(payload.tasks.map((task) => task.id));
      const pendingTasks = legacyTasks.filter((task) => !persistedIds.has(task.id));
      for (const task of pendingTasks) {
        await apiRequest("/api/tasks", {
          method: "POST",
          body: JSON.stringify({ task }),
        });
      }
      payload = await apiRequest("/api/tasks");
      const finalIds = new Set(payload.tasks.map((task) => task.id));
      if (!legacyTasks.every((task) => finalIds.has(task.id))) {
        throw new Error("Sebagian tugas lama belum berhasil dipindahkan. Sinkronisasi akan dicoba lagi.");
      }
      localStorage.removeItem(LEGACY_STORAGE_KEY);
    }
    localStorage.setItem(migrationKey, "done");
    if (sequence !== authSequence || currentUser?.id !== user.id) return;
    tasks = payload.tasks;
    saveTaskCache();
    setSyncStatus("synced", "Semua tersimpan");
  } catch (error) {
    if (sequence !== authSequence) return;
    setSyncStatus("error", "Sinkronisasi gagal");
    setNotice(`Sinkronisasi gagal: ${error.message}`, "error");
  } finally {
    if (sequence === authSequence) {
      isLoadingTasks = false;
      render();
    }
  }
}

function escapeHtml(value = "") {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;",
  }[character]));
}

function formatDate(dateString) {
  if (!dateString) return "Tanpa deadline";
  if (!isValidDate(dateString)) return "Deadline belum valid";
  return new Intl.DateTimeFormat("id-ID", {
    timeZone: APP_TIME_ZONE,
    day: "numeric",
    month: "short",
  }).format(new Date(`${dateString}T12:00:00Z`));
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
  const longDate = new Intl.DateTimeFormat("id-ID", {
    timeZone: APP_TIME_ZONE,
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date());
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
    return `<div class="category-row">
      <div class="category-row-top"><span>${category}</span><strong>${count} tugas</strong></div>
      <div class="category-row-track"><span style="width: ${Math.round((count / total) * 100)}%"></span></div>
    </div>`;
  }).join("");
}

function renderTasks() {
  const list = $("#taskList");
  if (isLoadingTasks) {
    list.innerHTML = `<div class="empty-state loading-state"><span class="loading-spinner"></span><h3>Memuat tugas Anda</h3><p>Mengambil versi terbaru dari database...</p></div>`;
    return;
  }
  const filteredTasks = getFilteredTasks();
  if (!filteredTasks.length) {
    const hasFilters = $("#searchInput").value || $("#categoryFilter").value !== "all" || $("#priorityFilter").value !== "all" || $("#dateFilter").value !== "all" || activeView !== "dashboard";
    list.innerHTML = `<div class="empty-state">
      <div class="empty-icon"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 6h13M8 12h13M8 18h13"></path><path d="M3 6h.01M3 12h.01M3 18h.01"></path></svg></div>
      <h3>${hasFilters ? "Tidak ada tugas yang cocok" : "Ruang kerja masih kosong"}</h3>
      <p>${hasFilters ? "Coba ubah filter atau kata pencarian Anda." : "Tambahkan tugas pertama. Tugas akan otomatis tersedia di perangkat lain setelah Anda masuk."}</p>
      ${hasFilters ? "" : '<button class="primary-button" type="button" data-action="add">Tambah tugas pertama</button>'}
    </div>`;
    return;
  }
  list.innerHTML = filteredTasks.map((task, index) => {
    const dueClass = isOverdue(task) ? "is-overdue" : isToday(task) ? "is-today" : "";
    const dueText = isOverdue(task) ? `Terlambat · ${formatDate(task.dueDate)}` : isToday(task) ? "Hari ini" : formatDate(task.dueDate);
    return `<article class="task-item ${task.completed ? "is-completed" : ""}" style="animation-delay:${index * 35}ms">
      <button class="task-check" type="button" data-action="toggle" data-id="${escapeHtml(task.id)}" aria-label="${task.completed ? "Tandai belum selesai" : "Tandai selesai"}">
        ${task.completed ? '<svg viewBox="0 0 24 24"><path d="m6 12 4 4 8-9"></path></svg>' : ""}
      </button>
      <div class="task-main">
        <div class="task-title-row"><h3 class="task-title">${escapeHtml(task.title)}</h3><span class="priority-dot ${task.priority}" title="Prioritas ${PRIORITY_LABEL[task.priority]}"></span></div>
        ${task.notes ? `<p class="task-notes">${escapeHtml(task.notes)}</p>` : ""}
        <div class="task-meta">
          <span class="category-pill ${CATEGORY_CLASS[task.category]}"><span></span>${task.category}</span>
          <span class="due-label ${dueClass}"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="5" width="16" height="15" rx="2"></rect><path d="M8 3v4M16 3v4M4 10h16"></path></svg>${dueText}</span>
        </div>
      </div>
      <div class="task-actions">
        <button class="icon-button" type="button" data-action="edit" data-id="${escapeHtml(task.id)}" aria-label="Edit ${escapeHtml(task.title)}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m4 16-.7 4.7L8 20l11.6-11.6a2.1 2.1 0 0 0-3-3L5 17"></path><path d="m14.5 6.5 3 3"></path></svg></button>
        <button class="icon-button" type="button" data-action="delete" data-id="${escapeHtml(task.id)}" aria-label="Hapus ${escapeHtml(task.title)}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M10 11v5M14 11v5M6 7l1 13h10l1-13M9 7V4h6v3"></path></svg></button>
      </div>
    </article>`;
  }).join("");
}

function render() {
  renderDate();
  renderStats();
  renderFocus();
  renderCategoryBars();
  const labels = { dashboard: ["Ringkasan", "Semua tugas"], all: ["Semua tugas", "Semua tugas"], active: ["Belum selesai", "Belum selesai"], completed: ["Selesai", "Tugas selesai"] };
  const [breadcrumb, title] = labels[activeView];
  $("#breadcrumbCurrent").textContent = breadcrumb;
  $("#taskSectionTitle").textContent = title;
  $$(".nav-item").forEach((button) => button.classList.toggle("is-active", button.dataset.view === activeView));
  renderTasks();
}

function setSaving(button, saving, label) {
  button.disabled = saving;
  button.textContent = saving ? "Menyimpan..." : label;
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
  const saveButton = $("#saveTaskButton");
  const taskData = {
    title: $("#taskTitle").value.trim(),
    category: $("#taskCategory").value,
    priority: $("#taskPriority").value,
    dueDate: $("#taskDueDate").value,
    notes: $("#taskNotes").value.trim(),
  };
  if (!taskData.title) return;
  setSaving(saveButton, true, editingTaskId ? "Simpan perubahan" : "Simpan tugas");
  setSyncStatus("syncing", "Menyimpan...");
  try {
    if (editingTaskId) {
      const payload = await apiRequest(`/api/tasks/${encodeURIComponent(editingTaskId)}`, {
        method: "PATCH",
        body: JSON.stringify({ task: taskData }),
      });
      tasks = tasks.map((task) => task.id === editingTaskId ? payload.task : task);
    } else {
      const task = {
        ...taskData,
        id: `task-${crypto.randomUUID()}`,
        completed: false,
        createdAt: Date.now(),
      };
      const payload = await apiRequest("/api/tasks", {
        method: "POST",
        body: JSON.stringify({ task }),
      });
      tasks.push(payload.task);
    }
    saveTaskCache();
    setSyncStatus("synced", "Semua tersimpan");
    closeModal();
    render();
  } catch (error) {
    setSyncStatus("error", "Belum tersimpan");
    setNotice(`Perubahan belum tersimpan: ${error.message}`, "error");
  } finally {
    setSaving(saveButton, false, editingTaskId ? "Simpan perubahan" : "Simpan tugas");
  }
}

async function deleteTask(id) {
  const task = tasks.find((item) => item.id === id);
  if (!task || !window.confirm(`Hapus tugas "${task.title}"?`)) return;
  setSyncStatus("syncing", "Menghapus...");
  try {
    await apiRequest(`/api/tasks/${encodeURIComponent(id)}`, { method: "DELETE" });
    tasks = tasks.filter((item) => item.id !== id);
    saveTaskCache();
    setSyncStatus("synced", "Semua tersimpan");
    render();
  } catch (error) {
    setSyncStatus("error", "Belum terhapus");
    setNotice(`Tugas belum terhapus: ${error.message}`, "error");
  }
}

async function handleTaskAction(event) {
  const button = event.target.closest("[data-action]");
  if (!button) return;
  const { action, id } = button.dataset;
  if (action === "add") openModal();
  if (action === "edit") openModal(tasks.find((task) => task.id === id));
  if (action === "delete") await deleteTask(id);
  if (action === "toggle") {
    const current = tasks.find((task) => task.id === id);
    if (!current) return;
    button.disabled = true;
    setSyncStatus("syncing", "Menyimpan status...");
    try {
      const payload = await apiRequest(`/api/tasks/${encodeURIComponent(id)}`, {
        method: "PATCH",
        body: JSON.stringify({ task: { completed: !current.completed } }),
      });
      tasks = tasks.map((task) => task.id === id ? payload.task : task);
      saveTaskCache();
      setSyncStatus("synced", "Semua tersimpan");
      render();
    } catch (error) {
      button.disabled = false;
      setSyncStatus("error", "Status belum tersimpan");
      setNotice(`Status belum tersimpan: ${error.message}`, "error");
    }
  }
}

function updateUserProfile(user) {
  const fullName = user.fullName || user.firstName || "Akun saya";
  const email = user.primaryEmailAddress?.emailAddress || "Akun tersinkron";
  $("#userName").textContent = fullName;
  $("#userEmail").textContent = email;
  $("#userAvatar").textContent = fullName.slice(0, 1).toUpperCase();
  $("#pageTitle").textContent = `Selamat datang, ${user.firstName || "kembali"}.`;
}

async function showAuthenticatedApp(user) {
  $("#authScreen").hidden = true;
  $(".app-shell").hidden = false;
  updateUserProfile(user);
  await loadTasksForUser(user);
}

function showAuthError(message) {
  $("#authMount").innerHTML = `<div class="auth-error"><strong>Autentikasi belum dapat dimuat.</strong><p>${escapeHtml(message)}</p><button class="secondary-button" type="button" onclick="window.location.reload()">Coba lagi</button></div>`;
}

function mountAuth(mode = authMode) {
  if (!clerk || currentUser) return;
  authMode = mode;
  $("#signInTab").classList.toggle("is-active", mode === "sign-in");
  $("#signUpTab").classList.toggle("is-active", mode === "sign-up");
  $("#signInTab").setAttribute("aria-selected", String(mode === "sign-in"));
  $("#signUpTab").setAttribute("aria-selected", String(mode === "sign-up"));
  const mount = $("#authMount");
  try {
    clerk.unmountSignIn(mount);
    clerk.unmountSignUp(mount);
  } catch {
    // The first mount has nothing to unmount.
  }
  mount.innerHTML = "";
  if (mode === "sign-up") {
    clerk.mountSignUp(mount, { appearance: clerkAppearance });
  } else {
    clerk.mountSignIn(mount, { appearance: clerkAppearance });
  }
}

async function handleAuthChange(user) {
  if (isSameAuthenticatedUser(currentUser, user)) return;
  ++authSequence;
  if (!user) {
    currentUser = null;
    tasks = [];
    $(".app-shell").hidden = true;
    $("#authScreen").hidden = false;
    mountAuth();
    return;
  }
  await showAuthenticatedApp(user);
}

async function waitForClerk() {
  const started = Date.now();
  while (!window.Clerk && Date.now() - started < 12000) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (!window.Clerk) throw new Error("Layanan login tidak merespons. Periksa koneksi lalu coba lagi.");
  return window.Clerk;
}

async function bootstrapAuth() {
  try {
    clerk = await waitForClerk();
    await clerk.load();
    clerk.addListener(({ user }) => handleAuthChange(user));
    await handleAuthChange(clerk.user);
  } catch (error) {
    showAuthError(error.message);
  }
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
$("#searchInput").addEventListener("input", render);
["#categoryFilter", "#priorityFilter", "#dateFilter"].forEach((selector) => {
  $(selector).addEventListener("input", render);
  $(selector).addEventListener("change", render);
});
$("#taskList").addEventListener("click", handleTaskAction);
$("#addTaskButton").addEventListener("click", () => openModal());
$("#quickAddButton").addEventListener("click", () => openModal());
$("#taskForm").addEventListener("submit", submitTask);
$("#closeModalButton").addEventListener("click", closeModal);
$("#cancelModalButton").addEventListener("click", closeModal);
$("#taskModal").addEventListener("click", (event) => { if (event.target === $("#taskModal")) closeModal(); });
$("#signInTab").addEventListener("click", () => mountAuth("sign-in"));
$("#signUpTab").addEventListener("click", () => mountAuth("sign-up"));
$("#logoutButton").addEventListener("click", async () => {
  $("#logoutButton").disabled = true;
  try {
    await clerk.signOut({ redirectUrl: "/" });
  } finally {
    $("#logoutButton").disabled = false;
  }
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !$("#taskModal").hidden) closeModal();
});
$("#clearCompletedButton").addEventListener("click", async () => {
  const completedTasks = tasks.filter((task) => task.completed);
  if (!completedTasks.length || !window.confirm("Hapus semua tugas yang sudah selesai?")) return;
  setSyncStatus("syncing", "Menghapus tugas selesai...");
  try {
    await Promise.all(completedTasks.map((task) => apiRequest(`/api/tasks/${encodeURIComponent(task.id)}`, { method: "DELETE" })));
    tasks = tasks.filter((task) => !task.completed);
    saveTaskCache();
    setSyncStatus("synced", "Semua tersimpan");
    render();
  } catch (error) {
    setSyncStatus("error", "Belum terhapus");
    setNotice(`Tugas selesai belum terhapus: ${error.message}`, "error");
  }
});

bootstrapAuth();