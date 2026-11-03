/**
 * Bell schedule, class lookup, and segment pacing for the Class TV.
 * Pure functions: no DOM, no network. The browser and the node tests both use this.
 */

const WEEKDAYS = {
  Mon: "mon",
  Tue: "tue",
  Wed: "wed",
  Thu: "thu",
  Fri: "fri",
  Sat: "sat",
  Sun: "sun",
};

export function schoolParts(date, timeZone = "America/New_York") {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const bag = {};
  for (const part of fmt.formatToParts(date)) bag[part.type] = part.value;
  let hour = Number(bag.hour);
  if (hour === 24) hour = 0;
  const minute = Number(bag.minute);
  const second = Number(bag.second);
  return {
    ymd: `${bag.year}-${bag.month}-${bag.day}`,
    weekday: WEEKDAYS[bag.weekday] || "",
    hour,
    minute,
    second,
    daySeconds: hour * 3600 + minute * 60 + second,
    timeZone,
  };
}

export function parseClock(hhmm) {
  const match = String(hhmm).trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!match) throw new Error(`Bad clock time: ${hhmm}`);
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  const second = Number(match[3] || 0);
  if (hour > 23 || minute > 59 || second > 59) throw new Error(`Bad clock time: ${hhmm}`);
  return hour * 3600 + minute * 60 + second;
}

export function formatDuration(totalSeconds) {
  const seconds = Math.max(0, Math.ceil(totalSeconds - 1e-9));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  const mm = String(minutes).padStart(2, "0");
  const ss = String(secs).padStart(2, "0");
  if (hours > 0) return `${hours}:${mm}:${ss}`;
  return `${minutes}:${ss}`;
}

export function formatTimeLabel(daySeconds) {
  const wrapped = ((Math.floor(daySeconds) % 86400) + 86400) % 86400;
  let hour = Math.floor(wrapped / 3600);
  const minute = Math.floor((wrapped % 3600) / 60);
  const suffix = hour >= 12 ? "PM" : "AM";
  hour %= 12;
  if (hour === 0) hour = 12;
  return `${hour}:${String(minute).padStart(2, "0")} ${suffix}`;
}

export function formatDateLabel(parts) {
  const [year, month, day] = parts.ymd.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day, 17, 0, 0));
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(date);
}

function addDays(ymd, delta) {
  const [year, month, day] = ymd.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + delta, 17, 0, 0));
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function weekdayOfYmd(ymd) {
  const [year, month, day] = ymd.split("-").map(Number);
  return schoolParts(new Date(Date.UTC(year, month - 1, day, 17, 0, 0))).weekday;
}

/** `YYYY-MM-DDTHH:MM` or `HH:MM`, read as the school wall clock. */
export function parsePretend(raw, base) {
  const text = String(raw).trim();
  let ymd = base?.ymd;
  let clock = text;
  const full = text.match(/^(\d{4}-\d{2}-\d{2})[T\s](\d{1,2}:\d{2}(?::\d{2})?)$/);
  if (full) {
    ymd = full[1];
    clock = full[2];
  }
  if (!ymd) throw new Error("Pretend time needs a date");
  return {
    ymd,
    weekday: weekdayOfYmd(ymd),
    daySeconds: parseClock(clock),
    timeZone: base?.timeZone || "America/New_York",
    pretend: true,
  };
}

export function shiftParts(parts, deltaSeconds) {
  let daySeconds = parts.daySeconds + deltaSeconds;
  let ymd = parts.ymd;
  while (daySeconds >= 86400) {
    daySeconds -= 86400;
    ymd = addDays(ymd, 1);
  }
  while (daySeconds < 0) {
    daySeconds += 86400;
    ymd = addDays(ymd, -1);
  }
  return {
    ...parts,
    ymd,
    weekday: weekdayOfYmd(ymd),
    daySeconds,
  };
}

export function activeOverrides(schedule, { includeExamples = false } = {}) {
  return (schedule.overrides || []).filter((row) => includeExamples || !row.example);
}

export function resolveDay(parts, schedule, options = {}) {
  const hits = activeOverrides(schedule, options).filter((row) => {
    const dates = row.dates || (row.date ? [row.date] : []);
    return dates.includes(parts.ymd);
  });
  const override = hits.length ? hits[hits.length - 1] : null;
  const variantId = override?.variant || schedule.defaults?.[parts.weekday] || "none";
  const variant = schedule.variants?.[variantId] || schedule.variants?.none || { label: "No school" };
  return { variantId, variant, override };
}

export function resolvedBells(variant, schedule) {
  if (variant?.sameBellsAs) {
    const base = schedule.variants?.[variant.sameBellsAs];
    if (!base) throw new Error(`Unknown sameBellsAs: ${variant.sameBellsAs}`);
    return resolvedBells(base, schedule);
  }
  return variant?.bells || { earlyLunch: [], lateLunch: [] };
}

export function periodBlock(variant, schedule, blockId) {
  const bells = resolvedBells(variant, schedule);
  const early = (bells.earlyLunch || []).find((block) => block.id === blockId) || null;
  const late = (bells.lateLunch || []).find((block) => block.id === blockId) || null;
  return early || late;
}

