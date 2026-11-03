import {
  formatDateLabel,
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

const params = new URLSearchParams(location.search);
const includeExamples = params.get("examples") === "1";
const previewStarted = params.get("started") === "1";
const app = document.getElementById("app");
const drawer = document.getElementById("drawer");
const vo = document.getElementById("vo");
const bed = document.getElementById("bed");

const state = {
  schedule: null,
  classes: null,
  procedures: null,
  defaults: null,
  dateContent: null,
  loadedDate: "",
  pretend: null,
  origin: 0,
  view: "idle",
  startedKey: null,
  meeting: null,
  playlist: null,
  paced: [],
  index: 0,
  startedAt: 0,
  paused: false,
  frozen: 0,
  quizAt: 0,
  revealed: -1,
  scores: {},
  absent: new Set(),
  roster: null,
  attOpen: false,
  muted: false,
  renderKey: "",
  clockEnd: null,
  clockStart: null,
  partSeconds: 0,
  jump: Number(params.get("part")) || 0,
};

function nowParts() {
  if (!state.pretend) return schoolParts(new Date());
  return shiftParts(state.pretend, (Date.now() - state.origin) / 1000);
}

function elapsed() {
  if (state.paused) return state.frozen;
  return (performance.now() - state.startedAt) / 1000;
}

async function getJson(url) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(url);
  return response.json();
}

async function boot() {
  try {
    state.muted = localStorage.getItem("sca-mute") === "1";
  } catch { /* private mode */ }
  try {
    const [schedule, classes, procedures, defaults] = await Promise.all([
      getJson("data/schedule.json"),
      getJson("data/classes.json"),
      getJson("data/procedures.json"),
      getJson("data/content/default.json"),
    ]);
    state.schedule = schedule;
    state.classes = classes;
    state.procedures = procedures;
    state.defaults = defaults;
  } catch (error) {
    app.replaceChildren(node("div", { class: "empty" },
      node("div", {},
        node("h1", {}, "Class TV needs its data files"),
        node("p", {}, "Open this page from the site root so data/schedule.json can load."))));
    console.error(error);
    return;
  }
  if (params.get("now")) {
    state.pretend = parsePretend(params.get("now"), schoolParts(new Date()));
    state.origin = Date.now();
  }
  document.addEventListener("keydown", onKey);
  tick();
  setInterval(tick, 200);
}

async function ensureDate(ymd) {
  if (state.loadedDate === ymd) return;
  state.loadedDate = ymd;
  state.dateContent = null;
  const response = await fetch(`data/content/${ymd}.json`, { cache: "no-store" });
  if (response.ok) state.dateContent = await response.json();
}

