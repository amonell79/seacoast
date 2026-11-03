# Seacoast Class TV

Classroom screen for Tony Monell's K–12 STEM and STEAM classes at Seacoast Christian Academy. The TV reads the bell schedule, finds the class that is on, and counts down to the **end** of that period. Classes start late. They still end on the bell.

Open the site root on the classroom TV. Nothing here needs a build.

```bash
python3 -m http.server 8765
```

Then open `http://localhost:8765/`. `npm test` runs the schedule checks.

Preview any moment without changing the computer clock:

- `?now=2026-11-05T09:00` — Thursday chapel
- `?now=2026-11-03T08:20` — Tuesday HS STEM, started late
- `?autostart=0` — stay on the day board
- `?part=3` — open that segment
- `?examples=1` — turn on the sample overrides in `data/schedule.json`

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

Friday 6-B King and 5-A Rogers are flagged `needsConfirmation`. The printed grid and the swap Tony described do not match yet. Clear the flag when the office confirms the times.

## Add a day's lesson

Copy `data/content/_template.json` to `data/content/YYYY-MM-DD.json`. Put a playlist under each class id that meets that day. A class you leave out uses `data/content/default.json`.

Segment types: `slide`, `youtube` (`videoId`), `edpuzzle` (`url`), `run-video` (work time, with Step back), `quiz` or `game`, and `procedure` (`ref` from `data/procedures.json`). `minutes` is the share of a full period. `minMinutes` is the floor. Mark the block that should shrink when class starts late with `"flex": true`.

Procedures and the settle music live in `media/audio/`. Names are not in the repo. On the TV, Attendance → load a CSV shaped like `media/roster.example.csv` (`class,table,name,track`). That list stays in the browser tab until it closes.

## Archived sites

`sites/stem/`, `sites/music/`, and `sites/pd/` are the original hand-built pages, imported unchanged. Music is not redesigned here. The office PDFs and text extracts are in `schedule/`.

Keys on the TV: Space pause, arrows move, A attendance, R refit the remaining parts to the bell, F full screen, Esc back to the day board, S start.
