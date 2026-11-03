import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  formatDuration,
  meetingsOn,
  occurrenceKey,
  paceSegments,
  parsePretend,
  periodBlock,
  pickOnAir,
  playlistFor,
  screenFor,
  resolvedBells,
  schoolParts,
  shiftParts,
  weekdayOfYmd,
} from "../js/engine.mjs";

const schedule = JSON.parse(readFileSync(new URL("../data/schedule.json", import.meta.url), "utf8"));
const classes = JSON.parse(readFileSync(new URL("../data/classes.json", import.meta.url), "utf8"));
const defaults = JSON.parse(readFileSync(new URL("../data/content/default.json", import.meta.url), "utf8"));
const tuesday = JSON.parse(readFileSync(new URL("../data/content/2026-11-03.json", import.meta.url), "utf8"));

function at(stamp) {
  return parsePretend(stamp, { timeZone: "America/New_York" });
}

function onAir(stamp, options) {
  const parts = at(stamp);
  const { day, meetings } = meetingsOn(parts, schedule, classes, options);
  return { parts, day, meetings, air: pickOnAir(parts.daySeconds, meetings) };
}

function liveClass(stamp, options) {
  return onAir(stamp, options).air.live;
}

test("school clock is America/New_York across the daylight-saving change", () => {
  const edt = schoolParts(new Date("2026-10-06T12:10:30Z"));
  assert.equal(edt.ymd, "2026-10-06");
  assert.equal(edt.weekday, "tue");
  assert.equal(edt.daySeconds, 8 * 3600 + 10 * 60 + 30);

  const est = schoolParts(new Date("2026-11-03T13:10:00Z"));
  assert.equal(est.ymd, "2026-11-03");
  assert.equal(est.weekday, "tue");
  assert.equal(est.daySeconds, 8 * 3600 + 10 * 60);
});

test("pretend time is a school wall clock, not the laptop zone", () => {
  const parts = at("2026-11-05T08:10:30");
  assert.equal(parts.ymd, "2026-11-05");
  assert.equal(parts.weekday, "thu");
  assert.equal(parts.daySeconds, 8 * 3600 + 10 * 60 + 30);
  assert.equal(weekdayOfYmd("2026-11-02"), "mon");
  assert.equal(weekdayOfYmd("2026-11-06"), "fri");
});

test("a pretend clock keeps ticking forward", () => {
  const moved = shiftParts(at("2026-11-03T08:10"), 95);
  assert.equal(moved.daySeconds, 8 * 3600 + 10 * 60 + 95);
  assert.equal(formatDuration(40 * 60), "40:00");
  assert.equal(formatDuration(8), "0:08");
  assert.equal(formatDuration(0), "0:00");
  assert.equal(formatDuration(3661), "1:01:01");
});

test("Monday regular day: HS and MS end on the regular bell", () => {
  const hs = liveClass("2026-11-02T08:10");
  assert.equal(hs.classId, "hs-stem");
  assert.equal(hs.end, "08:50");
  assert.equal(hs.blockName, "Period 1");
  assert.equal(onAir("2026-11-02T08:10").air.endsIn, 40 * 60);
  assert.equal(onAir("2026-11-02T08:10:30").air.endsIn, 40 * 60 - 30);

  const between = onAir("2026-11-02T08:52");
  assert.equal(between.air.phase, "between");
  assert.equal(between.air.live, null);
  assert.equal(between.air.upcoming.classId, "ms-stem");
  assert.equal(between.air.startsIn, 3 * 60);

  const ms = liveClass("2026-11-02T09:00");
  assert.equal(ms.classId, "ms-stem");
  assert.equal(ms.end, "09:45");
  assert.equal(onAir("2026-11-02T09:00").air.endsIn, 45 * 60);
});

test("Monday elementary STEAM follows the resource grid", () => {
  assert.equal(liveClass("2026-11-02T10:00").classId, "e-3a-marsh");
  assert.equal(liveClass("2026-11-02T10:00").end, "10:30");
  assert.equal(liveClass("2026-11-02T10:50").classId, "e-5b-richards");
  assert.equal(liveClass("2026-11-02T10:50").end, "11:15");
  const mclean = liveClass("2026-11-02T11:40");
  assert.equal(mclean.classId, "e-1b-mclean");
  assert.equal(mclean.end, "12:10");
  assert.equal(liveClass("2026-11-02T12:20").classId, "e-2b-felix");
  assert.equal(liveClass("2026-11-02T12:20").end, "12:45");
});