let ticking = false;
async function tick() {
  if (ticking || !state.schedule) return;
  ticking = true;
  try {
    const parts = nowParts();
    await ensureDate(parts.ymd);
    const { day, meetings } = meetingsOn(parts, state.schedule, state.classes, { includeExamples });
    const air = pickOnAir(parts.daySeconds, meetings);
    let screen = screenFor(parts, air, state.startedKey);
    if (screen.mode === "waiting" && previewStarted && state.pretend && state.startedKey !== screen.key) {
      begin(screen.meeting, parts);
      screen = screenFor(parts, air, state.startedKey);
    }
    if (screen.mode !== "running" && state.view === "run") releaseMedia();
    if (screen.mode === "running") {
      const same = state.view === "run"
        && state.meeting
        && state.meeting.classId === screen.meeting.classId
        && state.meeting.startSec === screen.meeting.startSec;
      if (!same) begin(screen.meeting, parts);
      advance();
      paintRun(parts, day, meetings, air);
    } else if (screen.mode === "waiting") {
      state.view = "waiting";
      state.meeting = screen.meeting;
      paintWaiting(parts, day, meetings, air);
    } else {
      state.view = "idle";
      state.startedKey = null;
      state.meeting = null;
      state.paced = [];
      paintIdle(parts, day, meetings, air, screen);
    }
    updateClocks(parts);
  } finally {
    ticking = false;
  }
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

function begin(meeting, parts) {
  state.startedKey = occurrenceKey(parts.ymd, meeting);
  state.meeting = meeting;
  state.playlist = playlistFor(meeting.classId, meeting.level, state.dateContent, state.defaults);
  const segments = (state.playlist.segments || []).map(hydrate);
  const available = Math.max(1, Math.round(meeting.endSec - parts.daySeconds));
  state.paced = paceSegments(segments, available, meeting.lengthSec);
  state.view = "run";
  state.paused = false;
  state.scores = {};
  state.quizAt = 0;
  state.revealed = -1;
  state.absent = loadAbsent(parts.ymd, meeting.classId);
  state.index = 0;
  state.startedAt = performance.now();
  state.frozen = 0;
  state.renderKey = "";
  if (state.jump > 0) {
    state.index = Math.min(state.paced.length - 1, state.jump - 1);
    state.jump = 0;
  }
  startBed(meeting);
  playVoice();
}

function releaseMedia() {
  vo.onended = null;
  vo.pause();
  vo.removeAttribute("src");
  try { vo.load(); } catch { /* already empty */ }
  bed.pause();
  bed.removeAttribute("src");
  try { bed.load(); } catch { /* already empty */ }
}

function returnToWaiting() {
  releaseMedia();
  state.startedKey = null;
  state.view = "waiting";
  state.paced = [];
  state.attOpen = false;
  drawer.hidden = true;
  state.renderKey = "";
}

function classStarted() {
  if (state.view !== "waiting" || !state.meeting) return;
  begin(state.meeting, nowParts());
  poke();
}

function go(index) {
  if (!state.paced.length) return;
  state.index = Math.max(0, Math.min(state.paced.length - 1, index));
  state.startedAt = performance.now();
  state.frozen = 0;
  state.paused = false;
  state.quizAt = 0;
  state.revealed = -1;
  state.renderKey = "";
  playVoice();
}

function advance() {
  if (state.paused || !state.paced.length) return;
  const current = state.paced[state.index];
  if (!current) return;
  if (elapsed() < current.seconds - 0.05) return;
  if (state.index < state.paced.length - 1) go(state.index + 1);
}

function resync(parts) {
  if (!state.meeting) return;
  const left = Math.max(1, Math.round(state.meeting.endSec - parts.daySeconds));
  const rest = state.paced.slice(state.index).map((segment) => ({ ...segment }));
  const paced = paceSegments(rest, left, left);
  state.paced = state.paced.slice(0, state.index).concat(paced);
  state.startedAt = performance.now();
  state.frozen = 0;
  state.renderKey = "";
}

function togglePause() {
  if (state.view !== "run") return;
  if (state.paused) {
    state.paused = false;
    state.startedAt = performance.now() - state.frozen * 1000;
    if (bed.src && !state.muted) bed.play().catch(() => {});
  } else {
    state.frozen = elapsed();
    state.paused = true;
    bed.pause();
    vo.pause();
  }
  state.renderKey = "";
  poke();
}

function segment() {
  return state.paced[state.index] || {};
}

function playVoice() {
  const current = segment();
  vo.pause();
  if (!current.audio || state.muted) return;
  vo.src = current.audio;
  vo.currentTime = 0;
  vo.play().catch(() => {});
  bed.pause();
  vo.onended = () => {
    if (!state.paused && !state.muted && segment().type === "run-video") bed.play().catch(() => {});
  };
}

function startBed(meeting) {
  const src = meeting.level === "elementary" ? "media/audio/settle-k6.mp3" : "media/audio/settle.mp3";
  if (!bed.src.endsWith(src)) bed.src = src;
  bed.volume = 0.45;
  if (segment().type === "run-video" && !state.muted) bed.play().catch(() => {});
}

function toggleMute() {
  state.muted = !state.muted;
  try { localStorage.setItem("sca-mute", state.muted ? "1" : "0"); } catch { /* ignore */ }
  vo.muted = state.muted;
  bed.muted = state.muted;
  if (state.muted) {
    vo.pause();
    bed.pause();
  }
  state.renderKey = "";
}

function fullscreen() {
  const action = !document.fullscreenElement
    ? document.documentElement.requestFullscreen?.()
    : document.exitFullscreen?.();
  if (action && typeof action.catch === "function") action.catch(() => {});
}

function onKey(event) {
  if (event.target.matches("input, textarea")) return;
  const key = event.key;
  if ((key === " " || key === "Enter") && state.view === "waiting") {
    event.preventDefault();
    classStarted();
    return;
  }
  if (key === "Enter" && state.view === "run") {
    event.preventDefault();
    next();
    return;
  }
  if (key === " ") {
    event.preventDefault();
    togglePause();
  } else if (key === "ArrowRight") {
    next();
  } else if (key === "ArrowLeft") {
    back();
  } else if (key === "a" || key === "A") {
    toggleAtt();
  } else if (key === "f" || key === "F") {
    fullscreen();
  } else if (key === "r" || key === "R") {
    resync(nowParts());
    poke();
  } else if (key === "Escape") {
    if (state.attOpen) toggleAtt();
    else if (state.view === "run") {
      returnToWaiting();
    }
    poke();
  } else if ((key === "s" || key === "S") && state.view === "waiting") {
    classStarted();
  } else if (/^[1-4]$/.test(key) && (segment().type === "quiz" || segment().type === "game")) {
    choose(Number(key) - 1);
  }
}

function next() {
  if (state.view !== "run") return;
  if (state.index < state.paced.length - 1) go(state.index + 1);
  poke();
}

function back() {
  if (state.view !== "run") return;
  if (state.index === 0) returnToWaiting();
  else go(state.index - 1);
  poke();
}

function poke() {
  if (!ticking) void tick();
}


function absentKey(table, student) {
  return `${table}::${student || ""}`;
}

function loadAbsent(ymd, classId) {
  try {
    const raw = sessionStorage.getItem(`sca-absent:${ymd}:${classId}`);
    return new Set(raw ? JSON.parse(raw) : []);
  } catch {
    return new Set();
  }
}

function saveAbsent() {
  if (!state.meeting) return;
  const parts = nowParts();
  try {
    sessionStorage.setItem(
      `sca-absent:${parts.ymd}:${state.meeting.classId}`,
      JSON.stringify([...state.absent]),
    );
  } catch { /* ignore */ }
}

function tableModel() {
  if (state.roster?.length) return state.roster;
  const count = state.meeting?.tables || 4;
  return Array.from({ length: count }, (_, index) => ({ name: `Table ${index + 1}`, students: [] }));
}

function toggleAtt() {
  state.attOpen = !state.attOpen;
  drawer.hidden = !state.attOpen;
  if (state.attOpen) paintDrawer();
}

function paintDrawer() {
  const tables = tableModel();
  let present = 0;
  let total = 0;
  const blocks = tables.map((table) => {
    if (!table.students.length) {
      total += 1;
      const key = absentKey(table.name, "");
      const out = state.absent.has(key);
      if (!out) present += 1;
      return node("section", { class: "tbl" },
        node("button", {
          class: `table-out${out ? " out" : ""}`,
          onclick: () => flip(key),
        }, table.name));
    }
    const kids = table.students.map((student) => {
      total += 1;
      const key = absentKey(table.name, student);
      const out = state.absent.has(key);
      if (!out) present += 1;
      return node("button", {
        class: `student${out ? " out" : ""}`,
        onclick: () => flip(key),
      }, student);
    });
    return node("section", { class: "tbl" }, node("h3", {}, table.name), kids);
  });
  const input = node("input", { type: "file", accept: ".csv,text/csv,text/plain" });
  input.addEventListener("change", () => {
    const file = input.files && input.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      state.roster = parseRoster(String(reader.result || ""), state.meeting.classId);
      paintDrawer();
    };
    reader.readAsText(file);
  });
  drawer.replaceChildren(
    node("h2", {}, "Who's out?"),
    node("p", { class: "count" }, `${present} present · ${total - present} out`),
    node("p", { class: "count" }, "Tap a name to mark them out. Names stay in this tab only."),
    ...blocks,
    node("label", { class: "file-btn" }, "Load roster.csv", input),
    node("p", { class: "count" }, "Columns: class, table, name. See media/roster.example.csv."),
    node("button", { class: "go", onclick: toggleAtt }, "Close"),
  );
}

