import assert from "node:assert/strict";
import test from "node:test";
import {
  blankControl,
  decodeControl,
  encodeControl,
  extendPaced,
  message,
  reduceControl,
} from "../js/sync.mjs";

const OCC = "2026-11-03|hs-stem|28800";

test("Class Started, next, skip, and back are ordered messages", () => {
  let control = blankControl();
  control = reduceControl(control, message("class-started", {
    occurrence: OCC,
    startedAtSec: 28800,
    segmentStartSec: 28800,
    at: 10,
  }), OCC);
  assert.equal(control.started, true);
  assert.equal(control.index, 0);
  assert.equal(control.startedAtSec, 28800);

  control = reduceControl(control, message("segment", {
    occurrence: OCC,
    index: 1,
    segmentStartSec: 29000,
    at: 20,
  }), OCC);
  assert.equal(control.index, 1);

  control = reduceControl(control, message("segment", {
    occurrence: OCC,
    index: 2,
    segmentStartSec: 29200,
    at: 30,
  }), OCC);
  assert.equal(control.index, 2);

  control = reduceControl(control, message("segment", {
    occurrence: OCC,
    index: 1,
    segmentStartSec: 29300,
    at: 40,
  }), OCC);
  assert.equal(control.index, 1);
  assert.equal(control.extendSec, 0);
});

test("an older message and a different period do not move the lesson", () => {
  const control = reduceControl(blankControl(), message("class-started", {
    occurrence: OCC,
    startedAtSec: 28800,
    at: 50,
  }), OCC);
  const stale = reduceControl(control, message("segment", {
    occurrence: OCC,
    index: 4,
    segmentStartSec: 30000,
    at: 40,
  }), OCC);
  assert.equal(stale.index, 0);
  const other = reduceControl(control, message("segment", {
    occurrence: "2026-11-03|ms-stem|32100",
    index: 3,
    segmentStartSec: 32100,
    at: 80,
  }), OCC);
  assert.equal(other.index, 0);
  assert.equal(other.started, true);
});

test("extend steals time from later segments and still ends on the bell", () => {
  const paced = [
    { seconds: 180, minMinutes: 2 },
    { seconds: 600, minMinutes: 3 },
    { seconds: 900, minMinutes: 4, flex: true },
    { seconds: 240, minMinutes: 2 },
  ];
  const sum = (list) => list.reduce((total, segment) => total + segment.seconds, 0);
  const extended = extendPaced(paced, 1, 60);
  assert.equal(sum(extended), sum(paced));
  assert.equal(extended[1].seconds, 660);
  assert.ok(extended[2].seconds < paced[2].seconds || extended[3].seconds < paced[3].seconds);

  let control = reduceControl(blankControl(), message("class-started", {
    occurrence: OCC,
    startedAtSec: 28800,
    at: 5,
  }), OCC);
  control = reduceControl(control, message("extend", { occurrence: OCC, delta: 60, at: 6 }), OCC);
  assert.equal(control.extendSec, 60);
  control = reduceControl(control, message("extend", { occurrence: OCC, delta: 60, at: 7 }), OCC);
  assert.equal(control.extendSec, 120);
});

test("notes sync to the teacher and survive a round trip", () => {
  const control = reduceControl(blankControl(), message("notes", {
    occurrence: OCC,
    notes: "Rogers confirmed 10:35.",
    at: 3,
  }), OCC);
  assert.equal(control.notes, "Rogers confirmed 10:35.");
  const again = decodeControl(encodeControl(control));
  assert.equal(again.notes, control.notes);
  assert.equal(again.started, control.started);
  assert.equal(decodeControl("not json").at, 0);
});