test("Tuesday and Wednesday elementary rows, including Wednesday chapel", () => {
  assert.equal(liveClass("2026-11-03T09:55").classId, "e-2a-bergman");
  assert.equal(liveClass("2026-11-03T10:50").classId, "e-3b-bowlin");
  assert.equal(liveClass("2026-11-03T11:40").classId, "e-5a-rogers");
  assert.equal(liveClass("2026-11-03T11:40").end, "12:00");

  const wedHs = liveClass("2026-11-04T08:20");
  assert.equal(wedHs.classId, "hs-stem");
  assert.equal(wedHs.end, "08:50");
  const chapel = onAir("2026-11-04T08:52");
  assert.equal(chapel.air.phase, "chapel");
  assert.equal(chapel.air.live.title, "Elementary chapel");
  assert.equal(chapel.air.live.end, "08:55");
  assert.equal(chapel.air.endsIn, 3 * 60);
  assert.equal(liveClass("2026-11-04T09:00").classId, "ms-stem");
  assert.equal(liveClass("2026-11-04T10:00").classId, "e-1b-mclean");
  assert.equal(liveClass("2026-11-04T10:50").classId, "e-4a-edwards");
  assert.equal(liveClass("2026-11-04T11:40").classId, "e-6a-culley");
  assert.equal(liveClass("2026-11-04T12:30").classId, "e-k5-walters");
  assert.equal(liveClass("2026-11-04T12:30").end, "13:00");
});

test("Thursday chapel shortens HS and moves MS, then the lab visits", () => {
  const hs = liveClass("2026-11-05T08:10");
  assert.equal(hs.classId, "hs-stem");
  assert.equal(hs.end, "08:40");
  assert.equal(onAir("2026-11-05T08:10").air.endsIn, 30 * 60);

  const chapel = onAir("2026-11-05T09:00");
  assert.equal(chapel.air.phase, "chapel");
  assert.equal(chapel.air.live.title, "MS/HS chapel");
  assert.equal(chapel.air.live.end, "09:25");
  assert.equal(chapel.air.nextClass.classId, "ms-stem");
  assert.equal(chapel.air.nextClass.start, "09:30");

  const ms = liveClass("2026-11-05T09:40");
  assert.equal(ms.classId, "ms-stem");
  assert.equal(ms.end, "10:15");
  assert.equal(onAir("2026-11-05T09:40").air.endsIn, 35 * 60);

  const lab = liveClass("2026-11-05T11:00");
  assert.equal(lab.classId, "e-3a-marsh");
  assert.equal(lab.subject, "Computer lab");
  assert.equal(lab.end, "11:15");
  assert.equal(liveClass("2026-11-05T12:20").classId, "e-2b-felix");
  assert.equal(liveClass("2026-11-05T12:20").subject, "Computer lab");
});

test("Friday Rogers is 10:35–11:15 and King is 11:30–12:05", () => {
  assert.equal(onAir("2026-11-06T10:32").air.phase, "between");
  const rogers = liveClass("2026-11-06T10:40");
  assert.equal(rogers.classId, "e-5a-rogers");
  assert.equal(rogers.start, "10:35");
  assert.equal(rogers.end, "11:15");
  assert.equal(rogers.subject, "STEAM");
  assert.equal(rogers.needsConfirmation, false);
  assert.equal(onAir("2026-11-06T10:40").air.endsIn, 35 * 60);

  const king = liveClass("2026-11-06T11:40");
  assert.equal(king.classId, "e-6b-king");
  assert.equal(king.start, "11:30");
  assert.equal(king.end, "12:05");
  assert.equal(king.needsConfirmation, false);
  assert.equal(onAir("2026-11-06T11:40").air.endsIn, 25 * 60);

  assert.equal(liveClass("2026-11-06T09:55").classId, "e-1a-lesnick");
  assert.equal(liveClass("2026-11-06T12:20").classId, "e-4b-brisolara");
  const richards = liveClass("2026-11-06T13:20");
  assert.equal(richards.classId, "e-5b-richards");
  assert.equal(richards.end, "13:50");
  assert.equal(richards.subject, "STEAM lab");
  assert.equal(richards.needsConfirmation, false);
});

