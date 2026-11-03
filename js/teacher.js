import {
  formatDuration,
  formatTimeLabel,
  meetingsOn,
  occurrenceKey,
  paceSegments,
  parsePretend,
  pickOnAir,
  playlistFor,
  schoolParts,
  screenFor,
  shiftParts,
} from "./engine.mjs";
import { connectCloud } from "./cloud.js";
import {
  CHANNEL_NAME,
  STORAGE_KEY,
  blankControl,
  extendPaced,
  message,
  reduceControl,
} from "./sync.mjs";

const params = new URLSearchParams(location.search);
const includeExamples = params.get("examples") === "1";
const root = document.getElementById("app");

const state = {
  schedule: null,
  classes: null,
  procedures: null,
  defaults: null,
  dateContent: null,
  loadedDate: "",
  pretend: null,
  origin: 0,
  control: blankControl(),
  renderKey: "",
  liveKey: "",
  open: { schedule: true, segments: true, notes: false, preview: true },
};

function nowParts() {
  if (!state.pretend) return schoolParts(new Date());
  return shiftParts(state.pretend, (Date.now() - state.origin) / 1000);
}

async function getJson(url) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(url);
  return response.json();
}

function publish(msg) {
  state.control = reduceControl(state.control, msg, msg.occurrence || state.liveKey || "");
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...state.control, v: 1, type: "state" })); } catch { /* ignore */ }
  state.channel?.postMessage(msg);
  state.cloud?.send(msg);
  state.renderKey = "";
}

function adopt(msg) {
  const next = reduceControl(state.control, msg, "");
  if (next === state.control) return;
  state.control = next;
  state.renderKey = "";
}

async function boot() {
  const [schedule, classes, procedures, defaults] = await Promise.all([
    getJson("/data/schedule.json"),
    getJson("/data/classes.json"),
    getJson("/data/procedures.json"),
    getJson("/data/content/default.json"),
  ]);
  state.schedule = schedule;
  state.classes = classes;
  state.procedures = procedures;
  state.defaults = defaults;
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) adopt(JSON.parse(saved));
  } catch { /* ignore */ }
  try {
    state.channel = new BroadcastChannel(CHANNEL_NAME);
    state.channel.onmessage = (event) => adopt(event.data);
  } catch { /* ignore */ }
  window.addEventListener("storage", (event) => {
    if (event.key === STORAGE_KEY && event.newValue) {
      try { adopt(JSON.parse(event.newValue)); } catch { /* ignore */ }
    }
  });
  state.cloud = connectCloud(adopt);
  if (params.get("now")) {
    state.pretend = parsePretend(params.get("now"), schoolParts(new Date()));
    state.origin = Date.now();
  }
  tick();
  setInterval(tick, 250);
}

async function ensureDate(ymd) {
  if (state.loadedDate === ymd) return;
  state.loadedDate = ymd;
  state.dateContent = null;
  const response = await fetch(`/data/content/${ymd}.json`, { cache: "no-store" });
  if (response.ok) state.dateContent = await response.json();
}

function hydrate(segment) {
  if (segment.type !== "procedure") return segment;
  const proc = state.procedures.procedures?.[segment.ref] || {};
  return { ...segment, title: segment.title || proc.title || segment.ref, lines: proc.lines || [] };
}

function plan(meeting, control) {
  const playlist = playlistFor(meeting.classId, meeting.level, state.dateContent, state.defaults);
  const segments = (playlist.segments || []).map(hydrate);
  if (!control.started || control.occurrence !== state.liveKey) return { playlist, paced: segments.map((segment) => ({ ...segment, seconds: Math.round((segment.minutes || 1) * 60) })) };
  const available = Math.max(1, Math.round(meeting.endSec - control.startedAtSec));
  let paced = paceSegments(segments, available, meeting.lengthSec);
  if (control.extendSec) paced = extendPaced(paced, control.index, control.extendSec);
  return { playlist, paced };
}

let ticking = false;
async function tick() {
  if (ticking) return;
  ticking = true;
  try {
    const parts = nowParts();
    await ensureDate(parts.ymd);
    const { day, meetings } = meetingsOn(parts, state.schedule, state.classes, { includeExamples });
    const air = pickOnAir(parts.daySeconds, meetings);
    state.liveKey = air.phase === "class" && air.live ? occurrenceKey(parts.ymd, air.live) : "";
    const started = state.control.started && state.control.occurrence === state.liveKey;
    const screen = screenFor(parts, air, started ? state.liveKey : null);
    paint(parts, day, meetings, air, screen);
  } finally {
    ticking = false;
  }
}

function openDisplay() {
  const url = new URL("/display/", location.origin);
  if (params.get("now")) url.searchParams.set("now", params.get("now"));
  if (includeExamples) url.searchParams.set("examples", "1");
  const win = window.open(url.href, "sca-tv");
  state.tvHint = win
    ? "Drag that window onto the TV, then press F11."
    : "The browser blocked the window. Allow pop-ups for this site, then try Open TV display again.";
  state.renderKey = "";
  tick();
}

function sendStart() {
  if (!state.liveKey) return;
  const parts = nowParts();
  publish(message("class-started", {
    occurrence: state.liveKey,
    startedAtSec: parts.daySeconds,
    segmentStartSec: parts.daySeconds,
    at: Date.now(),
  }));
  tick();
}

