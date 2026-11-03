import {
  formatDuration,
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
const previewStarted = params.get("started") === "1";
const mirror = params.get("preview") === "1";
const app = document.getElementById("app");
const vo = document.getElementById("vo");

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
  jump: Number(params.get("part")) || 0,
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

function mediaUrl(path) {
  if (!path) return "";
  return path.startsWith("/") ? path : `/${path}`;
}

function publish(msg) {
  if (mirror) return;
  state.control = reduceControl(state.control, msg, msg.occurrence || "");
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...msg, type: "state", ...state.control })); } catch { /* private mode */ }
  state.channel?.postMessage(msg);
  state.cloud?.send(msg);
  state.renderKey = "";
}

function adopt(msg) {
  const occurrence = state.liveKey || "";
  const next = reduceControl(state.control, msg, occurrence);
  if (next === state.control) return;
  state.control = next;
  state.renderKey = "";
}

function bootSync() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) adopt(JSON.parse(saved));
  } catch { /* ignore */ }
  try {
    state.channel = new BroadcastChannel(CHANNEL_NAME);
    state.channel.onmessage = (event) => adopt(event.data);
  } catch { /* older browser */ }
  window.addEventListener("storage", (event) => {
    if (event.key === STORAGE_KEY && event.newValue) {
      try { adopt(JSON.parse(event.newValue)); } catch { /* ignore */ }
    }
  });
  state.cloud = connectCloud(adopt);
}

async function boot() {
  try {
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
    bootSync();
  } catch (error) {
    app.replaceChildren(el("div", { class: "soon" }, el("h1", {}, "Class TV needs its data files")));
    console.error(error);
    return;
  }
  if (params.get("now")) {
    state.pretend = parsePretend(params.get("now"), schoolParts(new Date()));
    state.origin = Date.now();
  }
  if (!mirror) document.addEventListener("keydown", onKey);
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
  return {
    ...segment,
    title: segment.title || proc.title || segment.ref,
    lines: proc.lines || [],
    audio: proc.audio || "",
  };
}

function plan(meeting, control) {
  const playlist = playlistFor(meeting.classId, meeting.level, state.dateContent, state.defaults);
  const segments = (playlist.segments || []).map(hydrate);
  const available = Math.max(1, Math.round(meeting.endSec - control.startedAtSec));
  let paced = paceSegments(segments, available, meeting.lengthSec);
  if (control.extendSec) paced = extendPaced(paced, control.index, control.extendSec);
  return { playlist, paced };
}

let ticking = false;
async function tick() {
  if (ticking || !state.schedule) return;
  ticking = true;
  try {
    const parts = nowParts();
    await ensureDate(parts.ymd);
    const { meetings } = meetingsOn(parts, state.schedule, state.classes, { includeExamples });
    const air = pickOnAir(parts.daySeconds, meetings);
    const liveKey = air.phase === "class" && air.live ? occurrenceKey(parts.ymd, air.live) : "";
    state.liveKey = liveKey;
    if (previewStarted && state.pretend && liveKey && state.control.occurrence !== liveKey) {
      publish(message("class-started", {
        occurrence: liveKey,
        startedAtSec: parts.daySeconds,
        segmentStartSec: parts.daySeconds,
        at: Date.now(),
      }));
    }
    const started = state.control.started && state.control.occurrence === liveKey;
    const screen = screenFor(parts, air, started ? liveKey : null);
    if (screen.mode === "running" && !mirror) {
      const { paced } = plan(screen.meeting, state.control);
      const index = Math.min(state.control.index, Math.max(0, paced.length - 1));
      const dur = paced[index]?.seconds || 0;
      if (state.jump > 0) {
        const jumpTo = Math.min(paced.length - 1, state.jump - 1);
        state.jump = 0;
        publish(message("segment", {
          occurrence: liveKey,
          index: jumpTo,
          segmentStartSec: parts.daySeconds,
          at: Date.now(),
        }));
      } else if (dur && parts.daySeconds >= state.control.segmentStartSec + dur && index < paced.length - 1) {
        publish(message("segment", {
          occurrence: liveKey,
          index: index + 1,
          segmentStartSec: state.control.segmentStartSec + dur,
          at: Date.now(),
        }));
      }
    }
    paint(parts, air, screen);
  } catch (error) {
    app.textContent = String(error && error.stack || error);
    console.error(error);
  } finally {
    ticking = false;
  }
}

function onKey(event) {
  if (event.target.matches("input, textarea")) return;
  if (event.key === " " || event.key === "Enter") {
    if (state.view === "waiting" && state.liveKey) {
      event.preventDefault();
      const parts = nowParts();
      publish(message("class-started", {
        occurrence: state.liveKey,
        startedAtSec: parts.daySeconds,
        segmentStartSec: parts.daySeconds,
        at: Date.now(),
      }));
    }
  } else if (event.key === "ArrowRight" && state.view === "run") {
    nudge(1);
  } else if (event.key === "ArrowLeft" && state.view === "run") {
    nudge(-1);
  }
}

function nudge(dir) {
  const parts = nowParts();
  const index = Math.max(0, state.control.index + dir);
  publish(message("segment", {
    occurrence: state.liveKey,
    index,
    segmentStartSec: parts.daySeconds,
    at: Date.now(),
  }));
}