function flip(key) {
  if (state.absent.has(key)) state.absent.delete(key);
  else state.absent.add(key);
  saveAbsent();
  paintDrawer();
}

function parseRoster(text, classId) {
  const tables = new Map();
  for (const line of text.split(/\r?\n/)) {
    const cols = line.split(",").map((cell) => cell.trim().replace(/^"|"$/g, ""));
    if (cols.length < 3) continue;
    const cls = cols[0].toLowerCase();
    const alias = (cls === "hs" && classId === "hs-stem") || (cls === "ms" && classId === "ms-stem");
    if (cls !== classId && !alias) continue;
    const table = Number(cols[1]);
    if (!table || !cols[2] || /^name$/i.test(cols[2])) continue;
    if (!tables.has(table)) tables.set(table, []);
    tables.get(table).push(cols[2]);
  }
  return [...tables.keys()].sort((a, b) => a - b).map((number) => ({
    name: `Table ${number}`,
    students: tables.get(number),
  }));
}

function choose(index) {
  const questions = segment().questions || [];
  const question = questions[state.quizAt];
  if (!question || index < 0 || index >= (question.options || []).length) return;
  state.revealed = index;
  state.renderKey = "";
  poke();
}

function award(tableName) {
  state.scores[tableName] = (state.scores[tableName] || 0) + 1;
  state.renderKey = "";
  poke();
}

