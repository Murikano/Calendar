const STORAGE_KEY = "myCalendar:v1";

function pad2(n) {
  return String(n).padStart(2, "0");
}

function toISODateLocal(d) {
  const year = d.getFullYear();
  const month = pad2(d.getMonth() + 1);
  const day = pad2(d.getDate());
  return `${year}-${month}-${day}`;
}

function startOfDay(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function addDays(d, days) {
  const dt = new Date(d);
  dt.setDate(dt.getDate() + days);
  return dt;
}

function daysBetween(a, b) {
  const msPerDay = 24 * 60 * 60 * 1000;
  const aa = startOfDay(a).getTime();
  const bb = startOfDay(b).getTime();
  return Math.round((bb - aa) / msPerDay);
}

function mod(n, m) {
  return ((n % m) + m) % m;
}

function monthTitleRU(date) {
  const fmt = new Intl.DateTimeFormat("ru-RU", { month: "long", year: "numeric" });
  const s = fmt.format(date);
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function weekdayShortRU() {
  // Пн..Вс (под наш календарь)
  return ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
}

function loadState() {
  const now = new Date();
  const fallback = {
    anchorDate: toISODateLocal(now),
    anchorType: "work", // work | off
    notes: {}, // yyyy-mm-dd -> string
  };

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return {
      ...fallback,
      ...parsed,
      notes: typeof parsed?.notes === "object" && parsed.notes ? parsed.notes : {},
    };
  } catch {
    return fallback;
  }
}

function saveState(state) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function parseISODateLocal(iso) {
  // yyyy-mm-dd -> local Date
  const [y, m, d] = iso.split("-").map((x) => Number(x));
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}

function isWorkDay(date, anchorDate, anchorType) {
  // Cycle length: 6 days: 0-2 work, 3-5 off (when anchorType == work)
  // If anchorType == off, cycle is shifted by 3.
  const diff = daysBetween(anchorDate, date);
  const idx = mod(diff, 6);
  const workIdx = anchorType === "work" ? idx : mod(idx + 3, 6);
  return workIdx < 3;
}

function buildMonthDays(viewDate) {
  const firstOfMonth = new Date(viewDate.getFullYear(), viewDate.getMonth(), 1);
  const lastOfMonth = new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 0);

  // We want weeks starting Monday.
  // JS: getDay(): 0=Sun..6=Sat. Convert to Monday-start: 0=Mon..6=Sun.
  const mondayIndex = (d) => mod(d.getDay() - 1, 7);
  const startPad = mondayIndex(firstOfMonth);
  const endPad = 6 - mondayIndex(lastOfMonth);

  const start = addDays(firstOfMonth, -startPad);
  const end = addDays(lastOfMonth, endPad);

  const days = [];
  for (let d = new Date(start); d <= end; d = addDays(d, 1)) {
    days.push(new Date(d));
  }
  return { days, firstOfMonth, lastOfMonth };
}

function setClipboard(text) {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text);
  // Fallback
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.setAttribute("readonly", "true");
  ta.style.position = "fixed";
  ta.style.left = "-9999px";
  document.body.appendChild(ta);
  ta.select();
  document.execCommand("copy");
  document.body.removeChild(ta);
  return Promise.resolve();
}

function getShareUrl(state) {
  const url = new URL(window.location.href);
  url.searchParams.set("anchor", state.anchorDate);
  url.searchParams.set("type", state.anchorType);
  return url.toString();
}

function applyStateFromUrl(state) {
  const url = new URL(window.location.href);
  const anchor = url.searchParams.get("anchor");
  const type = url.searchParams.get("type");

  const anchorDate = anchor ? parseISODateLocal(anchor) : null;
  const anchorType = type === "work" || type === "off" ? type : null;

  if (anchorDate && anchor) state.anchorDate = anchor;
  if (anchorType) state.anchorType = anchorType;
}