function pushMeeting(list, meeting) {
  const startSec = parseClock(meeting.start);
  const endSec = parseClock(meeting.end);
  if (endSec <= startSec) return;
  list.push({ ...meeting, startSec, endSec, lengthSec: endSec - startSec });
}

export function meetingsOn(parts, schedule, classFile, options = {}) {
  const day = resolveDay(parts, schedule, options);
  const cancel = new Set(day.override?.cancelClasses || []);
  const retimes = day.override?.retimes || {};
  const meetings = [];
  const classes = classFile.classes || classFile;

  if (day.variantId !== "none") {
    for (const cls of classes) {
      if (cancel.has(cls.id)) continue;
      for (const meet of cls.meets || []) {
        if (meet.weekdays && !meet.weekdays.includes(parts.weekday)) continue;
        if (meet.variants && !meet.variants.includes(day.variantId)) continue;
        let start;
        let end;
        let blockName = meet.label || "";
        let blockId = meet.block || "";
        if (meet.block) {
          const block = periodBlock(day.variant, schedule, meet.block);
          if (!block) continue;
          start = block.start;
          end = block.end;
          blockName = block.name;
          blockId = block.id;
        } else if (meet.start && meet.end) {
          if (day.variantId === "half-day" && !meet.halfDay) continue;
          start = meet.start;
          end = meet.end;
        } else {
          continue;
        }
        if (retimes[cls.id]) {
          start = retimes[cls.id].start || start;
          end = retimes[cls.id].end || end;
        }
        pushMeeting(meetings, {
          kind: "class",
          classId: cls.id,
          title: cls.title,
          level: cls.level,
          subject: meet.subject || cls.subject || "",
          grade: cls.grade || "",
          teacher: cls.teacher || "",
          room: cls.room || "",
          tables: cls.tables || 0,
          blockId,
          blockName,
          start,
          end,
          needsConfirmation: Boolean(meet.needsConfirmation),
          note: meet.note || "",
        });
      }
    }

    const bells = resolvedBells(day.variant, schedule);
    const extras = [];
    for (const block of bells.earlyLunch || []) {
      if (block.kind === "chapel") extras.push(block);
    }
    for (const block of day.variant.extraBlocks || []) extras.push(block);
    const seen = new Set();
    for (const block of extras) {
      if (block.kind !== "chapel") continue;
      if (seen.has(block.id)) continue;
      if (block.weekdays && !block.weekdays.includes(parts.weekday)) continue;
      seen.add(block.id);
      pushMeeting(meetings, {
        kind: "chapel",
        classId: block.id,
        title: block.name,
        level: block.audience || "school",
        subject: "Chapel",
        grade: "",
        teacher: "",
        room: "",
        tables: 0,
        blockId: block.id,
        blockName: block.name,
        start: block.start,
        end: block.end,
        needsConfirmation: false,
        note: block.note || "",
      });
    }
  }

  meetings.sort((a, b) => a.startSec - b.startSec || (a.kind === "class" ? -1 : 1));
  return { day, meetings };
}

export function occurrenceKey(ymd, meeting) {
  return `${ymd}|${meeting.classId}|${meeting.startSec}`;
}

/**
 * The all-day screen, from the clock alone.
 * `startedKey` is set only after Class Started for this exact occurrence.
 * It is not stored anywhere, so a reload comes back as "waiting" and the
 * lesson is planned again from the time left until the bell.
 */
export function screenFor(parts, air, startedKey) {
  if (air.phase === "class" && air.live) {
    const key = occurrenceKey(parts.ymd, air.live);
    return {
      mode: startedKey === key ? "running" : "waiting",
      key,
      meeting: air.live,
      endsIn: air.live.endSec - parts.daySeconds,
      nextClass: air.nextClass || null,
      chapel: null,
      startsIn: null,
    };
  }
  const nextClass = air.nextClass || null;
  return {
    mode: "idle",
    key: null,
    meeting: null,
    endsIn: null,
    nextClass,
    chapel: air.phase === "chapel" ? air.live : null,
    startsIn: nextClass ? nextClass.startSec - parts.daySeconds : null,
  };
}

export function pickOnAir(daySeconds, meetings) {
  const classes = meetings.filter((meeting) => meeting.kind === "class");
  const liveClass = classes.find((meeting) => daySeconds >= meeting.startSec && daySeconds < meeting.endSec) || null;
  const liveChapel = meetings.find((meeting) => (
    meeting.kind === "chapel" && daySeconds >= meeting.startSec && daySeconds < meeting.endSec
  )) || null;
  const live = liveClass || liveChapel;
  const upcoming = meetings
    .filter((meeting) => meeting.startSec > daySeconds)
    .sort((a, b) => a.startSec - b.startSec)[0] || null;
  const nextClass = classes
    .filter((meeting) => meeting.startSec > daySeconds)
    .sort((a, b) => a.startSec - b.startSec)[0] || null;
  let phase = "after";
  if (liveClass) phase = "class";
  else if (liveChapel) phase = "chapel";
  else if (upcoming) phase = classes.some((meeting) => meeting.endSec <= daySeconds) ? "between" : "before";
  return {
    phase,
    live,
    upcoming,
    nextClass,
    endsIn: live ? live.endSec - daySeconds : null,
    startsIn: !live && upcoming ? upcoming.startSec - daySeconds : null,
  };
}