function variantLabel(day) {
  return day.override ? `${day.variant.label} · ${day.override.label}` : day.variant.label;
}

function clockBand({ kicker, attr, text, label, detail, railNode }) {
  const clockAttrs = { class: "clock" };
  if (attr) clockAttrs["data-clock"] = attr;
  return node("section", { class: "clockband" },
    node("div", { class: "clockrow" },
      node("p", { class: "kicker" }, kicker),
      node("p", clockAttrs, text),
      node("div", { class: "clockside" },
        label ? node("p", { class: "clock-label" }, label) : null,
        detail || null,
      ),
    ),
    railNode || null,
  );
}

function shell(parts, day, meetings, air, { centerTitle, centerMeta, clock, left, right, bottom }) {
  return node("div", { class: "shell" },
    pageHeader(parts, variantLabel(day), centerTitle, centerMeta),
    clock,
    node("div", { class: "columns" },
      node("section", { class: "col" }, left),
      node("section", { class: "col" }, right),
    ),
    bottom,
  );
}

function paintIdle(parts, day, meetings, air, screen) {
  const next = screen.nextClass;
  const key = ["idle", parts.ymd, day.variantId, next?.classId || "", next?.start || "", screen.chapel?.title || ""].join("|");
  state.clockEnd = null;
  state.clockStart = next ? next.startSec : null;
  state.partSeconds = 0;
  if (key === state.renderKey) return;
  state.renderKey = key;
  const left = [
    node("p", { class: "kicker" }, screen.chapel ? "Chapel" : (next ? "Up next" : "Today")),
    node("h1", {}, next ? next.title : (day.variantId === "none" ? "No school" : "That's the day")),
    node("p", { class: "lesson" }, next
      ? (next.subject || "")
      : (day.override?.label || "Nothing else is on the board.")),
    next ? node("p", { class: "ends-at" }, `${formatTimeLabel(next.startSec)} – ${formatTimeLabel(next.endSec)}`) : null,
    screen.chapel ? node("p", { class: "lesson" }, "No class in this room.") : null,
  ];
  app.replaceChildren(
    previewBar(parts),
    shell(parts, day, meetings, air, {
      centerTitle: next ? next.title : "Today",
      centerMeta: screen.chapel ? screen.chapel.title : (next?.subject || ""),
      clock: clockBand({
        kicker: next ? "Next class" : "Today",
        attr: next ? "starts" : "",
        text: next ? formatDuration(next.startSec - parts.daySeconds) : "—",
        label: next ? "until it starts" : "",
        detail: next ? node("p", { class: "ends-at" }, `Starts ${formatTimeLabel(next.startSec)}`) : null,
      }),
      left,
      right: dayList(parts, meetings, air),
      bottom: footer(),
    }),
  );
}

