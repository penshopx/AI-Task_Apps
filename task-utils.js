export const APP_TIME_ZONE = "Asia/Bangkok";

export function dateKeyInTimeZone(date, timeZone = APP_TIME_ZONE) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(date)).reduce((result, part) => {
    if (part.type !== "literal") result[part.type] = part.value;
    return result;
  }, {});
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function today() {
  return dateKeyInTimeZone(new Date());
}

export function addDays(days, baseDate = today()) {
  const date = new Date(`${baseDate}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function isOverdue(task, currentDate = today()) {
  return Boolean(!task.completed && task.dueDate && task.dueDate < currentDate);
}

export function isToday(task, currentDate = today()) {
  return task.dueDate === currentDate;
}

export function isWithinNextWeek(task, currentDate = today()) {
  if (!task.dueDate) return false;
  return task.dueDate >= currentDate && task.dueDate <= addDays(7, currentDate);
}

export function filterTasks(tasks, {
  view = "dashboard",
  search = "",
  category = "all",
  priority = "all",
  date = "all",
  currentDate = today(),
} = {}) {
  const normalizedSearch = search.trim().toLowerCase();
  return tasks
    .filter((task) => {
      if (view === "active" && task.completed) return false;
      if (view === "completed" && !task.completed) return false;
      if (category !== "all" && task.category !== category) return false;
      if (priority !== "all" && task.priority !== priority) return false;
      if (date === "today" && !isToday(task, currentDate)) return false;
      if (date === "week" && !isWithinNextWeek(task, currentDate)) return false;
      if (date === "overdue" && !isOverdue(task, currentDate)) return false;
      if (normalizedSearch && !`${task.title} ${task.category} ${task.notes || ""}`.toLowerCase().includes(normalizedSearch)) return false;
      return true;
    })
    .sort((a, b) => {
      if (a.completed !== b.completed) return Number(a.completed) - Number(b.completed);
      if (isOverdue(a, currentDate) !== isOverdue(b, currentDate)) return Number(isOverdue(b, currentDate)) - Number(isOverdue(a, currentDate));
      return (a.dueDate || "9999-12-31").localeCompare(b.dueDate || "9999-12-31") || (b.createdAt || 0) - (a.createdAt || 0);
    });
}

export function parseStoredTasks(rawValue, fallback) {
  if (!rawValue) return fallback;
  try {
    const parsed = JSON.parse(rawValue);
    return Array.isArray(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}