export function playlistFor(classId, level, dateContent, defaults) {
  const dated = dateContent?.classes?.[classId];
  if (dated?.segments?.length) return dated;
  const own = defaults?.classes?.[classId];
  if (own?.segments?.length) return own;
  const key = level === "elementary" ? "elementary" : level === "ms" ? "ms-stem" : "hs-stem";
  return defaults?.classes?.[key] || { title: "", standby: "", segments: [] };
}

function apportion(weights, total) {
  const count = weights.length;
  if (!count) return [];
  if (total <= 0) return weights.map(() => 0);
  const sum = weights.reduce((totalWeight, weight) => totalWeight + weight, 0);
  if (sum <= 0) {
    const base = Math.floor(total / count);
    const out = weights.map(() => base);
    let left = total - base * count;
    for (let index = 0; left > 0; index += 1, left -= 1) out[index % count] += 1;
    return out;
  }
  const raw = weights.map((weight) => (total * weight) / sum);
  const out = raw.map((value) => Math.floor(value));
  let left = total - out.reduce((totalSeconds, value) => totalSeconds + value, 0);
  const order = raw
    .map((value, index) => [value - out[index], index])
    .sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  for (let index = 0; index < left; index += 1) out[order[index][1]] += 1;
  return out;
}

function cutBy(seconds, deficit, roomAt) {
  if (deficit <= 0) return 0;
  const room = seconds.map((value, index) => Math.max(0, roomAt(index, value)));
  const roomSum = room.reduce((total, value) => total + value, 0);
  if (roomSum <= 0) return deficit;
  const cut = Math.min(deficit, roomSum);
  const parts = apportion(room, cut);
  for (let index = 0; index < seconds.length; index += 1) seconds[index] -= parts[index];
  return deficit - cut;
}

/**
 * Fit a playlist into the seconds left before the bell.
 * A late start comes out of flex segments first, down to each segment's
 * minMinutes, then out of everyone else's slack, then by squeezing so the
 * sum still lands on the bell. Extra time (an early Start) goes to flex.
 */
export function paceSegments(segments, availableSec, fullSec) {
  const meta = segments.map((segment) => ({
    minutes: Math.max(0, Number(segment.minutes) || 0),
    floor: Math.max(0, Math.round((Number(segment.minMinutes) || 0) * 60)),
    flex: Boolean(segment.flex),
  }));
  const count = meta.length;
  if (!count) return [];
  if (!meta.some((segment) => segment.flex)) {
    let biggest = 0;
    meta.forEach((segment, index) => {
      if (segment.minutes > meta[biggest].minutes) biggest = index;
    });
    meta[biggest].flex = true;
  }

  const full = Math.max(0, Math.round(fullSec));
  const available = Math.max(0, Math.round(availableSec));
  let seconds = apportion(meta.map((segment) => segment.minutes), full);

  const needAt = () => seconds.map((value, index) => Math.max(0, meta[index].floor - value));
  const short = needAt().reduce((total, value) => total + value, 0);
  if (short > 0) {
    const surplus = seconds.map((value, index) => (
      meta[index].flex ? Math.max(0, value - meta[index].floor) : 0
    ));
    const give = Math.min(short, surplus.reduce((total, value) => total + value, 0));
    if (give > 0) {
      const cuts = apportion(surplus, give);
      const adds = apportion(needAt(), give);
      seconds = seconds.map((value, index) => value - cuts[index] + adds[index]);
    }
  }

  if (available > full) {
    const weights = seconds.map((value, index) => (meta[index].flex ? Math.max(value, 1) : 0));
    const adds = apportion(weights, available - full);
    seconds = seconds.map((value, index) => value + adds[index]);
  } else if (available < full) {
    let deficit = full - available;
    deficit = cutBy(seconds, deficit, (index, value) => (
      meta[index].flex ? value - meta[index].floor : 0
    ));
    deficit = cutBy(seconds, deficit, (index, value) => (
      meta[index].flex ? 0 : value - meta[index].floor
    ));
    if (deficit > 0) seconds = apportion(seconds.map((value) => Math.max(value, 0.001)), available);
  }

  const drift = available - seconds.reduce((total, value) => total + value, 0);
  if (drift !== 0) {
    const flexIndex = Math.max(0, meta.findIndex((segment) => segment.flex));
    seconds[flexIndex] += drift;
  }
  if (seconds.some((value) => value < 0)) {
    seconds = apportion(meta.map((segment) => Math.max(segment.minutes, 0.001)), available);
  }
  return segments.map((segment, index) => ({ ...segment, seconds: seconds[index] }));
}