function paintWaiting(parts, day, meetings, air) {
  const meeting = air.live;
  const key = ["wait", parts.ymd, meeting.classId, meeting.start].join("|");
  state.clockEnd = meeting.endSec;
  state.clockStart = null;
  state.partSeconds = 0;
  if (key === state.renderKey) return;
  state.renderKey = key;
  const plan = playlistFor(meeting.classId, meeting.level, state.dateContent, state.defaults);
  app.replaceChildren(
    previewBar(parts),
    shell(parts, day, meetings, air, {
      centerTitle: meeting.title,
      centerMeta: `${meeting.blockName || meeting.subject} · ends ${formatTimeLabel(meeting.endSec)}`,
      clock: clockBand({
        kicker: "Until the bell",
        attr: "bell",
        text: formatDuration(meeting.endSec - parts.daySeconds),
        label: "waiting for class",
        detail: node("p", { class: "ends-at" }, `Ends ${formatTimeLabel(meeting.endSec)}`),
      }),
      left: [
        node("p", { class: "kicker" }, "Waiting for class"),
        plan?.title ? node("p", { class: "lesson" }, plan.title) : null,
        meeting.needsConfirmation ? node("p", { class: "confirm" }, meeting.note || "Confirm this time.") : null,
        node("button", { class: "go class-started", "data-start-class": "1", onclick: classStarted }, "Class Started"),
        node("p", { class: "hintkey" }, "Space or Enter"),
      ],
      right: dayList(parts, meetings, air),
      bottom: footer(),
    }),
  );
  document.querySelector("[data-start-class]")?.focus({ preventScroll: true });
}

function paintRun(parts, day, meetings, air) {
  const current = segment();
  const key = [
    "run", state.meeting.classId, state.index, state.quizAt, state.revealed,
    Object.entries(state.scores).join(),
  ].join("|");
  state.clockEnd = state.meeting.endSec;
  state.clockStart = null;
  state.partSeconds = current.seconds || 0;
  if (key === state.renderKey) return;
  state.renderKey = key;
  const nextSeg = state.paced[state.index + 1];
  const nextTitle = nextSeg ? (nextSeg.title || nextSeg.type) : "Bell";
  const lesson = state.playlist?.title || state.meeting.subject;
  const stepWord = current.type === "run-video" || current.type === "youtube" ? "Step back" : "Back";
  app.replaceChildren(
    previewBar(parts),
    shell(parts, day, meetings, air, {
      centerTitle: state.meeting.title,
      centerMeta: `${state.meeting.blockName || state.meeting.subject} · ${Math.round(state.meeting.lengthSec / 60)} min · ends ${formatTimeLabel(state.meeting.endSec)}`,
      clock: clockBand({
        kicker: "Until the bell",
        attr: "bell",
        text: formatDuration(state.meeting.endSec - parts.daySeconds),
        label: node("span", {}, "this part ", node("span", { "data-clock": "part" }, formatDuration(Math.max(0, current.seconds - elapsed()))), " left"),
        detail: node("p", { class: "next" }, `Next · ${nextTitle}`),
        railNode: rail(),
      }),
      left: [
        state.index === 0 && state.playlist?.standby
          ? node("p", { class: "standby" }, state.playlist.standby)
          : node("p", { class: "kicker" }, `Part ${state.index + 1} of ${state.paced.length}`),
        node("h1", {}, current.title || current.type),
        lesson ? node("p", { class: "lesson" }, lesson) : null,
        state.meeting.needsConfirmation ? node("p", { class: "confirm" }, state.meeting.note || "Confirm this time.") : null,
        renderSegment(current),
      ],
      right: dayList(parts, meetings, air),
      bottom: node("div", { class: "controls ctrl" },
        node("button", { onclick: back }, stepWord),
        node("button", { "data-pause": "1", onclick: () => { togglePause(); poke(); } }, state.paused ? "Resume" : "Pause"),
        node("button", { class: "primary", onclick: next }, "Next"),
        node("button", { onclick: toggleAtt }, "Attendance"),
        current.audio ? node("button", { onclick: playVoice }, "Replay") : null,
        node("button", { onclick: () => { resync(nowParts()); poke(); } }, "Refit"),
        node("button", { "data-mute": "1", onclick: () => { toggleMute(); poke(); } }, state.muted ? "Sound on" : "Mute"),
        node("button", { onclick: fullscreen }, "Full screen"),
      ),
    }),
  );
  if (current.type === "run-video" && !state.paused && !state.muted && vo.paused) bed.play().catch(() => {});
}

