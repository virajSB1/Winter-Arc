import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import {
  Snowflake, Dumbbell, Activity, Beef, Droplet, Moon, BookOpen, Sparkles,
  Settings as SettingsIcon, Calendar, BarChart3, Home, Plus, Trash2,
  GripVertical, Check, X, Clock, Flame, ChevronLeft, ChevronRight, Star,
  Download, Upload, RotateCcw, AlertCircle, ChevronDown, MoreVertical,
  SkipForward, PencilLine, Sunrise, Wind, Shirt, Sparkle, Utensils, Sofa,
  ListChecks, CircleCheck, CircleDashed, CircleSlash, Ban
} from "lucide-react";
import {
  ResponsiveContainer, LineChart, Line, BarChart, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip, ScatterChart, Scatter, ZAxis, Cell
} from "recharts";

/* ============================== CONSTANTS ============================== */

const STORAGE_KEY = "winter-arc-v1";
const ARC_START_DEFAULT = "2026-09-04";
const ARC_END_DEFAULT = "2026-12-31";

const CATEGORY_META = {
  training:    { label: "Training",              icon: Dumbbell,  color: "var(--c-ice)" },
  nutrition:   { label: "Nutrition",              icon: Beef,      color: "var(--c-amber)" },
  hydration:   { label: "Hydration",              icon: Droplet,   color: "var(--c-teal)" },
  maintenance: { label: "Personal & Environment",  icon: Sofa,      color: "var(--c-lilac)" },
  routine:     { label: "Routine",                icon: ListChecks,color: "var(--c-mint)" },
};

const TASK_ICONS = {
  gym: Dumbbell, cardio: Activity, protein: Beef, hydration: Droplet,
  bath: Sunrise, clothes: Shirt, room: Sofa, desk: Sparkle, utensils: Utensils,
  laundry: Wind, chores: ListChecks, "environment-reset": Sofa, "start-day": Sunrise,
};

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const WEEKDAY_SHORT = ["S", "M", "T", "W", "T", "F", "S"];

/* ============================== DATE / TIME HELPERS ============================== */