function main() {
  const els = {
    monthTitle: document.getElementById("monthTitle"),
    calendarGrid: document.getElementById("calendarGrid"),
    btnPrevMonth: document.getElementById("btnPrevMonth"),
    btnNextMonth: document.getElementById("btnNextMonth"),
    btnToday: document.getElementById("btnToday"),
    btnShare: document.getElementById("btnShare"),
    hintText: document.getElementById("hintText"),

    anchorDate: document.getElementById("anchorDate"),
    anchorType: document.getElementById("anchorType"),
    btnSaveSettings: document.getElementById("btnSaveSettings"),
    btnReset: document.getElementById("btnReset"),

    noteDateLabel: document.getElementById("noteDateLabel"),
    noteText: document.getElementById("noteText"),
    btnSaveNote: document.getElementById("btnSaveNote"),
    btnDeleteNote: document.getElementById("btnDeleteNote"),

    feedbackLink: document.getElementById("feedbackLink"),
  };

  let state = loadState();
  applyStateFromUrl(state);
  saveState(state);

  let viewDate = new Date();
  viewDate = new Date(viewDate.getFullYear(), viewDate.getMonth(), 1);

  let selectedISO = null;

  function setHint(text) {
    els.hintText.textContent = text;
  }

  function setSelectedDay(iso) {
    selectedISO = iso;
    const d = parseISODateLocal(iso);
    const fmt = new Intl.DateTimeFormat("ru-RU", {
      weekday: "long",
      day: "2-digit",
      month: "long",
      year: "numeric",
    });
    els.noteDateLabel.textContent = fmt.format(d);
    els.noteText.value = state.notes[iso] ?? "";
    els.btnSaveNote.disabled = false;
    els.btnDeleteNote.disabled = !state.notes[iso];
    render();
  }

  function resetSelection() {
    selectedISO = null;
    els.noteDateLabel.textContent = "Выбери день в календаре";
    els.noteText.value = "";
    els.btnSaveNote.disabled = true;
    els.btnDeleteNote.disabled = true;
    render();
  }

  function render() {
    els.monthTitle.textContent = monthTitleRU(viewDate);
    els.calendarGrid.innerHTML = "";

    // Weekday header
    for (const w of weekdayShortRU()) {
      const el = document.createElement("div");
      el.className = "weekday";
      el.textContent = w;
      els.calendarGrid.appendChild(el);
    }

    const { days } = buildMonthDays(viewDate);
    const anchorDate = parseISODateLocal(state.anchorDate) ?? new Date();
    const todayISO = toISODateLocal(new Date());

    for (const d of days) {
      const iso = toISODateLocal(d);
      const inMonth = d.getMonth() === viewDate.getMonth();
      const work = isWorkDay(d, anchorDate, state.anchorType);
      const note = state.notes[iso];

      const cell = document.createElement("button");
      cell.type = "button";
      cell.className = "day";
      if (!inMonth) cell.classList.add("day--muted");
      cell.classList.add(work ? "day--work" : "day--off");
      if (iso === todayISO) cell.classList.add("day--today");
      if (selectedISO === iso) cell.classList.add("day--selected");
      cell.setAttribute("data-iso", iso);
      cell.setAttribute("aria-label", iso);

      const num = document.createElement("div");
      num.className = "day__num";
      num.textContent = String(d.getDate());
      cell.appendChild(num);

      const badge = document.createElement("div");
      badge.className = "badge";
      badge.textContent = work ? "Работа" : "Выходной";
      cell.appendChild(badge);

      if (note) {
        const noteEl = document.createElement("div");
        noteEl.className = "day__note";
        noteEl.textContent = note;
        cell.appendChild(noteEl);
      }

      cell.addEventListener("click", () => setSelectedDay(iso));
      els.calendarGrid.appendChild(cell);
    }

    // Settings inputs
    els.anchorDate.value = state.anchorDate;
    els.anchorType.value = state.anchorType;
  }

  function initFeedbackLink() {
    // Обратная связь через Telegram
    const telegramUsername = "VYSTMAKS";
    els.feedbackLink.href = `https://t.me/${telegramUsername}`;
  }

  // Events
  els.btnPrevMonth.addEventListener("click", () => {
    viewDate = new Date(viewDate.getFullYear(), viewDate.getMonth() - 1, 1);
    resetSelection();
    setHint("Переключили месяц.");
  });

  els.btnNextMonth.addEventListener("click", () => {
    viewDate = new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 1);
    resetSelection();
    setHint("Переключили месяц.");
  });

  els.btnToday.addEventListener("click", () => {
    const now = new Date();
    viewDate = new Date(now.getFullYear(), now.getMonth(), 1);
    setSelectedDay(toISODateLocal(now));
    setHint("Ок, показал текущий месяц.");
  });

  els.btnShare.addEventListener("click", async () => {
    const url = getShareUrl(state);
    try {
      await setClipboard(url);
      setHint("Ссылка скопирована. Можешь отправить близким.");
    } catch {
      setHint("Не получилось скопировать. Ссылка в адресной строке уже с настройками.");
    }
  });

  els.btnSaveSettings.addEventListener("click", () => {
    const iso = els.anchorDate.value;
    const type = els.anchorType.value;
    const parsed = parseISODateLocal(iso);

    if (!parsed) {
      setHint("Некорректная дата точки отсчёта.");
      return;
    }

    state.anchorDate = iso;
    state.anchorType = type === "off" ? "off" : "work";
    saveState(state);
    render();
    setHint("Настройки сохранены.");
  });

  els.btnReset.addEventListener("click", () => {
    localStorage.removeItem(STORAGE_KEY);
    state = loadState();
    applyStateFromUrl(state);
    saveState(state);
    resetSelection();
    render();
    setHint("Сбросил настройки и заметки на этом устройстве.");
  });

  els.btnSaveNote.addEventListener("click", () => {
    if (!selectedISO) return;
    const text = els.noteText.value.trim();
    if (text) state.notes[selectedISO] = text;
    else delete state.notes[selectedISO];
    saveState(state);
    els.btnDeleteNote.disabled = !state.notes[selectedISO];
    render();
    setHint("Заметка сохранена.");
  });

  els.btnDeleteNote.addEventListener("click", () => {
    if (!selectedISO) return;
    delete state.notes[selectedISO];
    saveState(state);
    els.noteText.value = "";
    els.btnDeleteNote.disabled = true;
    render();
    setHint("Заметка удалена.");
  });

  // Init
  initFeedbackLink();
  render();
  setHint("Готово. Выбери день или настрой точку отсчёта.");
}

document.addEventListener("DOMContentLoaded", main);