test("periods 1, 2, and chapel match on both lunch waves", () => {
  for (const id of ["regular", "thursday-chapel", "half-day"]) {
    const variant = schedule.variants[id];
    const bells = resolvedBells(variant, schedule);
    for (const blockId of ["1", "2", "chapel"]) {
      const early = (bells.earlyLunch || []).find((block) => block.id === blockId);
      const late = (bells.lateLunch || []).find((block) => block.id === blockId);
      if (!early && !late) continue;
      assert.ok(early && late, `${id} ${blockId} missing on one wave`);
      assert.equal(early.start, late.start, id);
      assert.equal(early.end, late.end, id);
    }
  }
  assert.equal(periodBlock(schedule.variants.wednesday, schedule, "1").end, "08:50");
  assert.equal(periodBlock(schedule.variants["daily-chapel"], schedule, "2").start, "09:30");
  assert.equal(periodBlock(schedule.variants["daily-chapel"], schedule, "2").end, "10:15");
});

test("example overrides stay off until the flag is removed", () => {
  const monday = onAir("2027-01-11T08:10");
  assert.equal(monday.day.variantId, "regular");
  assert.equal(monday.air.live.end, "08:50");

  const emphasis = onAir("2027-01-11T08:10", { includeExamples: true });
  assert.equal(emphasis.day.variantId, "daily-chapel");
  assert.equal(emphasis.day.override.label.includes("Spiritual Emphasis"), true);
  assert.equal(emphasis.air.live.classId, "hs-stem");
  assert.equal(emphasis.air.live.end, "08:40");

  const half = onAir("2026-12-18T11:40", { includeExamples: true });
  assert.equal(half.day.variantId, "half-day");
  assert.equal(half.air.live, null);
  assert.equal(onAir("2026-12-18T09:55", { includeExamples: true }).air.live.classId, "e-1a-lesnick");
  assert.equal(onAir("2026-12-18T08:10", { includeExamples: true }).air.live.end, "08:50");

  const trip = onAir("2026-11-13T10:50", { includeExamples: true });
  assert.equal(trip.air.live, null);
  assert.equal(trip.meetings.some((meeting) => meeting.classId === "e-5a-rogers"), false);
  assert.equal(onAir("2026-11-13T11:40", { includeExamples: true }).air.live.classId, "e-6b-king");
  assert.equal(onAir("2026-11-13T09:55", { includeExamples: true }).air.live.classId, "e-1a-lesnick");

  const closed = onAir("2026-11-26T08:10", { includeExamples: true });
  assert.equal(closed.day.variantId, "none");
  assert.equal(closed.meetings.length, 0);

  const moved = onAir("2026-12-01T08:10", { includeExamples: true });
  assert.equal(moved.air.live.classId, "hs-stem");
  assert.equal(moved.air.live.end, "08:30");
  assert.equal(moved.air.endsIn, 20 * 60);
  assert.equal(onAir("2026-12-01T08:40", { includeExamples: true }).air.live, null);
});

test("no two of Tony's classes are on the clock at once", () => {
  for (const day of ["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06"]) {
    for (let second = 7 * 3600; second < 15 * 3600; second += 30) {
      const parts = { ymd: day, weekday: weekdayOfYmd(day), daySeconds: second };
      const { meetings } = meetingsOn(parts, schedule, classes);
      const live = meetings.filter((meeting) => (
        meeting.kind === "class" && second >= meeting.startSec && second < meeting.endSec
      ));
      assert.ok(live.length <= 1, `${day} ${second} has ${live.map((item) => item.classId).join(",")}`);
      if (live[0]) assert.equal(live[0].endSec - second, pickOnAir(second, meetings).endsIn);
    }
  }
});