const pad = (n) => String(n).padStart(2, "0");
const todayStr = () => fmtDate(new Date());
function fmtDate(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
function parseDateStr(s) { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); }
function addDaysStr(s, n) { const d = parseDateStr(s); d.setDate(d.getDate() + n); return fmtDate(d); }
function dayOfWeek(s) { return parseDateStr(s).getDay(); }
function daysBetween(a, b) { return Math.round((parseDateStr(b) - parseDateStr(a)) / 86400000); }
function clampDateInRange(s, start, end) { if (s < start) return start; if (s > end) return end; return s; }
function niceDate(s) {
  return parseDateStr(s).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" });
}
function niceDateShort(s) {
  return parseDateStr(s).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
function timeToMin(t) { if (!t) return null; const [h, m] = t.split(":").map(Number); return h * 60 + m; }
function minToTime12(mins) {
  mins = ((mins % 1440) + 1440) % 1440;
  let h = Math.floor(mins / 60), m = mins % 60;
  const ap = h >= 12 ? "PM" : "AM";
  let h12 = h % 12; if (h12 === 0) h12 = 12;
  return `${h12}:${pad(m)} ${ap}`;
}
function durationLabel(mins) {
  if (mins == null || isNaN(mins)) return "—";
  const h = Math.floor(mins / 60), m = Math.round(mins % 60);
  if (h <= 0) return `${m}m`;
  return `${h}h ${pad(m)}m`;
}
function circDiff(a, b) { const d = Math.abs(a - b); return Math.min(d, 1440 - d); }

/* ============================== SCORING ENGINES ============================== */

// Circular mean of a set of clock-times (minutes-of-day), so 11:50pm and 12:10am
// average to 12:00am instead of drifting toward noon.
function circularMeanMinutes(list) {
  if (!list.length) return null;
  let sinSum = 0, cosSum = 0;
  for (const m of list) {
    const rad = (m / 1440) * 2 * Math.PI;
    sinSum += Math.sin(rad); cosSum += Math.cos(rad);
  }
  let ang = Math.atan2(sinSum, cosSum);
  if (ang < 0) ang += 2 * Math.PI;
  return (ang / (2 * Math.PI)) * 1440;
}

// Looks back over the previous N logged nights (not counting tonight) to judge
// whether tonight's bed/wake times are consistent with the recent pattern.
function recentSleepHistory(records, dateStr, lookbackDays) {
  const bed = [], wake = [];
  let cursor = dateStr;
  for (let i = 0; i < lookbackDays; i++) {
    cursor = addDaysStr(cursor, -1);
    const r = records[cursor];
    if (r?.sleep?.bedtime && r?.sleep?.wake) {
      bed.push(timeToMin(r.sleep.bedtime));
      wake.push(timeToMin(r.sleep.wake));
    }
  }
  return { bed, wake };
}

/**
 * The Sleep 6-Pointer Rule. Sleep gets 0–6 points automatically:
 *  - Bedtime           0–2  how close bedtime is to the desired bedtime
 *  - Wake time         0–1  whether wake-up fell within the intended schedule
 *  - Sleep duration     0–2  whether total sleep was sufficient
 *  - Schedule consistency 0–1  whether the bed/wake pattern matches recent nights
 */
function computeSleepQuality(state, dateStr) {
  const rec = getRecord(state.records, dateStr);
  const bedtime = rec.sleep?.bedtime, wake = rec.sleep?.wake;
  if (!bedtime || !wake) return null;
  const s = state.settings.sleep;
  const bedMin = timeToMin(bedtime), wakeMin = timeToMin(wake);
  let duration = wakeMin - bedMin;
  if (duration <= 0) duration += 1440;

  const idealBed = timeToMin(s.idealBedtime);
  const idealWake = timeToMin(s.idealWake);
  const tol = s.toleranceMin;

  // Bedtime — 0 to 2
  const bedDiff = circDiff(bedMin, idealBed);
  const bedtimeScore = bedDiff <= tol ? 2 : bedDiff <= tol * 3 ? 1 : 0;

  // Wake time — 0 to 1 (binary: within the intended window or not)
  const wakeDiff = circDiff(wakeMin, idealWake);
  const wakeScore = wakeDiff <= tol * 1.5 ? 1 : 0;

  // Sleep duration — 0 to 2
  const durationScore = duration >= s.idealDurationMin ? 2 : duration >= s.minDurationMin ? 1 : 0;

  // Schedule consistency — 0 to 1, judged against recent logged nights
  const lookback = s.consistencyLookbackDays ?? 5;
  const consTol = s.consistencyToleranceMin ?? 45;
  const hist = recentSleepHistory(state.records, dateStr, lookback);
  let consistencyScore = 1; // benefit of the doubt with no history yet
  if (hist.bed.length >= 2) {
    const avgBed = circularMeanMinutes(hist.bed);
    const avgWake = circularMeanMinutes(hist.wake);
    const bedVar = circDiff(bedMin, avgBed);
    const wakeVar = circDiff(wakeMin, avgWake);
    consistencyScore = (bedVar <= consTol && wakeVar <= consTol) ? 1 : 0;
  }

  return {
    duration,
    quality: bedtimeScore + wakeScore + durationScore + consistencyScore,
    bedtimeScore, wakeScore, durationScore, consistencyScore,
  };
}

function isScheduledToday(task, dateStr) {
  const f = task.frequency;
  if (!f || f.type === "disabled") return false;
  if (f.type === "daily") return true;
  if (f.type === "weekdays") return (f.days || []).includes(dayOfWeek(dateStr));
  if (f.type === "oneTime") return f.date === dateStr;
  if (f.type === "asNeeded") return false;
  return false;
}

function getRecord(records, dateStr) {
  return records[dateStr] || { status: {}, overrides: {}, sleep: {}, deepWork: {} };
}

function computeDailyScore(state, dateStr) {
  const rec = getRecord(state.records, dateStr);
  let required = 0, completed = 0;
  const items = [];
  for (const task of state.tasks) {
    if (!isScheduledToday(task, dateStr)) continue;
    const ov = rec.overrides?.[task.id];
    if (ov?.skippedToday) { items.push({ task, state: "skipped" }); continue; }
    required++;
    const done = rec.status?.[task.id] === "completed";
    if (done) completed++;
    items.push({ task, state: done ? "completed" : "missed" });
  }
  // Sleep
  required++;
  const sleepDone = !!(rec.sleep?.bedtime && rec.sleep?.wake);
  if (sleepDone) completed++;
  // Deep work
  required++;
  const dwDone = (rec.deepWork?.durationMin || 0) >= state.settings.deepWorkTargetMin;
  if (dwDone) completed++;

  const pct = required ? Math.round((completed / required) * 100) : 0;
  return { required, completed, pct, items, sleepDone, dwDone };
}

function computeStreaks(state) {
  const { startDate, endDate } = state.settings;
  const today = clampDateInRange(todayStr(), startDate, endDate);
  const daysWithData = [];
  let cursor = startDate;
  while (cursor <= today) {
    const rec = state.records[cursor];
    if (rec && (Object.keys(rec.status || {}).length || rec.sleep?.bedtime || rec.deepWork?.durationMin)) {
      daysWithData.push({ date: cursor, pct: computeDailyScore(state, cursor).pct });
    }
    cursor = addDaysStr(cursor, 1);
  }
  let current = 0;
  for (let i = daysWithData.length - 1; i >= 0; i--) {
    if (daysWithData[i].pct >= 80) current++; else break;
  }
  let best = 0, run = 0;
  for (const d of daysWithData) {
    if (d.pct >= 80) { run++; best = Math.max(best, run); } else run = 0;
  }
  return { current, best };
}

/* ============================== DEFAULT DATA ============================== */

function defaultTasks() {
  return [
    { id: "gym", name: "Gym", category: "training", fixed: true, frequency: { type: "weekdays", days: [1, 2, 4, 5, 6] }, priority: 2, reminderEnabled: true, message: "Time to train. Showing up is part of the system.", order: 0 },
    { id: "cardio", name: "Cardio", category: "training", fixed: true, frequency: { type: "daily" }, priority: 3, reminderEnabled: true, message: "A short session keeps the engine running.", order: 1 },
    { id: "protein", name: "Protein Target", category: "nutrition", fixed: true, frequency: { type: "daily" }, priority: 2, reminderEnabled: true, message: "Hit your protein target — check HealthifyMe.", order: 2 },
    { id: "hydration", name: "Hydration Target", category: "hydration", fixed: true, frequency: { type: "daily" }, priority: 3, reminderEnabled: true, message: "Water first. Everything runs better hydrated.", order: 3 },
    { id: "start-day", name: "Start Day", category: "routine", fixed: false, frequency: { type: "daily" }, priority: 2, reminderEnabled: true, message: "Start the day deliberately. Ordinary days, done properly.", order: 4 },
    { id: "bath", name: "Bath / Hygiene", category: "maintenance", fixed: false, frequency: { type: "daily" }, priority: 2, reminderEnabled: false, message: "Start clean, start deliberate.", order: 5 },
    { id: "clothes", name: "Clothes Maintained", category: "maintenance", fixed: false, frequency: { type: "daily" }, priority: 1, reminderEnabled: false, message: "", order: 6 },
    { id: "room", name: "Room Cleaned", category: "maintenance", fixed: false, frequency: { type: "asNeeded" }, priority: 1, reminderEnabled: false, message: "", order: 7 },
    { id: "desk", name: "Desk Organized", category: "maintenance", fixed: false, frequency: { type: "daily" }, priority: 1, reminderEnabled: false, message: "", order: 8 },
    { id: "utensils", name: "Utensils / Dishes", category: "maintenance", fixed: false, frequency: { type: "daily" }, priority: 1, reminderEnabled: false, message: "", order: 9 },
    { id: "laundry", name: "Laundry", category: "maintenance", fixed: false, frequency: { type: "weekdays", days: [3, 6] }, priority: 1, reminderEnabled: false, message: "", order: 10 },
    { id: "chores", name: "Other Chores", category: "maintenance", fixed: false, frequency: { type: "asNeeded" }, priority: 1, reminderEnabled: false, message: "", order: 11 },
    { id: "environment-reset", name: "Environment Reset", category: "routine", fixed: false, frequency: { type: "daily" }, priority: 2, reminderEnabled: true, message: "Reset your environment now so tomorrow starts clean.", order: 12 },
  ];
}

function defaultState() {
  return {
    settings: {
      startDate: ARC_START_DEFAULT,
      endDate: ARC_END_DEFAULT,
      remindersEnabled: true,
      deepWorkTargetMin: 120,
      deepWorkMaxMin: 240,
      sleep: { idealBedtime: "23:00", idealWake: "07:00", minDurationMin: 390, idealDurationMin: 450, toleranceMin: 30, consistencyToleranceMin: 45, consistencyLookbackDays: 5 },
    },
    tasks: defaultTasks(),
    records: {},
    demoDates: [],
  };
}

function seedToday(state) {
  const t = todayStr();
  const start = state.settings.startDate;
  if (t < start) return state; // arc hasn't started
  const next = structuredClone(state);
  next.records[t] = next.records[t] || { status: {}, overrides: {}, sleep: {}, deepWork: {} };
  next.records[t].status.protein = "completed";
  next.records[t].sleep = { bedtime: "23:20", wake: "07:05" };
  return next;
}

function generateDemoHistory(state) {
  const next = structuredClone(state);
  const start = state.settings.startDate;
  const demoDates = [];
  for (let i = 1; i <= 13; i++) {
    const d = addDaysStr(start, i);
    if (d > state.settings.endDate) break;
    demoDates.push(d);
    const rec = { status: {}, overrides: {}, sleep: {}, deepWork: {} };
    const dow = dayOfWeek(d);
    const roll = () => Math.random();
    for (const task of state.tasks) {
      if (!isScheduledToday(task, d)) continue;
      if (roll() < 0.08 && task.category === "maintenance") {
        rec.overrides[task.id] = { skippedToday: true };
        continue;
      }
      rec.status[task.id] = roll() < 0.82 ? "completed" : undefined;
    }
    const bedH = 22 + Math.floor(roll() * 2);
    const bedM = Math.floor(roll() * 4) * 15;
    const wakeH = 6 + Math.floor(roll() * 2);
    const wakeM = Math.floor(roll() * 4) * 15;
    rec.sleep = { bedtime: `${pad(bedH % 24)}:${pad(bedM)}`, wake: `${pad(wakeH)}:${pad(wakeM)}` };
    const dur = 90 + Math.floor(roll() * 170);
    rec.deepWork = {
      durationMin: dur,
      quality: dur > 150 ? (roll() < 0.6 ? 5 : 4) : Math.ceil(roll() * 4) || 1,
      notes: dur > 150 ? "Strong, focused session." : "Distracted in the back half.",
    };
    next.records[d] = rec;
  }
  next.demoDates = Array.from(new Set([...(state.demoDates || []), ...demoDates]));
  return next;
}

function clearDemoHistory(state) {
  const next = structuredClone(state);
  for (const d of state.demoDates || []) delete next.records[d];
  next.demoDates = [];
  return next;
}

/* ============================== SMALL UI PRIMITIVES ============================== */

function IconBtn({ icon: Icon, onClick, label, danger, active }) {
  return (
    <button
      className={`icon-btn${danger ? " danger" : ""}${active ? " active" : ""}`}
      onClick={onClick}
      aria-label={label}
      title={label}
      type="button"
    >
      <Icon size={16} strokeWidth={2} />
    </button>
  );
}

function Toggle({ checked, onChange, label }) {
  return (
    <button
      type="button"
      className={`toggle${checked ? " on" : ""}`}
      onClick={() => onChange(!checked)}
      aria-pressed={checked}
      aria-label={label}
    >
      <span className="toggle-knob" />
    </button>
  );
}

function StatusBadge({ state }) {
  const map = {
    completed: { icon: CircleCheck, cls: "st-done", label: "Completed" },
    missed: { icon: CircleDashed, cls: "st-missed", label: "Missed" },
    skipped: { icon: CircleSlash, cls: "st-skipped", label: "Excused" },
    notScheduled: { icon: Ban, cls: "st-none", label: "Not scheduled" },
  };
  const m = map[state] || map.notScheduled;
  const I = m.icon;
  return <span className={`status-badge ${m.cls}`}><I size={13} />{m.label}</span>;
}

/* ============================== REMINDER CLOCK ============================== */

function useClock() {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  return now;
}

function getNextTask(state, dateStr, now) {
  const rec = getRecord(state.records, dateStr);

  // Activities do not have scheduled times.
  // Only sleep is time-based.
  if (!(rec.sleep?.bedtime && rec.sleep?.wake)) {
    return {
      kind: "sleep",
      time: state.settings.sleep.idealBedtime,
      minutes: timeToMin(state.settings.sleep.idealBedtime),
      message:
        "It's time for a good night's sleep for better recovery and keeping tomorrow going."
    };
  }

  return null;
}

function ReminderClock({ state, dateStr, onAction }) {
  const now = useClock();
  const next = useMemo(() => getNextTask(state, dateStr, now), [state, dateStr, now]);
  const timeLabel = now.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" });

  if (!state.settings.remindersEnabled) {
    return (
      <div className="clock-panel muted">
        <Clock size={18} />
        <span>Reminders are turned off in Settings.</span>
      </div>
    );
  }

  const secs = Math.round(((next?.diffMin ?? 0) % 1) * 60);
  const totalMin = Math.floor(next?.diffMin ?? 0);
  const hh = Math.floor(totalMin / 60), mm = totalMin % 60;

  let title = "All caught up for today";
  let message = "Nothing left on the clock. Hold the line.";
  let Icon = Sparkles;

  if (next) {
    if (next.kind === "task") {
      title = next.task.name;
      message = next.task.message || "Stay on schedule.";
      Icon = TASK_ICONS[next.task.id] || CATEGORY_META[next.task.category]?.icon || ListChecks;
    } else if (next.kind === "sleep") {
      title = "Sleep";
      message = next.message;
      Icon = Moon;
    } else if (next.kind === "deepwork") {
      title = "Deep Work";
      message = next.message;
      Icon = BookOpen;
    }
  }

  return (
    <div className="clock-panel">
      <div className="clock-top">
        <span className="clock-eyebrow">Next up</span>
        <span className="clock-time">{timeLabel}</span>
      </div>
      <div className="clock-body">
        <div className="clock-icon"><Icon size={26} /></div>
        <div className="clock-info">
          <div className="clock-title">{title}</div>
          <div className="clock-message">{message}</div>
        </div>
      </div>
      {next && (
        <div className={`clock-countdown${next.overdue ? " overdue" : ""}`}>
          <span className="countdown-digits">{pad(hh)}:{pad(mm)}:{pad(secs)}</span>
          <span className="countdown-label">{next.overdue ? "overdue" : "remaining"}</span>
        </div>
      )}
      {next?.kind === "task" && (
        <div className="clock-actions">
          <button className="btn small" onClick={() => onAction("complete", next.task.id)}><Check size={14} />Complete</button>
          <button className="btn small ghost" onClick={() => onAction("skip", next.task.id)}><SkipForward size={14} />Skip today</button>
        </div>
      )}
    </div>
  );
}

/* ============================== TASK ROW ============================== */

function TaskRow({ task, dateStr, record, onToggle, onSkip }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const ov = record.overrides?.[task.id];
  const done = record.status?.[task.id] === "completed";
  const skipped = ov?.skippedToday;
  const Icon = TASK_ICONS[task.id] || CATEGORY_META[task.category]?.icon || ListChecks;

  return (
    <div className={`task-row${done ? " done" : ""}${skipped ? " skipped" : ""}`}>
      <button
        className="task-check"
        onClick={() => !skipped && onToggle(task.id)}
        disabled={skipped}
        aria-label={done ? "Mark incomplete" : "Mark complete"}
      >
        {done ? <Check size={14} /> : skipped ? <SkipForward size={13} /> : null}
      </button>

      <div className="task-icon">
        <Icon size={15} />
      </div>

      <div className="task-main">
        <span className="task-name">{task.name}</span>
      </div>

      {skipped && <span className="task-tag">Excused</span>}

      <div className="task-menu-wrap">
        <IconBtn
          icon={MoreVertical}
          label="Task actions"
          onClick={() => setMenuOpen((v) => !v)}
        />

        {menuOpen && (
          <div className="task-menu" onMouseLeave={() => setMenuOpen(false)}>
            <button onClick={() => {
              onToggle(task.id);
              setMenuOpen(false);
            }}>
              <Check size={13} />
              {done ? "Mark incomplete" : "Mark complete"}
            </button>

            <button onClick={() => {
              onSkip(task.id, !skipped);
              setMenuOpen(false);
            }}>
              <SkipForward size={13} />
              {skipped ? "Undo excuse" : "Skip today (excused)"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}


/* ============================== TODAY VIEW ============================== */

function TodayView({ state, dateStr, setState }) {
  const rec = getRecord(state.records, dateStr);
  const score = useMemo(() => computeDailyScore(state, dateStr), [state, dateStr]);
  const dayIdx = daysBetween(state.settings.startDate, dateStr) + 1;
  const totalDays = daysBetween(state.settings.startDate, state.settings.endDate) + 1;
  const daysRemaining = Math.max(0, daysBetween(dateStr, state.settings.endDate));
  const streaks = useMemo(() => computeStreaks(state), [state]);
  const inArc = dateStr >= state.settings.startDate && dateStr <= state.settings.endDate;

  const updateRecord = useCallback((mutator) => {
    setState((s) => {
      const next = structuredClone(s);
      next.records[dateStr] = next.records[dateStr] || { status: {}, overrides: {}, sleep: {}, deepWork: {} };
      mutator(next.records[dateStr]);
      return next;
    });
  }, [dateStr, setState]);

  const toggleTask = (taskId) => updateRecord((r) => {
    r.status[taskId] = r.status[taskId] === "completed" ? undefined : "completed";
  });
  const skipTask = (taskId, val) => updateRecord((r) => {
    r.overrides[taskId] = { ...(r.overrides[taskId] || {}), skippedToday: val };
  });
  const clockAction = (action, taskId) => {
    if (action === "complete") toggleTask(taskId);
    if (action === "skip") skipTask(taskId, true);
  };

  const setSleep = (field, val) => updateRecord((r) => { r.sleep = { ...r.sleep, [field]: val }; });
  const setDeepWork = (field, val) => updateRecord((r) => { r.deepWork = { ...r.deepWork, [field]: val }; });

  const sleepCalc = rec.sleep?.bedtime && rec.sleep?.wake ? computeSleepQuality(state, dateStr) : null;

  const grouped = useMemo(() => {
    const g = {};
    for (const task of [...state.tasks].sort((a, b) => a.order - b.order)) {
      if (!isScheduledToday(task, dateStr)) continue;
      (g[task.category] = g[task.category] || []).push(task);
    }
    return g;
  }, [state.tasks, dateStr]);

  const [dwHours, setDwHours] = useState(Math.floor((rec.deepWork?.durationMin || 0) / 60));
  const [dwMins, setDwMins] = useState((rec.deepWork?.durationMin || 0) % 60);
  useEffect(() => {
    setDwHours(Math.floor((rec.deepWork?.durationMin || 0) / 60));
    setDwMins((rec.deepWork?.durationMin || 0) % 60);
  }, [dateStr]);
  const commitDuration = (h, m) => setDeepWork("durationMin", Math.max(0, h * 60 + m));

  if (!inArc) {
    return (
      <div className="empty-state">
        <Snowflake size={28} />
        <h3>{dateStr < state.settings.startDate ? "Before the Winter Arc" : "Beyond the Winter Arc"}</h3>
        <p>The arc runs {niceDateShort(state.settings.startDate)} – {niceDateShort(state.settings.endDate)}.</p>
      </div>
    );
  }

  return (
    <div className="today-view">
      <div className="today-head">
        <div>
          <div className="eyebrow-row"><Snowflake size={22} /> <span>Winter Arc</span></div>
          <div className="date-line">{niceDate(dateStr)}</div>
          <div className="day-line">Day {dayIdx} / {totalDays} · {daysRemaining} days remaining</div>
        </div>
        <div className="ring-wrap">
          <ProgressRing pct={score.pct} />
          <div className="ring-sub">
            <Flame size={13} /> {streaks.current} day streak
          </div>
        </div>
      </div>

      <ReminderClock state={state} dateStr={dateStr} onAction={clockAction} />

      {grouped.training && (
        <Section title="Training" catKey="training">
          {grouped.training.map((t) => (
            <TaskRow key={t.id} task={t} dateStr={dateStr} record={rec} onToggle={toggleTask} onSkip={skipTask} />
          ))}
        </Section>
      )}
      {grouped.nutrition && (
        <Section title="Nutrition" catKey="nutrition">
          {grouped.nutrition.map((t) => (
            <TaskRow key={t.id} task={t} dateStr={dateStr} record={rec} onToggle={toggleTask} onSkip={skipTask} />
          ))}
        </Section>
      )}
      {grouped.hydration && (
        <Section title="Hydration" catKey="hydration">
          {grouped.hydration.map((t) => (
            <TaskRow key={t.id} task={t} dateStr={dateStr} record={rec} onToggle={toggleTask} onSkip={skipTask} />
          ))}
        </Section>
      )}

      <Section title="Sleep" catKey="sleep" icon={Moon}>
        <div className="sleep-grid">
          <label className="field">
            <span>Bedtime</span>
            <input type="time" value={rec.sleep?.bedtime || ""} onChange={(e) => setSleep("bedtime", e.target.value)} />
          </label>
          <label className="field">
            <span>Wake time</span>
            <input type="time" value={rec.sleep?.wake || ""} onChange={(e) => setSleep("wake", e.target.value)} />
          </label>
        </div>
        {sleepCalc && (
          <>
            <div className="sleep-readout">
              <span>{minToTime12(timeToMin(rec.sleep.bedtime))} → {minToTime12(timeToMin(rec.sleep.wake))}</span>
              <span className="dot">·</span>
              <span>{durationLabel(sleepCalc.duration)}</span>
              <span className="dot">·</span>
              <span className="quality-pill">Quality {sleepCalc.quality}/6</span>
            </div>
            <div className="sleep-breakdown">
              <span className={sleepCalc.bedtimeScore ? "hit" : ""}><Moon size={11} />Bedtime {sleepCalc.bedtimeScore}/2</span>
              <span className={sleepCalc.wakeScore ? "hit" : ""}><Sunrise size={11} />Wake {sleepCalc.wakeScore}/1</span>
              <span className={sleepCalc.durationScore ? "hit" : ""}><Clock size={11} />Duration {sleepCalc.durationScore}/2</span>
              <span className={sleepCalc.consistencyScore ? "hit" : ""}><Activity size={11} />Consistency {sleepCalc.consistencyScore}/1</span>
            </div>
          </>
        )}
      </Section>

      <Section title="Deep Work" catKey="deepwork" icon={BookOpen}>
        <div className="dw-grid">
          <label className="field small">
            <span>Hours</span>
            <input type="number" min="0" max="12" value={dwHours}
              onChange={(e) => { const h = Number(e.target.value) || 0; setDwHours(h); commitDuration(h, dwMins); }} />
          </label>
          <label className="field small">
            <span>Minutes</span>
            <input type="number" min="0" max="59" step="5" value={dwMins}
              onChange={(e) => { const m = Number(e.target.value) || 0; setDwMins(m); commitDuration(dwHours, m); }} />
          </label>
          <div className={`target-badge${score.dwDone ? " hit" : ""}`}>
            {score.dwDone ? <Check size={13} /> : <CircleDashed size={13} />} 2+ hour target
          </div>
        </div>
        <div className="stars-row">
          {[1, 2, 3, 4, 5].map((n) => (
            <button key={n} className="star-btn" onClick={() => setDeepWork("quality", rec.deepWork?.quality === n ? 0 : n)}>
              <Star size={20} fill={n <= (rec.deepWork?.quality || 0) ? "var(--c-amber)" : "none"} color={n <= (rec.deepWork?.quality || 0) ? "var(--c-amber)" : "var(--text-dim)"} />
            </button>
          ))}
        </div>
        <textarea
          className="notes-field"
          placeholder="Notes on today's focus…"
          value={rec.deepWork?.notes || ""}
          onChange={(e) => setDeepWork("notes", e.target.value)}
        />
      </Section>

      {(grouped.maintenance || grouped.routine) && (
        <Section title="Maintenance & Environment" catKey="maintenance">
          {[...(grouped.routine || []), ...(grouped.maintenance || [])].map((t) => (
            <TaskRow key={t.id} task={t} dateStr={dateStr} record={rec} onToggle={toggleTask} onSkip={skipTask} />
          ))}
        </Section>
      )}

      <div className="today-footer">
        <span>{score.completed} / {score.required} required</span>
        <span className="footer-pct">{score.pct}%</span>
      </div>
    </div>
  );
}

function ProgressRing({ pct }) {
  const r = 30, c = 2 * Math.PI * r;
  const offset = c - (Math.min(100, pct) / 100) * c;
  return (
    <svg width="76" height="76" viewBox="0 0 76 76" className="ring-svg">
      <circle cx="38" cy="38" r={r} className="ring-bg" />
      <circle cx="38" cy="38" r={r} className="ring-fg" strokeDasharray={c} strokeDashoffset={offset} />
      <text x="38" y="34" textAnchor="middle" className="ring-num">{pct}%</text>
      <text x="38" y="48" textAnchor="middle" className="ring-label">today</text>
    </svg>
  );
}

function Section({ title, catKey, icon, children }) {
  const meta = CATEGORY_META[catKey];
  const Icon = icon || meta?.icon || ListChecks;
  return (
    <section className="section-card">
      <div className="section-head">
        <Icon size={16} style={{ color: meta?.color || "var(--c-ice)" }} />
        <h3>{title}</h3>
      </div>
      <div className="section-body">{children}</div>
    </section>
  );
}

/* ============================== ROUTINE EDITOR ============================== */

function FrequencyEditor({ frequency, onChange }) {
  const setType = (type) => onChange({ type, days: frequency.days || [], date: frequency.date || todayStr() });
  return (
    <div className="freq-editor">
      <select value={frequency.type} onChange={(e) => setType(e.target.value)}>
        <option value="daily">Daily</option>
        <option value="weekdays">Specific days</option>
        <option value="oneTime">One-time</option>
        <option value="asNeeded">As needed</option>
        <option value="disabled">Disabled</option>
      </select>
      {frequency.type === "weekdays" && (
        <div className="weekday-picker">
          {WEEKDAY_SHORT.map((w, i) => (
            <button
              key={i}
              type="button"
              className={`wd-btn${(frequency.days || []).includes(i) ? " on" : ""}`}
              onClick={() => {
                const set = new Set(frequency.days || []);
                set.has(i) ? set.delete(i) : set.add(i);
                onChange({ ...frequency, days: Array.from(set).sort() });
              }}
            >{w}</button>
          ))}
        </div>
      )}
      {frequency.type === "oneTime" && (
        <input type="date" value={frequency.date || ""} onChange={(e) => onChange({ ...frequency, date: e.target.value })} />
      )}
    </div>
  );
}

function RoutineTaskCard({ task, onUpdate, onDelete, dragHandleProps }) {
  const [open, setOpen] = useState(false);
  const Icon = TASK_ICONS[task.id] || CATEGORY_META[task.category]?.icon || ListChecks;
  return (
    <div className={`routine-card${task.frequency.type === "disabled" ? " disabled" : ""}`}>
      <div className="routine-card-head">
        <span className="drag-handle" {...dragHandleProps}><GripVertical size={15} /></span>
        <Icon size={15} />
        {task.fixed ? (
          <span className="routine-name">{task.name}</span>
        ) : (
          <input className="routine-name-input" value={task.name} onChange={(e) => onUpdate({ ...task, name: e.target.value })} />
        )}
        <span className="freq-summary">{freqSummary(task.frequency)}</span>
        <Toggle checked={task.frequency.type !== "disabled"} onChange={(v) => onUpdate({ ...task, frequency: { ...task.frequency, type: v ? (task._prevType || "daily") : "disabled" }, _prevType: task.frequency.type })} label="Enable task" />
        <IconBtn icon={ChevronDown} label="Expand" onClick={() => setOpen((v) => !v)} />
        {!task.fixed && <IconBtn icon={Trash2} label="Delete" danger onClick={() => onDelete(task.id)} />}
      </div>
      {open && (
        <div className="routine-card-body">
          <div className="rc-row">
            <label className="field small">
              <span>Category</span>
              <select value={task.category} onChange={(e) => onUpdate({ ...task, category: e.target.value })} disabled={task.fixed}>
                {Object.keys(CATEGORY_META).map((c) => <option key={c} value={c}>{CATEGORY_META[c].label}</option>)}
              </select>
            </label>
            <label className="field small">
              <span>Priority</span>
              <select value={task.priority} onChange={(e) => onUpdate({ ...task, priority: Number(e.target.value) })}>
                <option value={1}>Low</option>
                <option value={2}>Medium</option>
                <option value={3}>High</option>
              </select>
            </label>
          </div>
          <div className="rc-row">
            <label className="field small">
              <span>Frequency</span>
              <FrequencyEditor frequency={task.frequency} onChange={(f) => onUpdate({ ...task, frequency: f })} />
            </label>
          </div>
          <div className="rc-row align-center">
            <Toggle checked={task.reminderEnabled} onChange={(v) => onUpdate({ ...task, reminderEnabled: v })} label="Reminders" />
            <span className="small-label">Show on reminder clock</span>
          </div>
          <label className="field">
            <span>Contextual reminder message</span>
            <input value={task.message} onChange={(e) => onUpdate({ ...task, message: e.target.value })} placeholder="Short, purposeful message…" />
          </label>
        </div>
      )}
    </div>
  );
}

function freqSummary(f) {
  if (f.type === "daily") return "Daily";
  if (f.type === "asNeeded") return "As needed";
  if (f.type === "oneTime") return f.date ? niceDateShort(f.date) : "One-time";
  if (f.type === "disabled") return "Disabled";
  if (f.type === "weekdays") return (f.days || []).length ? (f.days || []).map((d) => WEEKDAY_LABELS[d].slice(0, 3)).join(" ") : "No days set";
  return "";
}

function RoutineView({ state, setState }) {
  const [dragId, setDragId] = useState(null);
  const sorted = [...state.tasks].sort((a, b) => a.order - b.order);

  const updateTask = (updated) => setState((s) => ({ ...s, tasks: s.tasks.map((t) => (t.id === updated.id ? updated : t)) }));
  const deleteTask = (id) => setState((s) => ({ ...s, tasks: s.tasks.filter((t) => t.id !== id) }));
  const addTask = () => {
    const id = "task-" + Date.now();
    setState((s) => ({
      ...s,
      tasks: [...s.tasks, {
        id, name: "New Task", category: "routine", fixed: false,
        frequency: { type: "daily" }, priority: 1,
        reminderEnabled: false, message: "", order: s.tasks.length,
      }],
    }));
  };

  const onDrop = (targetId) => {
    if (!dragId || dragId === targetId) return;
    setState((s) => {
      const list = [...s.tasks].sort((a, b) => a.order - b.order);
      const from = list.findIndex((t) => t.id === dragId);
      const to = list.findIndex((t) => t.id === targetId);
      const [moved] = list.splice(from, 1);
      list.splice(to, 0, moved);
      list.forEach((t, i) => (t.order = i));
      return { ...s, tasks: list };
    });
    setDragId(null);
  };

  return (
    <div className="routine-view">
      <div className="view-head">
        <div>
          <h2>Routine Template</h2>
          <p className="muted-text">Your normal schedule. Drag to reorder — today's adjustments never change this template.</p>
        </div>
        <button className="btn primary" onClick={addTask}><Plus size={15} />Add task</button>
      </div>
      <div className="routine-list">
        {sorted.map((task) => (
          <div
            key={task.id}
            draggable
            onDragStart={() => setDragId(task.id)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => onDrop(task.id)}
          >
            <RoutineTaskCard task={task} onUpdate={updateTask} onDelete={deleteTask} />
          </div>
        ))}
      </div>
    </div>
  );
}

/* ============================== HISTORY VIEW ============================== */

function HistoryView({ state }) {
  const [monthCursor, setMonthCursor] = useState(() => {
    const t = clampDateInRange(todayStr(), state.settings.startDate, state.settings.endDate);
    const d = parseDateStr(t);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-01`;
  });
  const [selected, setSelected] = useState(null);

  const cursorDate = parseDateStr(monthCursor);
  const year = cursorDate.getFullYear(), month = cursorDate.getMonth();
  const firstWeekday = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < firstWeekday; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(`${year}-${pad(month + 1)}-${pad(d)}`);

  const monthLabel = cursorDate.toLocaleDateString(undefined, { month: "long", year: "numeric" });
  const canPrev = `${year}-${pad(month + 1)}-01` > state.settings.startDate;
  const canNext = `${year}-${pad(month + 1)}-01` < state.settings.endDate;

  const shiftMonth = (n) => {
    const d = new Date(year, month + n, 1);
    setMonthCursor(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-01`);
  };

  const colorFor = (dateStr) => {
    if (dateStr < state.settings.startDate || dateStr > state.settings.endDate) return "outside";
    if (dateStr > todayStr() && !state.records[dateStr]) return "future";
    const rec = state.records[dateStr];
    if (!rec) return "empty";
    const { pct } = computeDailyScore(state, dateStr);
    if (pct >= 90) return "lvl4";
    if (pct >= 70) return "lvl3";
    if (pct >= 40) return "lvl2";
    return "lvl1";
  };

  const detail = selected ? computeDailyScore(state, selected) : null;
  const detailRec = selected ? getRecord(state.records, selected) : null;
  const detailSleep = selected && detailRec?.sleep?.bedtime && detailRec?.sleep?.wake ? computeSleepQuality(state, selected) : null;

  return (
    <div className="history-view">
      <div className="view-head">
        <h2>History</h2>
      </div>
      <div className="cal-panel">
        <div className="cal-nav">
          <IconBtn icon={ChevronLeft} label="Previous month" onClick={() => canPrev && shiftMonth(-1)} />
          <span>{monthLabel}</span>
          <IconBtn icon={ChevronRight} label="Next month" onClick={() => canNext && shiftMonth(1)} />
        </div>
        <div className="cal-grid">
          {WEEKDAY_SHORT.map((w, i) => <div key={i} className="cal-dow">{w}</div>)}
          {cells.map((c, i) => c ? (
            <button
              key={i}
              className={`cal-cell ${colorFor(c)}${c === selected ? " selected" : ""}${c === todayStr() ? " is-today" : ""}`}
              onClick={() => setSelected(c)}
            >
              {parseDateStr(c).getDate()}
            </button>
          ) : <div key={i} className="cal-cell blank" />)}
        </div>
        <div className="cal-legend">
          <span><i className="sw lvl1" />Low</span>
          <span><i className="sw lvl2" /></span>
          <span><i className="sw lvl3" /></span>
          <span><i className="sw lvl4" />High</span>
        </div>
      </div>

      {selected && detail && (
        <section className="section-card">
          <div className="section-head"><Calendar size={16} /><h3>{niceDate(selected)}</h3></div>
          <div className="section-body">
            <div className="detail-score">{detail.completed} / {detail.required} required · <strong>{detail.pct}%</strong></div>
            <div className="detail-list">
              {detail.items.map(({ task, state: st }) => (
                <div key={task.id} className="detail-item">
                  <span>{task.name}</span>
                  <StatusBadge state={st} />
                </div>
              ))}
            </div>
            {detailSleep && (
              <div className="detail-block">
                <Moon size={14} /> {minToTime12(timeToMin(detailRec.sleep.bedtime))} → {minToTime12(timeToMin(detailRec.sleep.wake))} · {durationLabel(detailSleep.duration)} · Quality {detailSleep.quality}/6
              </div>
            )}
            {detailRec.deepWork?.durationMin > 0 && (
              <div className="detail-block">
                <BookOpen size={14} /> {durationLabel(detailRec.deepWork.durationMin)} · {"★".repeat(detailRec.deepWork.quality || 0)}{"☆".repeat(5 - (detailRec.deepWork.quality || 0))}
                {detailRec.deepWork.notes && <div className="detail-notes">"{detailRec.deepWork.notes}"</div>}
              </div>
            )}
          </div>
        </section>
      )}
    </div>
  );
}

/* ============================== ANALYTICS VIEW ============================== */

function AnalyticsView({ state }) {
  const { startDate, endDate } = state.settings;
  const today = clampDateInRange(todayStr(), startDate, endDate);
  const dates = [];
  { let c = startDate; while (c <= today) { dates.push(c); c = addDaysStr(c, 1); } }
  const withData = dates.filter((d) => state.records[d]);

  const overallPct = withData.length ? Math.round(withData.reduce((a, d) => a + computeDailyScore(state, d).pct, 0) / withData.length) : 0;
  const streaks = computeStreaks(state);
  const last7 = dates.slice(-7).filter((d) => state.records[d]);
  const weekAdherence = last7.length ? Math.round(last7.reduce((a, d) => a + computeDailyScore(state, d).pct, 0) / last7.length) : 0;
  const curMonth = today.slice(0, 7);
  const monthDates = dates.filter((d) => d.startsWith(curMonth) && state.records[d]);
  const monthAdherence = monthDates.length ? Math.round(monthDates.reduce((a, d) => a + computeDailyScore(state, d).pct, 0) / monthDates.length) : 0;

  const sleepData = withData.filter((d) => state.records[d].sleep?.bedtime && state.records[d].sleep?.wake).map((d) => {
    const s = computeSleepQuality(state, d);
    return { date: niceDateShort(d), duration: +(s.duration / 60).toFixed(1), quality: s.quality };
  });
  const avgSleepDur = sleepData.length ? (sleepData.reduce((a, s) => a + s.duration, 0) / sleepData.length).toFixed(1) : "—";
  const avgSleepQ = sleepData.length ? (sleepData.reduce((a, s) => a + s.quality, 0) / sleepData.length).toFixed(1) : "—";

  const dwData = withData.filter((d) => state.records[d].deepWork?.durationMin).map((d) => ({
    date: niceDateShort(d),
    hours: +(state.records[d].deepWork.durationMin / 60).toFixed(1),
    quality: state.records[d].deepWork.quality || 0,
  }));
  const totalDwHours = dwData.reduce((a, d) => a + d.hours, 0).toFixed(1);
  const avgDwHours = dwData.length ? (totalDwHours / dwData.length).toFixed(1) : "—";

  const fixedIds = ["gym", "cardio", "protein", "hydration"];
  const habitStats = state.tasks.filter((t) => !["routine"].includes(t.category)).map((t) => {
    let req = 0, done = 0;
    for (const d of withData) {
      if (!isScheduledToday(t, d)) continue;
      const ov = state.records[d].overrides?.[t.id];
      if (ov?.skippedToday) continue;
      req++;
      if (state.records[d].status?.[t.id] === "completed") done++;
    }
    return { name: t.name, pct: req ? Math.round((done / req) * 100) : null, req };
  }).filter((h) => h.req > 0);

  return (
    <div className="analytics-view">
      <div className="view-head"><h2>Analytics</h2></div>

      <div className="stat-grid">
        <StatCard label="Overall completion" value={`${overallPct}%`} />
        <StatCard label="Current streak" value={streaks.current} icon={Flame} />
        <StatCard label="Best streak" value={streaks.best} />
        <StatCard label="Weekly adherence" value={`${weekAdherence}%`} />
        <StatCard label="Monthly adherence" value={`${monthAdherence}%`} />
      </div>

      <section className="section-card">
        <div className="section-head"><Moon size={16} /><h3>Sleep</h3></div>
        <div className="section-body">
          <div className="mini-stats">
            <span>Avg duration <strong>{avgSleepDur}h</strong></span>
            <span>Avg quality <strong>{avgSleepQ}/6</strong></span>
          </div>
          {sleepData.length > 1 ? (
            <ResponsiveContainer width="100%" height={180}>
              <LineChart data={sleepData}>
                <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="date" stroke="var(--text-dim)" fontSize={11} tickLine={false} axisLine={false} />
                <YAxis stroke="var(--text-dim)" fontSize={11} tickLine={false} axisLine={false} width={28} />
                <Tooltip contentStyle={{ background: "var(--bg-panel-2)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 }} />
                <Line type="monotone" dataKey="duration" stroke="var(--c-ice)" strokeWidth={2} dot={false} name="Hours" />
                <Line type="monotone" dataKey="quality" stroke="var(--c-mint)" strokeWidth={2} dot={false} name="Quality" />
              </LineChart>
            </ResponsiveContainer>
          ) : <EmptyChart label="Log a few nights of sleep to see the trend." />}
        </div>
      </section>

      <section className="section-card">
        <div className="section-head"><BookOpen size={16} /><h3>Deep Work</h3></div>
        <div className="section-body">
          <div className="mini-stats">
            <span>Total hours <strong>{totalDwHours}h</strong></span>
            <span>Avg / day <strong>{avgDwHours}h</strong></span>
          </div>
          {dwData.length > 1 ? (
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={dwData}>
                <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="date" stroke="var(--text-dim)" fontSize={11} tickLine={false} axisLine={false} />
                <YAxis stroke="var(--text-dim)" fontSize={11} tickLine={false} axisLine={false} width={28} />
                <Tooltip contentStyle={{ background: "var(--bg-panel-2)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 }} />
                <Bar dataKey="hours" radius={[4, 4, 0, 0]}>
                  {dwData.map((d, i) => <Cell key={i} fill={d.quality >= 4 ? "var(--c-ice)" : d.quality >= 2 ? "var(--c-ice-dim)" : "var(--danger)"} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : <EmptyChart label="Log deep work sessions to see duration vs quality." />}
        </div>
      </section>

      <section className="section-card">
        <div className="section-head"><ListChecks size={16} /><h3>Habits</h3></div>
        <div className="section-body">
          {habitStats.length ? habitStats.map((h) => (
            <div key={h.name} className="habit-bar-row">
              <span className="habit-name">{h.name}</span>
              <div className="habit-bar-track"><div className="habit-bar-fill" style={{ width: `${h.pct}%` }} /></div>
              <span className="habit-pct">{h.pct}%</span>
            </div>
          )) : <EmptyChart label="No habit data yet." />}
        </div>
      </section>
    </div>
  );
}

function StatCard({ label, value, icon: Icon }) {
  return (
    <div className="stat-card">
      {Icon && <Icon size={14} className="stat-icon" />}
      <div className="stat-value">{value}</div>
      <div className="stat-label">{label}</div>
    </div>
  );
}
function EmptyChart({ label }) {
  return <div className="empty-chart"><AlertCircle size={14} />{label}</div>;
}

/* ============================== SETTINGS VIEW ============================== */

function SettingsView({ state, setState, onExport, onImport, onClearAll, onLoadDemo, onClearDemo, storageStatus }) {
  const s = state.settings;
  const set = (path, val) => setState((prev) => {
    const next = structuredClone(prev);
    let obj = next.settings;
    const keys = path.split(".");
    for (let i = 0; i < keys.length - 1; i++) obj = obj[keys[i]];
    obj[keys[keys.length - 1]] = val;
    return next;
  });
  const fileRef = useRef(null);

  return (
    <div className="settings-view">
      <div className="view-head"><h2>Settings</h2></div>

      {storageStatus === "unavailable" && (
        <div className="banner warn"><AlertCircle size={15} />Persistent storage isn't available right now — changes will only last this session.</div>
      )}

      <section className="section-card">
        <div className="section-head"><Snowflake size={16} /><h3>Winter Arc</h3></div>
        <div className="section-body">
          <div className="rc-row">
            <label className="field small"><span>Start date</span><input type="date" value={s.startDate} onChange={(e) => set("startDate", e.target.value)} /></label>
            <label className="field small"><span>End date</span><input type="date" value={s.endDate} onChange={(e) => set("endDate", e.target.value)} /></label>
          </div>
        </div>
      </section>

      <section className="section-card">
        <div className="section-head"><Moon size={16} /><h3>Sleep scoring — the 6-pointer rule</h3></div>
        <div className="section-body">
          <p className="muted-text" style={{ maxWidth: "none", marginBottom: 4 }}>
            Sleep gets 0–6 points automatically: Bedtime (0–2, closeness to your desired bedtime),
            Wake time (0–1, whether you woke within the intended schedule), Sleep duration (0–2, whether
            you got enough), and Schedule consistency (0–1, whether tonight matches your recent pattern).
          </p>
          <div className="rc-row">
            <label className="field small"><span>Ideal bedtime</span><input type="time" value={s.sleep.idealBedtime} onChange={(e) => set("sleep.idealBedtime", e.target.value)} /></label>
            <label className="field small"><span>Ideal wake</span><input type="time" value={s.sleep.idealWake} onChange={(e) => set("sleep.idealWake", e.target.value)} /></label>
          </div>
          <div className="rc-row">
            <label className="field small"><span>Min duration (min)</span><input type="number" value={s.sleep.minDurationMin} onChange={(e) => set("sleep.minDurationMin", Number(e.target.value))} /></label>
            <label className="field small"><span>Ideal duration (min)</span><input type="number" value={s.sleep.idealDurationMin} onChange={(e) => set("sleep.idealDurationMin", Number(e.target.value))} /></label>
            <label className="field small"><span>Bedtime/wake tolerance (min)</span><input type="number" value={s.sleep.toleranceMin} onChange={(e) => set("sleep.toleranceMin", Number(e.target.value))} /></label>
          </div>
          <div className="rc-row">
            <label className="field small"><span>Consistency tolerance (min)</span><input type="number" value={s.sleep.consistencyToleranceMin} onChange={(e) => set("sleep.consistencyToleranceMin", Number(e.target.value))} /></label>
            <label className="field small"><span>Consistency lookback (nights)</span><input type="number" value={s.sleep.consistencyLookbackDays} onChange={(e) => set("sleep.consistencyLookbackDays", Number(e.target.value))} /></label>
          </div>
        </div>
      </section>

      <section className="section-card">
        <div className="section-head"><BookOpen size={16} /><h3>Deep work</h3></div>
        <div className="section-body">
          <div className="rc-row">
            <label className="field small"><span>Target (min)</span><input type="number" value={s.deepWorkTargetMin} onChange={(e) => set("deepWorkTargetMin", Number(e.target.value))} /></label>
            <label className="field small"><span>Suggested max (min)</span><input type="number" value={s.deepWorkMaxMin} onChange={(e) => set("deepWorkMaxMin", Number(e.target.value))} /></label>
          </div>
        </div>
      </section>

      <section className="section-card">
        <div className="section-head"><Clock size={16} /><h3>Reminders</h3></div>
        <div className="section-body">
          <div className="rc-row align-center">
            <Toggle checked={s.remindersEnabled} onChange={(v) => set("remindersEnabled", v)} label="Enable reminder clock" />
            <span className="small-label">Show the reminder clock on Today</span>
          </div>
        </div>
      </section>

      <section className="section-card">
        <div className="section-head"><Download size={16} /><h3>Data</h3></div>
        <div className="section-body">
          <div className="btn-row">
            <button className="btn" onClick={onExport}><Download size={14} />Export JSON</button>
            <button className="btn" onClick={() => fileRef.current?.click()}><Upload size={14} />Import JSON</button>
            <input ref={fileRef} type="file" accept="application/json" hidden onChange={(e) => e.target.files[0] && onImport(e.target.files[0])} />
          </div>
          <div className="btn-row">
            <button className="btn" onClick={onLoadDemo}><Sparkles size={14} />Load demo history</button>
            <button className="btn ghost" onClick={onClearDemo}><RotateCcw size={14} />Clear demo data</button>
          </div>
          <div className="btn-row">
            <button className="btn danger" onClick={onClearAll}><Trash2 size={14} />Clear all data</button>
          </div>
        </div>
      </section>
    </div>
  );
}

/* ============================== APP SHELL ============================== */

const NAV = [
  { key: "today", label: "Today", icon: Home },
  { key: "routine", label: "Routine", icon: ListChecks },
  { key: "history", label: "History", icon: Calendar },
  { key: "analytics", label: "Analytics", icon: BarChart3 },
  { key: "settings", label: "Settings", icon: SettingsIcon },
];

function AuthScreen({ onLogin }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    const { error: authError } = await supabase.auth.signInWithPassword({ email, password });
    if (authError) setError(authError.message);
    else onLogin();
    setBusy(false);
  };

  return (
    <div className="wa-root">
      <style>{CSS}</style>
      <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24 }}>
        <form onSubmit={submit} className="section-card" style={{ width: "min(420px, 100%)" }}>
          <div className="section-head"><Snowflake size={18} /><h3>Winter Arc</h3></div>
          <div className="section-body">
            <p className="muted-text" style={{ maxWidth: "none" }}>
              Sign in to access your synced Winter Arc data.
            </p>
            <label className="field">
              <span>Email</span>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
            </label>
            <label className="field">
              <span>Password</span>
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="current-password" />
            </label>
            {error && <div className="banner warn"><AlertCircle size={15} />{error}</div>}
            <button className="btn" type="submit" disabled={busy} style={{ width: "100%", justifyContent: "center" }}>
              {busy ? "Signing in…" : "Sign in"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function App() {
  const [state, setState] = useState(null);
  const [session, setSession] = useState(undefined);
  const [tab, setTab] = useState("today");
  const [storageStatus, setStorageStatus] = useState("loading");
  const [toast, setToast] = useState(null);
  const saveTimer = useRef(null);
  const hydratedRef = useRef(false);
  const dateStr = clampDateInRange(todayStr(), state?.settings.startDate || ARC_START_DEFAULT, state?.settings.endDate || ARC_END_DEFAULT);

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(null), 2200); };

  useEffect(() => {
    let mounted = true;
    const init = async () => {
      const { data: { session: currentSession } } = await supabase.auth.getSession();
      if (!mounted) return;
      setSession(currentSession);
    };
    init();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (!mounted) return;
      setSession(nextSession);
      if (!nextSession) {
        hydratedRef.current = false;
        setState(null);
        setStorageStatus("loading");
      }
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (session === undefined) return;
    if (!session?.user) return;

    let cancelled = false;
    hydratedRef.current = false;
    setState(null);
    setStorageStatus("loading");

    (async () => {
      try {
        const userId = session.user.id;

        const { data: existingProfile, error: profileLookupError } = await supabase
          .from("profiles")
          .select("id")
          .eq("id", userId)
          .maybeSingle();
        if (profileLookupError) throw profileLookupError;
        if (!existingProfile) {
          const { error: profileInsertError } = await supabase.from("profiles").insert({ id: userId });
          if (profileInsertError) throw profileInsertError;
        }

        const [settingsRes, tasksRes, recordsRes] = await Promise.all([
          supabase.from("settings").select("settings").eq("user_id", userId).maybeSingle(),
          supabase.from("tasks").select("id,name,category,fixed,frequency,priority,reminder_enabled,message,task_order").eq("user_id", userId).order("task_order", { ascending: true }),
          supabase.from("daily_records").select("date,record").eq("user_id", userId),
        ]);

        const firstError = settingsRes.error || tasksRes.error || recordsRes.error;
        if (firstError) throw firstError;

        const cloudSettings = settingsRes.data?.settings || null;
        const cloudTasks = tasksRes.data || [];
        const cloudRecords = recordsRes.data || [];

        let nextState;
        if (cloudSettings || cloudTasks.length || cloudRecords.length) {
          const base = defaultState();
          nextState = {
            ...base,
            settings: cloudSettings?.settings || base.settings,
            tasks: cloudTasks.length ? cloudTasks.map((t) => ({
              id: t.id,
              name: t.name,
              category: t.category,
              fixed: t.fixed,
              frequency: t.frequency,
              priority: t.priority,
              reminderEnabled: t.reminder_enabled,
              message: t.message || "",
              order: t.task_order,
            })) : base.tasks,
            records: Object.fromEntries(cloudRecords.map((r) => [r.date, r.record || { status: {}, overrides: {}, sleep: {}, deepWork: {} }])),
            demoDates: cloudSettings?.demoDates || [],
          };
        } else {
          nextState = defaultState();
        }

        if (!cancelled) {
          setState(nextState);
          hydratedRef.current = true;
          setStorageStatus("ok");
        }
      } catch (error) {
        console.error("Winter Arc cloud load failed:", error);
        if (!cancelled) {
          setStorageStatus("unavailable");
          hydratedRef.current = false;
          setState(null);
        }
      }
    })();

    return () => { cancelled = true; };
  }, [session]);

  useEffect(() => {
    if (!state || !session?.user || !hydratedRef.current) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);

    saveTimer.current = setTimeout(async () => {
      try {
        const userId = session.user.id;
        const settingsPayload = { settings: state.settings, demoDates: state.demoDates || [] };

        const { error: settingsError } = await supabase.from("settings").upsert(
          { user_id: userId, settings: settingsPayload, updated_at: new Date().toISOString() },
          { onConflict: "user_id" }
        );
        if (settingsError) throw settingsError;

        const taskRows = state.tasks.map((task) => ({
          id: task.id,
          user_id: userId,
          name: task.name,
          category: task.category,
          fixed: !!task.fixed,
          frequency: task.frequency || {},
          priority: Number(task.priority) || 1,
          reminder_enabled: !!task.reminderEnabled,
          message: task.message || "",
          task_order: Number(task.order) || 0,
        }));

        if (taskRows.length) {
          const { error: tasksError } = await supabase.from("tasks").upsert(taskRows, { onConflict: "user_id,id" });
          if (tasksError) throw tasksError;
        }

        const { data: existingTasks, error: existingTasksError } = await supabase.from("tasks").select("id").eq("user_id", userId);
        if (existingTasksError) throw existingTasksError;
        const currentIds = new Set(state.tasks.map((task) => task.id));
        const removedIds = (existingTasks || []).map((row) => row.id).filter((id) => !currentIds.has(id));
        if (removedIds.length) {
          const { error: deleteTasksError } = await supabase.from("tasks").delete().eq("user_id", userId).in("id", removedIds);
          if (deleteTasksError) throw deleteTasksError;
        }

        const recordRows = Object.entries(state.records || {}).map(([date, record]) => ({
          user_id: userId,
          date,
          record: record || {},
          updated_at: new Date().toISOString(),
        }));

        if (recordRows.length) {
          const { error: recordsError } = await supabase.from("daily_records").upsert(recordRows, { onConflict: "user_id,date" });
          if (recordsError) throw recordsError;
        }

        const { data: existingRecords, error: existingRecordsError } = await supabase.from("daily_records").select("date").eq("user_id", userId);
        if (existingRecordsError) throw existingRecordsError;
        const currentDates = new Set(Object.keys(state.records || {}));
        const removedDates = (existingRecords || []).map((row) => row.date).filter((date) => !currentDates.has(date));
        if (removedDates.length) {
          const { error: deleteRecordsError } = await supabase.from("daily_records").delete().eq("user_id", userId).in("date", removedDates);
          if (deleteRecordsError) throw deleteRecordsError;
        }

        setStorageStatus("ok");
      } catch (error) {
        console.error("Winter Arc cloud save failed:", error);
        setStorageStatus("unavailable");
      }
    }, 500);

    return () => clearTimeout(saveTimer.current);
  }, [state, session]);

  const handleExport = () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `winter-arc-backup-${todayStr()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast("Exported backup");
  };

  const handleImport = (file) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result);
        if (!parsed.settings || !parsed.tasks || !parsed.records) throw new Error("bad shape");
        setState(parsed);
        showToast("Data imported");
      } catch {
        showToast("Import failed — invalid file");
      }
    };
    reader.readAsText(file);
  };

  const handleClearAll = () => {
    if (!confirm("Clear all Winter Arc data? This cannot be undone.")) return;
    setState(defaultState());
    showToast("All data cleared");
  };

  const handleLoadDemo = () => { setState((s) => generateDemoHistory(s)); showToast("Demo history added"); };
  const handleClearDemo = () => { setState((s) => clearDemoHistory(s)); showToast("Demo data removed"); };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
  };

  if (session === undefined) {
    return (
      <div className="wa-root">
        <style>{CSS}</style>
        <div className="boot-loader"><Snowflake size={22} className="spin-slow" /> Connecting to Winter Arc…</div>
      </div>
    );
  }

  if (!session) return <AuthScreen onLogin={() => {}} />;

  if (!state) {
    return (
      <div className="wa-root">
        <style>{CSS}</style>
        <div className="boot-loader"><Snowflake size={22} className="spin-slow" /> Loading your Winter Arc…</div>
      </div>
    );
  }

  return (
    <div className="wa-root">
      <style>{CSS}</style>
      <aside className="sidebar">
        <div className="brand"><Snowflake size={20} /> <span>Winter Arc</span></div>
        <nav>
          {NAV.map((n) => (
            <button key={n.key} className={`nav-btn${tab === n.key ? " active" : ""}`} onClick={() => setTab(n.key)}>
              <n.icon size={17} /><span>{n.label}</span>
            </button>
          ))}
        </nav>
        {state.demoDates?.length > 0 && (
          <div className="demo-flag"><Sparkles size={12} /> Demo data active</div>
        )}
        <button className="nav-btn" onClick={handleSignOut} style={{ marginTop: "auto" }}>
          <X size={17} /><span>Sign out</span>
        </button>
      </aside>

      <main className="main-area">
        <div className="main-inner">
          {tab === "today" && <TodayView state={state} dateStr={dateStr} setState={setState} />}
          {tab === "routine" && <RoutineView state={state} setState={setState} />}
          {tab === "history" && <HistoryView state={state} />}
          {tab === "analytics" && <AnalyticsView state={state} />}
          {tab === "settings" && (
            <SettingsView
              state={state} setState={setState}
              onExport={handleExport} onImport={handleImport} onClearAll={handleClearAll}
              onLoadDemo={handleLoadDemo} onClearDemo={handleClearDemo}
              storageStatus={storageStatus}
            />
          )}
        </div>
      </main>

      <nav className="mobile-tabbar">
        {NAV.map((n) => (
          <button key={n.key} className={`mtab-btn${tab === n.key ? " active" : ""}`} onClick={() => setTab(n.key)}>
            <n.icon size={19} /><span>{n.label}</span>
          </button>
        ))}
      </nav>

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

/* ============================== STYLES ============================== */

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=Inter:wght@400;500;600&display=swap');

.wa-root {
  --bg: #0A0F14;
  --bg-panel: #10171E;
  --bg-panel-2: #161F27;
  --border: #232E38;
  --border-soft: #1B252E;
  --text: #E7EEF2;
  --text-dim: #8CA0AC;
  --c-ice: #7FC7E8;
  --c-ice-dim: #3E6478;
  --c-frost: #C9E8F5;
  --c-mint: #86B89A;
  --c-amber: #D6A75C;
  --c-teal: #66B5B0;
  --c-lilac: #A6A0D8;
  --danger: #C1615A;
  font-family: 'Inter', -apple-system, sans-serif;
  background: radial-gradient(120% 100% at 15% -10%, #101C26 0%, var(--bg) 45%);
  color: var(--text);
  min-height: 100vh;
  display: flex;
  position: relative;
}
.wa-root * { box-sizing: border-box; }
.wa-root h1, .wa-root h2, .wa-root h3 { font-family: 'Space Grotesk', sans-serif; margin: 0; font-weight: 600; }
.wa-root button { font-family: inherit; cursor: pointer; }
.wa-root input, .wa-root select, .wa-root textarea { font-family: inherit; }

.boot-loader { display:flex; align-items:center; gap:10px; margin:auto; color: var(--text-dim); font-size: 14px; }
.spin-slow { animation: spin 3s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }

/* Sidebar (desktop) */
.sidebar {
  width: 220px; flex-shrink: 0; background: var(--bg-panel);
  border-right: 1px solid var(--border-soft); display: flex; flex-direction: column;
  padding: 20px 14px; gap: 22px; position: sticky; top: 0; height: 100vh;
}
.brand { display:flex; align-items:center; gap:9px; font-family:'Space Grotesk',sans-serif; font-weight:700; font-size:16px; color: var(--c-frost); padding: 0 6px; }
.sidebar nav { display: flex; flex-direction: column; gap: 3px; }
.nav-btn { display:flex; align-items:center; gap:11px; padding:9px 12px; border-radius:8px; background:transparent; border:none; color: var(--text-dim); font-size:13.5px; font-weight:500; text-align:left; transition: background .15s, color .15s; }
.nav-btn:hover { background: var(--bg-panel-2); color: var(--text); }
.nav-btn.active { background: rgba(127,199,232,0.12); color: var(--c-ice); }
.demo-flag { margin-top:auto; font-size:11px; color: var(--c-amber); display:flex; gap:6px; align-items:center; padding: 8px 10px; background: rgba(214,167,92,0.08); border-radius: 7px; }

/* Main */
.main-area { flex: 1; min-width: 0; padding-bottom: 70px; }
.main-inner { max-width: 640px; margin: 0 auto; padding: 28px 20px 60px; }

.view-head { display:flex; align-items:flex-end; justify-content:space-between; margin-bottom: 16px; gap: 12px; }
.view-head h2 { font-size: 20px; }
.muted-text { color: var(--text-dim); font-size: 12.5px; margin: 4px 0 0; max-width: 42ch; }

/* Today head */
.today-view { display: flex; flex-direction: column; gap: 16px; }
.today-head { display:flex; justify-content:space-between; align-items:flex-start; }
.eyebrow-row { display:flex; align-items:center; gap:9px; color: var(--c-ice); font-family:'Space Grotesk',sans-serif; font-size:22px; font-weight: 700; letter-spacing: .2px; }
.date-line { font-family:'Space Grotesk',sans-serif; font-size: 16px; font-weight: 500; margin-top: 7px; color: var(--text-dim); }
.day-line { color: var(--text-dim); font-size: 12.5px; margin-top: 3px; }
.ring-wrap { display:flex; flex-direction:column; align-items:center; gap:6px; }
.ring-svg { transform: rotate(-90deg); }
.ring-bg { fill: none; stroke: var(--border); stroke-width: 6; }
.ring-fg { fill: none; stroke: var(--c-ice); stroke-width: 6; stroke-linecap: round; transition: stroke-dashoffset .4s ease; }
.ring-num { transform: rotate(90deg); transform-origin: center; font-family:'Space Grotesk',sans-serif; font-size: 15px; fill: var(--text); font-weight: 600; }
.ring-label { transform: rotate(90deg); transform-origin: center; font-size: 8px; fill: var(--text-dim); }
.ring-sub { display:flex; align-items:center; gap:4px; font-size: 11px; color: var(--c-amber); }

/* Reminder clock */
.clock-panel {
  background: linear-gradient(155deg, rgba(127,199,232,0.09), rgba(22,31,39,0.6));
  backdrop-filter: blur(6px);
  border: 1px solid rgba(127,199,232,0.25);
  border-radius: 14px; padding: 18px; display:flex; flex-direction: column; gap: 12px;
}
.clock-panel.muted { flex-direction: row; align-items:center; gap:10px; color: var(--text-dim); font-size: 13px; background: var(--bg-panel); border-color: var(--border); }
.clock-top { display:flex; justify-content:space-between; align-items:baseline; }
.clock-eyebrow { font-size: 11px; text-transform: none; color: var(--text-dim); font-weight: 500; }
.clock-time { font-family:'Space Grotesk',sans-serif; font-variant-numeric: tabular-nums; font-size: 13px; color: var(--text-dim); }
.clock-body { display:flex; align-items:center; gap: 14px; }
.clock-icon { width:46px; height:46px; border-radius: 11px; background: rgba(127,199,232,0.14); display:flex; align-items:center; justify-content:center; color: var(--c-ice); flex-shrink:0; }
.clock-title { font-family:'Space Grotesk',sans-serif; font-size: 18px; font-weight: 600; color: var(--c-frost); }
.clock-message { color: var(--text-dim); font-size: 12.5px; margin-top: 2px; line-height: 1.4; }
.clock-countdown { display:flex; align-items:baseline; gap: 8px; padding-top: 4px; border-top: 1px solid rgba(127,199,232,0.15); }
.countdown-digits { font-family:'Space Grotesk',sans-serif; font-variant-numeric: tabular-nums; font-size: 26px; font-weight: 600; color: var(--c-frost); letter-spacing: 1px; }
.countdown-label { font-size: 11.5px; color: var(--text-dim); }
.clock-countdown.overdue .countdown-digits { color: var(--danger); }
.clock-countdown.overdue .countdown-label { color: var(--danger); }
.clock-actions { display:flex; gap: 8px; }

/* Buttons */
.btn { display:inline-flex; align-items:center; gap:7px; padding: 8px 13px; border-radius: 8px; background: var(--bg-panel-2); border: 1px solid var(--border); color: var(--text); font-size: 13px; font-weight: 500; transition: border-color .15s, background .15s; }
.btn:hover { border-color: var(--c-ice-dim); }
.btn.primary { background: var(--c-ice); color: #0A1620; border-color: var(--c-ice); font-weight: 600; }
.btn.primary:hover { background: var(--c-frost); }
.btn.ghost { background: transparent; }
.btn.danger { color: var(--danger); border-color: rgba(193,97,90,0.4); background: rgba(193,97,90,0.08); }
.btn.small { padding: 6px 10px; font-size: 12px; }
.btn-row { display:flex; gap: 8px; flex-wrap: wrap; margin-bottom: 10px; }
.btn-row:last-child { margin-bottom: 0; }

.icon-btn { display:flex; align-items:center; justify-content:center; width: 28px; height: 28px; border-radius: 7px; background: transparent; border: none; color: var(--text-dim); }
.icon-btn:hover { background: var(--bg-panel-2); color: var(--text); }
.icon-btn.danger:hover { color: var(--danger); }

.toggle { width: 34px; height: 20px; border-radius: 999px; background: var(--border); border: none; position: relative; flex-shrink: 0; transition: background .15s; }
.toggle.on { background: var(--c-ice); }
.toggle-knob { position:absolute; top:2px; left:2px; width:16px; height:16px; border-radius:50%; background:#fff; transition: transform .15s; }
.toggle.on .toggle-knob { transform: translateX(14px); }

/* Sections */
.section-card { background: var(--bg-panel); border: 1px solid var(--border-soft); border-radius: 12px; }
.section-head { display:flex; align-items:center; gap:9px; padding: 13px 16px; border-bottom: 1px solid var(--border-soft); }
.section-head h3 { font-size: 14.5px; }
.section-body { padding: 12px 14px; display:flex; flex-direction: column; gap: 8px; }

/* Task rows */
.task-row { display:flex; align-items:center; gap: 10px; padding: 8px 6px; border-radius: 8px; position: relative; }
.task-row:hover { background: var(--bg-panel-2); }
.task-check { width: 22px; height: 22px; border-radius: 6px; border: 1.5px solid var(--border); background: transparent; display:flex; align-items:center; justify-content:center; color: var(--bg); flex-shrink:0; }
.task-row.done .task-check { background: var(--c-mint); border-color: var(--c-mint); color: #0A1620; }
.task-row.skipped .task-check { background: var(--bg-panel-2); border-color: var(--border); color: var(--text-dim); }
.task-icon { color: var(--text-dim); flex-shrink: 0; }
.task-main { display:flex; flex-direction: column; flex: 1; min-width: 0; }
.task-name { font-size: 13.5px; font-weight: 500; }
.task-row.done .task-name { color: var(--text-dim); text-decoration: line-through; text-decoration-color: var(--border); }
.task-tag { font-size: 10.5px; color: var(--c-amber); background: rgba(214,167,92,0.12); padding: 2px 7px; border-radius: 5px; flex-shrink:0; }
.task-menu-wrap { position: relative; flex-shrink: 0; }
.task-menu { position:absolute; right:0; top: 32px; background: var(--bg-panel-2); border: 1px solid var(--border); border-radius: 9px; padding: 5px; display:flex; flex-direction:column; z-index: 60; min-width: 170px; box-shadow: 0 8px 24px rgba(0,0,0,0.5); }
.task-menu button { display:flex; align-items:center; gap:8px; padding: 7px 9px; background:none; border:none; color: var(--text); font-size: 12.5px; text-align:left; border-radius: 6px; white-space: nowrap; }
.task-menu button:hover { background: var(--bg-panel); }
.reschedule-pop { position:absolute; right:0; top: 32px; z-index: 61; background: var(--bg-panel-2); border:1px solid var(--border); border-radius:8px; padding:6px; box-shadow: 0 8px 24px rgba(0,0,0,0.5); }
.reschedule-pop input { background: var(--bg); border:1px solid var(--border); color: var(--text); border-radius:6px; padding:5px; }

.status-badge { display:inline-flex; align-items:center; gap:5px; font-size: 11.5px; padding: 3px 8px; border-radius: 6px; }
.status-badge.st-done { color: var(--c-mint); background: rgba(134,184,154,0.12); }
.status-badge.st-missed { color: var(--danger); background: rgba(193,97,90,0.1); }
.status-badge.st-skipped { color: var(--c-amber); background: rgba(214,167,92,0.1); }
.status-badge.st-none { color: var(--text-dim); background: var(--bg-panel-2); }

/* Fields */
.field { display:flex; flex-direction:column; gap: 5px; font-size: 12px; color: var(--text-dim); flex: 1; }
.field.small { flex: 0 0 auto; min-width: 90px; }
.field input, .field select { background: var(--bg-panel-2); border: 1px solid var(--border); color: var(--text); border-radius: 7px; padding: 7px 9px; font-size: 13px; }
.rc-row { display:flex; gap: 12px; flex-wrap: wrap; }
.rc-row.align-center { align-items: center; }
.small-label { font-size: 12.5px; color: var(--text-dim); }

.sleep-grid { display:flex; gap: 14px; }
.sleep-readout { display:flex; align-items:center; gap:8px; font-size: 13px; color: var(--text-dim); font-variant-numeric: tabular-nums; padding-top: 4px; }
.sleep-readout .dot { opacity: .4; }
.quality-pill { color: var(--c-ice); font-weight: 600; }
.sleep-breakdown { display:flex; gap: 10px; flex-wrap: wrap; padding-top: 6px; }
.sleep-breakdown span { display:flex; align-items:center; gap: 4px; font-size: 11px; color: var(--text-dim); background: var(--bg-panel-2); padding: 3px 8px; border-radius: 6px; }
.sleep-breakdown span.hit { color: var(--c-mint); background: rgba(134,184,154,0.12); }

.dw-grid { display:flex; gap: 12px; align-items: flex-end; }
.target-badge { display:flex; align-items:center; gap:6px; font-size: 12px; color: var(--text-dim); background: var(--bg-panel-2); padding: 7px 11px; border-radius: 7px; margin-left: auto; }
.target-badge.hit { color: var(--c-mint); background: rgba(134,184,154,0.12); }
.stars-row { display:flex; gap: 3px; }
.star-btn { background: none; border: none; padding: 2px; }
.notes-field { width: 100%; min-height: 60px; background: var(--bg-panel-2); border: 1px solid var(--border); color: var(--text); border-radius: 8px; padding: 9px 10px; font-size: 13px; resize: vertical; }

.today-footer { display:flex; justify-content:space-between; align-items:center; padding: 10px 4px 0; color: var(--text-dim); font-size: 12.5px; }
.footer-pct { font-family:'Space Grotesk',sans-serif; font-size: 16px; color: var(--c-frost); font-weight: 600; }

.empty-state { display:flex; flex-direction: column; align-items:center; gap: 8px; padding: 60px 20px; color: var(--text-dim); text-align:center; }
.empty-state h3 { color: var(--text); font-size: 15px; }

/* Routine */
.routine-list { display:flex; flex-direction: column; gap: 8px; }
.routine-card { background: var(--bg-panel); border: 1px solid var(--border-soft); border-radius: 10px; }
.routine-card.disabled { opacity: .55; }
.routine-card-head { display:flex; align-items:center; gap: 10px; padding: 10px 12px; }
.drag-handle { color: var(--text-dim); cursor: grab; display:flex; }
.routine-name { font-size: 13.5px; font-weight: 500; flex: 1; }
.routine-name-input { flex:1; background:transparent; border:none; color:var(--text); font-size:13.5px; font-weight:500; border-bottom: 1px dashed transparent; }
.routine-name-input:focus { outline:none; border-bottom-color: var(--c-ice-dim); }
.freq-summary { font-size: 11px; color: var(--text-dim); background: var(--bg-panel-2); padding: 3px 8px; border-radius: 6px; white-space: nowrap; }
.routine-card-body { padding: 4px 12px 14px; display:flex; flex-direction: column; gap: 10px; border-top: 1px solid var(--border-soft); margin-top: 2px; padding-top: 12px; }
.freq-editor { display:flex; gap: 8px; align-items:center; flex-wrap: wrap; }
.freq-editor select { background: var(--bg-panel-2); border: 1px solid var(--border); color: var(--text); border-radius: 7px; padding: 6px 8px; font-size: 12.5px; }
.weekday-picker { display:flex; gap: 4px; }
.wd-btn { width: 26px; height: 26px; border-radius: 50%; background: var(--bg-panel-2); border: 1px solid var(--border); color: var(--text-dim); font-size: 11px; }
.wd-btn.on { background: var(--c-ice); border-color: var(--c-ice); color: #0A1620; font-weight: 600; }

/* History */
.cal-panel { background: var(--bg-panel); border: 1px solid var(--border-soft); border-radius: 12px; padding: 16px; margin-bottom: 14px; }
.cal-nav { display:flex; align-items:center; justify-content: space-between; margin-bottom: 12px; font-family:'Space Grotesk',sans-serif; font-size: 14px; font-weight: 600; }
.cal-grid { display:grid; grid-template-columns: repeat(7, 1fr); gap: 5px; }
.cal-dow { text-align:center; font-size: 10.5px; color: var(--text-dim); padding-bottom: 4px; }
.cal-cell { aspect-ratio: 1; border-radius: 7px; border: 1px solid transparent; background: var(--bg-panel-2); color: var(--text-dim); font-size: 12px; display:flex; align-items:center; justify-content:center; }
.cal-cell.blank { background: transparent; }
.cal-cell.outside, .cal-cell.future { background: transparent; color: var(--border); }
.cal-cell.empty { background: var(--bg-panel-2); color: var(--text-dim); }
.cal-cell.lvl1 { background: rgba(193,97,90,0.35); color: var(--text); }
.cal-cell.lvl2 { background: rgba(214,167,92,0.35); color: var(--text); }
.cal-cell.lvl3 { background: rgba(102,181,176,0.4); color: var(--text); }
.cal-cell.lvl4 { background: rgba(127,199,232,0.55); color: #071019; font-weight: 600; }
.cal-cell.selected { border-color: var(--c-frost); }
.cal-cell.is-today { box-shadow: 0 0 0 1.5px var(--c-ice) inset; }
.cal-legend { display:flex; gap: 10px; margin-top: 10px; font-size: 10.5px; color: var(--text-dim); align-items:center; }
.cal-legend .sw { display:inline-block; width:10px; height:10px; border-radius:3px; margin-right:4px; vertical-align:middle; }
.sw.lvl1 { background: rgba(193,97,90,0.6); } .sw.lvl2 { background: rgba(214,167,92,0.6); } .sw.lvl3 { background: rgba(102,181,176,0.6); } .sw.lvl4 { background: rgba(127,199,232,0.75); }

.detail-score { font-size: 13px; color: var(--text-dim); margin-bottom: 6px; }
.detail-score strong { color: var(--c-frost); font-family:'Space Grotesk',sans-serif; }
.detail-list { display:flex; flex-direction:column; gap: 5px; }
.detail-item { display:flex; justify-content:space-between; align-items:center; font-size: 12.5px; padding: 4px 0; }
.detail-block { display:flex; align-items:flex-start; gap: 8px; font-size: 12.5px; color: var(--text-dim); padding-top: 8px; margin-top: 6px; border-top: 1px solid var(--border-soft); }
.detail-notes { margin-top: 4px; font-style: italic; color: var(--text); }

/* Analytics */
.stat-grid { display:grid; grid-template-columns: repeat(auto-fit, minmax(110px, 1fr)); gap: 8px; margin-bottom: 14px; }
.stat-card { background: var(--bg-panel); border: 1px solid var(--border-soft); border-radius: 10px; padding: 12px; display:flex; flex-direction:column; gap: 2px; }
.stat-icon { color: var(--c-amber); margin-bottom: 2px; }
.stat-value { font-family:'Space Grotesk',sans-serif; font-size: 19px; font-weight: 600; color: var(--c-frost); }
.stat-label { font-size: 10.5px; color: var(--text-dim); }
.mini-stats { display:flex; gap: 16px; font-size: 12.5px; color: var(--text-dim); margin-bottom: 8px; }
.mini-stats strong { color: var(--text); font-family:'Space Grotesk',sans-serif; }
.empty-chart { display:flex; align-items:center; gap: 7px; color: var(--text-dim); font-size: 12.5px; padding: 20px 0; justify-content:center; }
.habit-bar-row { display:flex; align-items:center; gap: 10px; font-size: 12.5px; }
.habit-name { width: 110px; flex-shrink: 0; color: var(--text-dim); }
.habit-bar-track { flex: 1; height: 7px; background: var(--bg-panel-2); border-radius: 4px; overflow: hidden; }
.habit-bar-fill { height: 100%; background: var(--c-ice); border-radius: 4px; }
.habit-pct { width: 34px; text-align: right; color: var(--text-dim); }

/* Banners / toast */
.banner { display:flex; align-items:center; gap: 9px; padding: 10px 13px; border-radius: 9px; font-size: 12.5px; margin-bottom: 12px; }
.banner.warn { background: rgba(214,167,92,0.1); border: 1px solid rgba(214,167,92,0.3); color: var(--c-amber); }
.toast { position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%); background: var(--bg-panel-2); border: 1px solid var(--border); padding: 9px 16px; border-radius: 9px; font-size: 12.5px; z-index: 100; box-shadow: 0 8px 24px rgba(0,0,0,0.4); }

/* Mobile */
.mobile-tabbar { display: none; }
@media (max-width: 860px) {
  .sidebar { display: none; }
  .main-inner { padding: 18px 14px 90px; }
  .mobile-tabbar { display:flex; position: fixed; bottom: 0; left: 0; right: 0; background: var(--bg-panel); border-top: 1px solid var(--border-soft); padding: 6px 4px calc(6px + env(safe-area-inset-bottom)); z-index: 50; }
  .mtab-btn { flex: 1; display:flex; flex-direction: column; align-items:center; gap: 3px; background: none; border: none; color: var(--text-dim); font-size: 10px; padding: 5px 0; }
  .mtab-btn.active { color: var(--c-ice); }
  .today-head { flex-direction: row; }
  .stat-grid { grid-template-columns: repeat(2, 1fr); }
  .habit-name { width: 84px; }
}
`;
