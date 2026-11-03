export const SYNC_VERSION = 1;
export const STORAGE_KEY = "sca-class-tv";
export const CHANNEL_NAME = "sca-class-tv";

export function blankControl() {
  return {
    occurrence: "",
    started: false,
    index: 0,
    startedAtSec: 0,
    segmentStartSec: 0,
    extendSec: 0,
    notes: "",
    at: 0,
  };
}

export function message(type, fields = {}) {
  return { v: SYNC_VERSION, type, at: Date.now(), ...fields };
}

/** Apply a sync message. Older messages and other class periods are ignored. */
export function reduceControl(control, incoming, occurrence) {
  const current = control || blankControl();
  if (!incoming || incoming.v !== SYNC_VERSION || typeof incoming.at !== "number") return current;
  if (incoming.at <= current.at) return current;
  if (occurrence && incoming.occurrence && incoming.occurrence !== occurrence) return current;
  const at = incoming.at;
  switch (incoming.type) {
    case "class-started":
      return {
        ...current,
        occurrence: incoming.occurrence || occurrence || "",
        started: true,
        index: 0,
        startedAtSec: incoming.startedAtSec || 0,
        segmentStartSec: incoming.segmentStartSec ?? incoming.startedAtSec ?? 0,
        extendSec: 0,
        at,
      };
    case "segment":
      return {
        ...current,
        occurrence: incoming.occurrence || current.occurrence,
        started: true,
        index: Math.max(0, incoming.index | 0),
        segmentStartSec: incoming.segmentStartSec ?? current.segmentStartSec,
        extendSec: 0,
        at,
      };
    case "extend":
      return {
        ...current,
        extendSec: Math.max(0, (current.extendSec || 0) + (Number(incoming.delta) || 60)),
        at,
      };
    case "notes":
      return { ...current, notes: String(incoming.notes ?? ""), at };
    case "state":
      return {
        occurrence: incoming.occurrence || "",
        started: Boolean(incoming.started),
        index: Math.max(0, incoming.index | 0),
        startedAtSec: incoming.startedAtSec || 0,
        segmentStartSec: incoming.segmentStartSec || incoming.startedAtSec || 0,
        extendSec: Math.max(0, incoming.extendSec || 0),
        notes: String(incoming.notes || ""),
        at,
      };
    default:
      return current;
  }
}

/** Give the current segment more time by taking it from later segments. The bell does not move. */
export function extendPaced(paced, index, delta) {
  const next = paced.map((segment) => ({ ...segment }));
  if (!next.length || delta <= 0) return next;
  const current = Math.max(0, Math.min(next.length - 1, index));
  let left = Math.round(delta);
  for (let i = next.length - 1; i >= 0 && left > 0; i -= 1) {
    if (i === current) continue;
    const floor = Math.max(15, Math.round((Number(next[i].minMinutes) || 0) * 60));
    const room = Math.max(0, next[i].seconds - floor);
    const cut = Math.min(room, left);
    next[i].seconds -= cut;
    left -= cut;
  }
  next[current].seconds += Math.round(delta) - left;
  return next;
}

export function encodeControl(control) {
  return JSON.stringify({ v: SYNC_VERSION, type: "state", ...control });
}

export function decodeControl(raw) {
  try {
    return reduceControl(blankControl(), JSON.parse(raw), "");
  } catch {
    return blankControl();
  }
}