function paint(parts, air, screen) {
  const meeting = screen.meeting || screen.nextClass;
  const key = [
    screen.mode,
    meeting?.classId || "",
    meeting?.start || "",
    state.control.index,
    state.control.extendSec,
    state.control.started ? "1" : "0",
  ].join("|");
  state.view = screen.mode === "running" ? "run" : screen.mode;
  if (key === state.renderKey) {
    updateClock(parts, screen);
    return;
  }
  state.renderKey = key;
  if (screen.mode === "running") paintLesson(parts, screen);
  else if (screen.mode === "waiting") paintSoon(parts, screen, "Class starting soon");
  else paintSoon(parts, screen, screen.nextClass ? "Up next" : "That's the day");
  updateClock(parts, screen);
}

function paintSoon(parts, screen, kicker) {
  const meeting = screen.mode === "waiting" ? screen.meeting : screen.nextClass;
  const end = screen.mode === "waiting" ? meeting?.endSec : meeting?.startSec;
  app.replaceChildren(el("main", { class: "soon" },
    el("p", { class: "kicker" }, kicker),
    el("h1", {}, meeting ? meeting.title : "No class"),
    meeting ? el("p", { class: "big", "data-clock": "main" }, formatDuration((end || 0) - parts.daySeconds)) : null,
    meeting ? el("p", { class: "quiet" }, screen.mode === "waiting" ? "until the bell" : "until it starts") : null,
  ));
  stopVoice();
}

function paintLesson(parts, screen) {
  const { playlist, paced } = plan(screen.meeting, state.control);
  const index = Math.min(state.control.index, Math.max(0, paced.length - 1));
  const current = paced[index] || {};
  app.replaceChildren(el("div", { class: "run" },
    el("header", { class: "bar" },
      el("p", { class: "who" }, screen.meeting.title),
      el("p", { class: "bell", "data-clock": "bar" }, formatDuration(screen.meeting.endSec - parts.daySeconds)),
    ),
    el("main", { class: "stage" },
      el("p", { class: "kicker" }, current.title || ""),
      playlist?.title ? el("p", { class: "quiet" }, playlist.title) : null,
      segmentBody(current),
    ),
  ));
  playVoice(current);
}

function segmentBody(current) {
  const type = current.type === "game" ? "quiz" : current.type;
  if (type === "youtube") {
    const id = youtubeId(current.videoId);
    return id
      ? el("div", { class: "frame-slot" }, el("div", { class: "frame-wrap" },
        el("iframe", {
          src: `https://www.youtube-nocookie.com/embed/${id}?rel=0`,
          title: current.title || "Lesson video",
          allow: "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture",
          allowfullscreen: "true",
        })))
      : el("p", { class: "quiet" }, "No video for this part.");
  }
  if (type === "edpuzzle") {
    const url = safeUrl(current.url);
    const frame = url && (current.embed || url.includes("/embed/"))
      ? el("div", { class: "frame-slot" }, el("div", { class: "frame-wrap" },
        el("iframe", { src: url, title: current.title || "Edpuzzle", allowfullscreen: "true" })))
      : null;
    return el("div", { class: "stack" }, lines(current.lines), frame);
  }
  if (type === "quiz") {
    const question = (current.questions || [])[0];
    if (!question) return el("p", { class: "quiet" }, "No question.");
    return el("div", { class: "stack" },
      el("p", { class: "ask" }, question.q),
      el("ol", { class: "opts" }, (question.options || []).map((option) => el("li", {}, option))));
  }
  return lines(current.lines);
}

function lines(list) {
  if (!list?.length) return null;
  return el("ol", { class: "lines" }, list.map((line) => {
    const lead = Array.isArray(line) ? line[0] : line;
    const detail = Array.isArray(line) ? line[1] : "";
    return el("li", {}, el("strong", {}, lead), detail ? el("em", {}, detail) : null);
  }));
}

function updateClock(parts, screen) {
  const meeting = screen.mode === "running" || screen.mode === "waiting" ? screen.meeting : screen.nextClass;
  const end = screen.mode === "waiting" || screen.mode === "running" ? meeting?.endSec : meeting?.startSec;
  const text = meeting ? formatDuration((end || 0) - parts.daySeconds) : "";
  document.querySelectorAll("[data-clock]").forEach((node) => { node.textContent = text; });
  const who = document.querySelector(".who");
  if (who && meeting && screen.mode === "running") who.textContent = meeting.title;
}

function playVoice(current) {
  if (!current?.audio || vo.dataset.for === current.audio) return;
  vo.dataset.for = current.audio;
  vo.src = mediaUrl(current.audio);
  vo.play().catch(() => {});
}

function stopVoice() {
  vo.pause();
  vo.removeAttribute("src");
  delete vo.dataset.for;
}

function youtubeId(value) {
  const match = String(value || "").match(/[A-Za-z0-9_-]{6,}/);
  return match ? match[0] : "";
}

function safeUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.href : "";
  } catch {
    return "";
  }
}

function el(tag, attrs, ...kids) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs || {})) {
    if (value == null || value === false) continue;
    if (key === "class") node.className = value;
    else node.setAttribute(key, value);
  }
  for (const kid of kids.flat()) {
    if (kid == null || kid === false) continue;
    node.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return node;
}

boot();
