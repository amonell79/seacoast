# Seacoast Class TV

Classroom screen for Tony Monell's K–12 STEM and STEAM classes at Seacoast Christian Academy. The TV reads the bell schedule, finds the class that is on, and counts down to the **end** of that period. Classes start late. They still end on the bell.

Open `/` (or `/display/`) on the classroom TV. Open `/teacher/` on your laptop. Nothing here needs a build.

```bash
python3 -m http.server 8765
```

Then open `http://localhost:8765/` and `http://localhost:8765/teacher/`. `npm test` runs the schedule and sync checks.

The TV stays up all day by itself. Space or Enter on the TV starts the class. The teacher page can start it, move between parts, and extend the current part.

Preview any moment without changing the computer clock:

- `?now=2026-11-05T09:00` — Thursday chapel
- `?now=2026-11-03T08:00` — Tuesday, waiting for HS STEM
- `?now=2026-11-03T08:00&started=1` — that class already started
- `?examples=1` — turn on the sample overrides in `data/schedule.json`

## Two screens

`/` is the student display: the lesson, a small class name, and the countdown to the bell. Waiting looks like “Class starting soon.” There are no buttons on the TV.

`/teacher/` is the console on the laptop: Class Started, today’s list, the segment list (prev, next, skip, extend), notes the TV does not show, and a preview.

On the teacher page, **Open TV display** opens the student screen in a new window. Drag that window onto the 75" TV and press F11. The laptop and the TV are the same computer over HDMI, so they stay in step through the browser. BroadcastChannel carries the commands, and localStorage covers a browser that does not have it. No server is required. A later cross-device transport can be added in `js/cloud.js`. The TV still runs all day if the teacher page is closed.

The countdown is the school clock in `America/New_York`.

## Edit the schedule

`data/schedule.json` holds the bells. `data/classes.json` holds who is in the room.

MS/HS STEM points at a bell block (`"block": "1"` or `"2"`). Change Period 1 in the variant and HS STEM follows. Elementary rows keep their own `start` and `end`, because those times are not the MS/HS bells.

Weekday defaults:

| Day | Variant |
| --- | --- |
| Mon, Tue, Fri | `regular` |
| Wednesday | `wednesday` (regular MS/HS bells, elementary chapel 8:15–8:55) |
| Thursday | `thursday-chapel` |
| Sat, Sun | `none` |

Special days are rows in `overrides`. Delete `"example": true` to make a row live, or copy one.

- Several dates, one variant: Spiritual Emphasis Week uses `daily-chapel` (Thursday's MS/HS bells, every day).
- `"variant": "half-day"` keeps the morning. Elementary classes meet on a half day only when their row says `"halfDay": true`.
- `"variant": "none"` clears the day.
- `"cancelClasses": ["e-5a-rogers"]` drops a class (field trip) and leaves the rest.
- `"retimes": {"hs-stem": {"start": "08:00", "end": "08:30"}}` moves one class.

Friday elementary STEAM, confirmed: 5-A Rogers 10:35–11:15, then 6-B King 11:30–12:05.

Open the TV once in the morning. It stays up all day and follows the clock: a gap or chapel shows who is next, the start of a period shows **Waiting for class** (the bell countdown stays up), and **Class Started** (or Space or Enter) builds that period's lesson to fit the time left. After the bell it moves on by itself. A reload does not remember that the class had started. It comes back to Waiting and plans again from the clock.

## Add a day's lesson

Copy `data/content/_template.json` to `data/content/YYYY-MM-DD.json`. Put a playlist under each class id that meets that day. A class you leave out uses `data/content/default.json`.

Segment types: `slide`, `youtube` (`videoId`), `edpuzzle` (`url`), `run-video` (work time, with Step back), `quiz` or `game`, and `procedure` (`ref` from `data/procedures.json`). `minutes` is the share of a full period. `minMinutes` is the floor. Mark the block that should shrink when class starts late with `"flex": true`.

Procedures and the settle music live in `media/audio/`. Names are not in the repo. On the TV, Attendance → load a CSV shaped like `media/roster.example.csv` (`class,table,name,track`). That list stays in the browser tab until it closes.

## Archived sites

`sites/stem/`, `sites/music/`, and `sites/pd/` are the original hand-built pages, imported unchanged. Music is not redesigned here. The office PDFs and text extracts are in `schedule/`.

Keys on the TV: Space pause, arrows move, A attendance, R refit the remaining parts to the bell, F full screen, Esc back to the day board, S start.