test("a late start comes out of the flex block and still ends on the bell", () => {
  const segments = [
    { id: "a", minutes: 5, minMinutes: 3 },
    { id: "b", minutes: 10, minMinutes: 4 },
    { id: "work", minutes: 25, minMinutes: 6, flex: true },
    { id: "c", minutes: 10, minMinutes: 4 },
  ];
  const full = paceSegments(segments, 50 * 60, 50 * 60);
  assert.deepEqual(full.map((segment) => segment.seconds), [300, 600, 1500, 600]);

  const late = paceSegments(segments, 40 * 60, 50 * 60);
  assert.deepEqual(late.map((segment) => segment.seconds), [300, 600, 900, 600]);
  assert.equal(late.reduce((total, segment) => total + segment.seconds, 0), 40 * 60);

  const early = paceSegments(segments, 55 * 60, 50 * 60);
  assert.equal(early.find((segment) => segment.id === "work").seconds, 1800);
  assert.equal(early.reduce((total, segment) => total + segment.seconds, 0), 55 * 60);

  for (let index = 0; index < 40; index += 1) {
    const sample = Array.from({ length: 2 + (index % 5) }, (_, key) => ({
      minutes: 1 + ((key * 3) % 20),
      minMinutes: key % 2,
      flex: key === 2,
    }));
    const fullSeconds = 600 + ((index * 137) % 4000);
    const available = 30 + ((index * 91) % (fullSeconds + 800));
    const paced = paceSegments(sample, available, fullSeconds);
    assert.equal(paced.reduce((total, segment) => total + segment.seconds, 0), available);
    assert.ok(paced.every((segment) => segment.seconds >= 0));
  }
});

test("the TV waits at the bell, then runs only after Class Started", () => {
  const ymd = "2026-11-02";
  const seen = [];
  let last = "";
  for (let second = 7 * 3600 + 50 * 60; second <= 13 * 3600; second += 60) {
    const parts = { ymd, weekday: "mon", daySeconds: second };
    const { meetings } = meetingsOn(parts, schedule, classes);
    const air = pickOnAir(second, meetings);
    const screen = screenFor(parts, air, null);
    if (air.phase === "class") {
      assert.equal(screen.mode, "waiting");
      assert.equal(screen.endsIn, air.live.endSec - second);
      const running = screenFor(parts, air, occurrenceKey(ymd, air.live));
      assert.equal(running.mode, "running");
      assert.equal(running.key, screen.key);
    } else {
      assert.equal(screen.mode, "idle");
    }
    const tag = `${screen.mode}:${screen.meeting?.classId || screen.nextClass?.classId || "done"}`;
    if (tag !== last) {
      seen.push(tag);
      last = tag;
    }
  }
  assert.deepEqual(seen, [
    "idle:hs-stem",
    "waiting:hs-stem",
    "idle:ms-stem",
    "waiting:ms-stem",
    "idle:e-3a-marsh",
    "waiting:e-3a-marsh",
    "idle:e-5b-richards",
    "waiting:e-5b-richards",
    "idle:e-1b-mclean",
    "waiting:e-1b-mclean",
    "idle:e-2b-felix",
    "waiting:e-2b-felix",
    "idle:done",
  ]);
});

test("Thursday chapel is an idle gap that counts down to the next class", () => {
  const parts = at("2026-11-05T09:00");
  const { meetings } = meetingsOn(parts, schedule, classes);
  const air = pickOnAir(parts.daySeconds, meetings);
  const screen = screenFor(parts, air, "leftover-from-hs");
  assert.equal(screen.mode, "idle");
  assert.equal(screen.chapel.title, "MS/HS chapel");
  assert.equal(screen.nextClass.classId, "ms-stem");
  assert.equal(screen.nextClass.start, "09:30");
  assert.equal(screen.startsIn, 30 * 60);
});

test("Class Started refits a late period onto the bell", () => {
  const segments = tuesday.classes["hs-stem"].segments;
  const onTime = paceSegments(segments, 50 * 60, 50 * 60);
  const late = paceSegments(segments, 30 * 60, 50 * 60);
  const sum = (list) => list.reduce((total, segment) => total + segment.seconds, 0);
  assert.equal(sum(onTime), 50 * 60);
  assert.equal(sum(late), 30 * 60);
  const flex = (list) => list.find((segment) => segment.flex).seconds;
  assert.ok(flex(late) < flex(onTime));
});

test("a date file replaces that class and leaves the others on the default", () => {
  const hs = playlistFor("hs-stem", "hs", tuesday, defaults);
  assert.equal(hs.segments.some((segment) => segment.type === "youtube"), true);
  assert.equal(hs.segments.some((segment) => segment.type === "edpuzzle"), true);
  assert.equal(hs.segments.some((segment) => segment.type === "run-video"), true);
  const bowlin = playlistFor("e-3b-bowlin", "elementary", tuesday, defaults);
  assert.equal(bowlin.title, defaults.classes.elementary.title);
  const missing = playlistFor("e-3b-bowlin", "elementary", null, defaults);
  assert.equal(missing.segments[0].ref, "k6-entry");
});