function renderSegment(current) {
  const type = current.type === "game" ? "quiz" : current.type;
  if (type === "youtube") {
    const id = youtubeId(current.videoId);
    return node("div", {},
      id ? node("div", { class: "frame-wrap" },
        node("iframe", {
          src: `https://www.youtube-nocookie.com/embed/${id}?rel=0`,
          title: current.title || "Lesson video",
          allow: "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture",
          allowfullscreen: "true",
        })) : node("p", { class: "lesson" }, "Add a YouTube video id to this segment."),
      node("button", { class: "go ghost stepback", onclick: back }, "Step back"),
    );
  }
  if (type === "edpuzzle") {
    const url = safeUrl(current.url);
    return node("div", {},
      lines(current.lines),
      url
        ? node("a", { class: "open-link", href: url, target: "_blank", rel: "noopener noreferrer" }, "Open the Edpuzzle assignment")
        : (current.lines?.length ? null : node("p", { class: "lesson" }, "Paste today's Edpuzzle link into this class in the date file.")),
      url && (current.embed || url.includes("/embed/")) ? node("div", { class: "frame-wrap" },
        node("iframe", { src: url, title: current.title || "Edpuzzle", allow: "fullscreen", allowfullscreen: "true" })) : null,
    );
  }
  if (type === "run-video") {
    return node("div", {},
      lines(current.lines?.length ? current.lines : [
        ["The class is working.", "Step back if the screen needs to show the video again."],
      ]),
      node("button", { class: "go stepback", onclick: back }, "Step back"),
    );
  }
  if (type === "quiz") {
    return quiz(current);
  }
  return lines(current.lines);
}

function quiz(current) {
  const questions = current.questions || [];
  const question = questions[state.quizAt];
  if (!question) return node("p", { class: "lesson" }, "Add questions to this segment.");
  const options = (question.options || []).map((option, index) => {
    let cls = "opt";
    if (state.revealed >= 0) {
      if (index === question.answer) cls += " right";
      else if (index === state.revealed) cls += " wrong";
    }
    return node("button", { class: cls, onclick: () => choose(index) }, `${index + 1}  ${option}`);
  });
  const tables = state.revealed >= 0 ? node("div", { class: "scores" },
    tableModel().map((table) => node("button", {
      class: "table-btn",
      onclick: () => award(table.name),
    }, table.name, node("b", {}, String(state.scores[table.name] || 0))))) : null;
  const more = state.revealed >= 0 && state.quizAt < questions.length - 1
    ? node("button", {
      class: "go",
      onclick: () => { state.quizAt += 1; state.revealed = -1; state.renderKey = ""; poke(); },
    }, "Next question")
    : null;
  return node("div", {},
    node("p", { class: "lesson" }, question.q),
    node("div", { class: "opts" }, options),
    tables,
    more,
  );
}

function lines(list) {
  if (!list?.length) return null;
  return node("ol", { class: "lines" }, list.map((line) => {
    const lead = Array.isArray(line) ? line[0] : (line.t || line);
    const detail = Array.isArray(line) ? line[1] : (line.d || "");
    return node("li", {},
      node("strong", {}, lead),
      detail ? node("em", {}, detail) : null);
  }));
}

function rail() {
  return node("div", { class: "rail" }, state.paced.map((item, index) => (
    node("div", { class: `rail-seg${index === state.index ? " on" : ""}`, style: `flex:${Math.max(item.seconds, 1)}` },
      node("span", {}, item.title || item.type))
  )));
}