function sendIndex(index) {
  const parts = nowParts();
  publish(message("segment", {
    occurrence: state.liveKey,
    index: Math.max(0, index),
    segmentStartSec: parts.daySeconds,
    at: Date.now(),
  }));
  tick();
}

function sendExtend() {
  publish(message("extend", { occurrence: state.liveKey, delta: 60, at: Date.now() }));
  tick();
}

function paint(parts, day, meetings, air, screen) {
  const meeting = screen.meeting || screen.nextClass;
  const key = [screen.mode, state.liveKey, state.control.index, state.control.extendSec, state.control.notes, state.control.started ? 1 : 0].join("|");
  const clock = document.querySelector("[data-clock]");
  if (clock && meeting) {
    const end = screen.mode === "idle" ? meeting.startSec : meeting.endSec;
    clock.textContent = formatDuration((end || 0) - parts.daySeconds);
  }
  if (key === state.renderKey) return;
  state.renderKey = key;
  const { paced } = meeting && screen.mode !== "idle" ? plan(meeting, state.control) : { paced: [] };
  const preview = new URLSearchParams();
  preview.set("preview", "1");
  if (params.get("now")) preview.set("now", params.get("now"));
  if (includeExamples) preview.set("examples", "1");

  root.replaceChildren(el("div", {},
    el("header", { class: "top" },
      el("a", { href: "/teacher/" }, "TEACHER"),
      el("span", { class: "bell", "data-clock": "1" }, meeting ? formatDuration(((screen.mode === "idle" ? meeting.startSec : meeting.endSec) || 0) - parts.daySeconds) : "—"),
    ),
    el("main", {},
      el("section", { class: "status" },
        el("div", {},
          el("h1", {}, meeting ? meeting.title : "No class"),
          el("p", {}, screen.mode === "waiting" ? "Waiting for class" : screen.mode === "running" ? `Part ${state.control.index + 1}` : (meeting ? "Up next" : day.variant.label)),
        ),
        el("div", { class: "rowbtns" },
          screen.mode === "waiting" ? el("button", { class: "go", onclick: sendStart }, "Class Started") : null,
          el("button", { class: "go slim", onclick: openDisplay }, "Open TV display"),
        ),
      ),
      state.tvHint ? el("p", { class: "hint" }, state.tvHint) : null,
      panel("schedule", "Today", scheduleList(parts, meetings, air), true),
      panel("segments", "Segments", segmentPanel(paced, screen), true),
      panel("notes", "Notes", notesBox(), false),
      panel("preview", "TV preview", el("iframe", {
        class: "preview",
        title: "What the TV is showing",
        src: `/?${preview}`,
      }), true),
      el("p", { class: "hint" }, "Open TV display, drag that window onto the TV, then press F11. The laptop and the TV stay in step. Space on the TV starts the class if this page is closed."),
    ),
  ));
}

function scheduleList(parts, meetings, air) {
  return el("div", {}, meetings.map((meeting) => {
    const on = air.live && air.live.classId === meeting.classId && air.live.start === meeting.start;
    return el("div", { class: `slot${on ? " on" : ""}` },
      el("span", {}, formatTimeLabel(meeting.startSec)),
      el("strong", {}, meeting.title),
      el("span", { class: "meta" }, meeting.subject || ""),
    );
  }));
}

function segmentPanel(paced, screen) {
  if (screen.mode !== "running") {
    return el("p", { class: "hint" }, "Segments show here after Class Started.");
  }
  return el("div", {},
    el("div", { class: "rowbtns" },
      el("button", { onclick: () => sendIndex(state.control.index - 1) }, "Prev"),
      el("button", { onclick: () => sendIndex(state.control.index + 1) }, "Next"),
      el("button", { onclick: () => sendIndex(state.control.index + 1) }, "Skip"),
      el("button", { onclick: sendExtend }, "Extend +1 min"),
    ),
    paced.map((segment, index) => el("div", { class: `slot${index === state.control.index ? " on" : ""}` },
      el("span", {}, formatDuration(segment.seconds || 0)),
      el("button", { onclick: () => sendIndex(index) }, segment.title || segment.type || `Part ${index + 1}`),
      el("span", { class: "meta" }, segment.type || ""),
    )),
  );
}

function notesBox() {
  const box = el("textarea", { placeholder: "Notes for you. The TV does not show these." });
  box.value = state.control.notes || "";
  box.addEventListener("change", () => {
    publish(message("notes", { occurrence: state.liveKey, notes: box.value, at: Date.now() }));
  });
  return box;
}

function panel(id, title, body, startOpen) {
  const node = el("details", {}, el("summary", {}, title), body);
  if (state.open[id]) node.open = true;
  node.addEventListener("toggle", () => { state.open[id] = node.open; });
  if (startOpen && state.open[id] === undefined) node.open = true;
  return node;
}

function el(tag, attrs, ...kids) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs || {})) {
    if (value == null || value === false) continue;
    if (key === "class") node.className = value;
    else if (key.startsWith("on") && typeof value === "function") node.addEventListener(key.slice(2).toLowerCase(), value);
    else node.setAttribute(key, value);
  }
  for (const kid of kids.flat()) {
    if (kid == null || kid === false) continue;
    node.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return node;
}

boot();