function dayList(parts, meetings, air) {
  const rows = meetings.map((meeting) => {
    const on = air.live && air.live.classId === meeting.classId && air.live.start === meeting.start;
    const done = meeting.endSec <= parts.daySeconds;
    return node("div", { class: `row${on ? " on" : ""}${done ? " done" : ""}` },
      node("div", { class: "t" }, formatTimeLabel(meeting.startSec).replace(" ", "\u00a0")),
      node("div", { class: "n" }, meeting.title, meeting.needsConfirmation ? node("span", { class: "pill" }, "CONFIRM") : null),
      node("div", { class: "s" }, `${meeting.subject || meeting.blockName} · until ${formatTimeLabel(meeting.endSec)}`),
    );
  });
  return node("aside", { class: "daylist" },
    node("h2", {}, "Today"),
    rows.length ? rows : node("p", { class: "lesson" }, "Nothing scheduled."),
  );
}

function pageHeader(parts, variant, centerTitle, centerMeta) {
  return node("header", { class: "top" },
    node("div", { class: "brand" },
      node("img", { src: "media/logo.png", alt: "Seacoast Christian Academy" }),
      node("div", { class: "word" }, "CLASS TV"),
    ),
    node("div", { class: "classhead" },
      node("div", { class: "date" }, centerTitle || ""),
      centerMeta ? node("div", { class: "meta" }, centerMeta) : null,
    ),
    node("div", { class: "when" },
      node("div", { class: "date" }, formatDateLabel(parts)),
      node("div", { class: "meta" }, variant),
      node("div", { class: "wall", "data-clock": "wall" }, formatTimeLabel(parts.daySeconds)),
    ),
  );
}

function footer() {
  return node("footer", { class: "foot" },
    node("div", {}, "Class Started: Space or Enter · arrows move · A attendance · R refits to the bell"),
    node("div", {},
      node("a", { href: "sites/stem/" }, "STEM shell"),
      " · ",
      node("a", { href: "sites/music/" }, "Music"),
      " · ",
      node("a", { href: "sites/pd/" }, "PD"),
    ),
  );
}

function previewBar(parts) {
  if (!state.pretend) return null;
  return node("div", { class: "preview-bar" },
    `Preview clock · ${formatDateLabel(parts)} · ${formatTimeLabel(parts.daySeconds)} · not the classroom clock`);
}

function updateClocks(parts) {
  const left = state.clockEnd == null ? null : state.clockEnd - parts.daySeconds;
  document.querySelectorAll("[data-clock=bell]").forEach((item) => {
    item.textContent = formatDuration(left);
    item.classList.toggle("soon", left < 300 && left >= 60);
    item.classList.toggle("urgent", left < 60);
  });
  document.querySelectorAll("[data-clock=starts]").forEach((item) => {
    if (state.clockStart == null) return;
    const remain = state.clockStart - parts.daySeconds;
    item.textContent = formatDuration(remain);
    item.classList.toggle("soon", remain < 300 && remain >= 60);
  });
  document.querySelectorAll("[data-clock=part]").forEach((item) => {
    item.textContent = formatDuration(Math.max(0, state.partSeconds - elapsed()));
  });
  document.querySelectorAll("[data-clock=wall]").forEach((item) => {
    item.textContent = formatTimeLabel(parts.daySeconds);
  });
  document.querySelectorAll("[data-pause]").forEach((item) => {
    item.textContent = state.paused ? "Resume" : "Pause";
  });
  document.querySelectorAll("[data-mute]").forEach((item) => {
    item.textContent = state.muted ? "Sound on" : "Mute";
  });
  document.body.classList.toggle("urgent-bell", state.view === "run" && left != null && left < 60);
}

function youtubeId(value) {
  const match = String(value || "").match(/[A-Za-z0-9_-]{6,}/);
  return match ? match[0] : "";
}

function safeUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return "";
    return url.href;
  } catch {
    return "";
  }
}

function node(tag, attrs, ...kids) {
  const element = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs || {})) {
    if (value == null || value === false) continue;
    if (key === "class") element.className = value;
    else if (key.startsWith("on") && typeof value === "function") element.addEventListener(key.slice(2).toLowerCase(), value);
    else element.setAttribute(key, value);
  }
  for (const kid of kids.flat()) {
    if (kid == null || kid === false) continue;
    element.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return element;
}

boot();
