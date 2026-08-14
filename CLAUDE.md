# /TV — retro tech news show (context for Claude Code)

This repo is **TAKE:ONE LAB** (AI Music Video Studio) — an existing, working, production app.
A NEW feature, `/TV`, is being built inside the same repo on the `dev` branch. Read this
file before starting any work on `/TV`.

## Hard rule: never touch production

- Production (`main` branch) must keep working exactly as it does today, untouched.
- All `/TV` work happens on `dev`. Never merge to `main` unless the user explicitly asks.
- `dev` has its own Railway environment with its own Postgres instance (fully separate from
  production's database) — confirmed by the user, so DB schema changes here are safe.
- Костян (the user) may step away from this project for extended periods (e.g. travel) —
  nothing about `/TV` should require ongoing maintenance to avoid breaking anything. If you
  build a scheduler/cron job later, default it to OFF/inert until explicitly enabled, so an
  idle `dev` environment doesn't do anything unexpected while unattended.

## What /TV is

A parallel-timeline retro tech news show: each week's episode covers REAL news (IT, games,
software, internet) from the *same calendar week, but 25 years ago* — not a modern show
with a nostalgic vibe. Styled as an early-2000s TV broadcast (reference: "Мир компьютера" /
"PRO-Компьютер" on СТС/Шестой канал). Weekly output, currently downloaded and uploaded to
YouTube by hand (no auto-upload yet).

Virtual "staff": journalist (drafts from real sourced facts), editor (reviews/scores),
director (turns approved material into a shot list), anchor (reads the news, animated).
The user's own role is producer/editor-in-chief only — approve, adjust, never do the
manual generation work.

## Architecture

- Lives at `/TV` route in the SAME app as TAKE:ONE (same GitHub repo, same Railway project,
  same KIE account/key) — branch isolation (`dev`) is the safety mechanism, not a separate
  repo/service.
- Unlike TAKE:ONE (which stores all project data client-side, IndexedDB/disk — a human
  drives every generation manually), `/TV` needs SERVER-SIDE persistence (Postgres) because
  the pipeline must run on a schedule with no browser open.
- Reuses TAKE:ONE's proven engine pieces directly: KIE.ai generation wrappers in `server.js`
  (model catalogs, field-name quirks per model — see comments in `server.js`, hard-won via
  real trial and error, do not re-derive from scratch), Character Card / Object Card builder
  pattern (`characters.js`, `object-card.js`, `locations.js`) for anchors and backdrops,
  multi-track voice/magnet timeline (`audio-track.js`) for the VO-under-cutaways pattern,
  TASKS queue (`tasks.js`), Archive (`archive.js`), ffmpeg.wasm render pipeline (`render.js`).

## Tab structure (final, in this order)

1. **Work** — create anchors (Character Card pattern) and virtual studio backdrops/camera
   angles (Object Card + angle-shots pattern from `locations.js`).
2. **Новости** — real-news aggregator for the matching week 25 years ago. UI: two-pane
   Total-Commander-style picker — left pane = system-proposed news items, right pane = items
   dragged in to include in the episode. Items are rubric-tagged: Новости / Игры / Софт /
   Интернет. A calendar of known "big anniversary" events (e.g. PS2 launch) flags especially
   notable stories automatically. If real material (photo/video) is scarce for an item, flag
   it "мало материала" and WAIT — never auto-generate or silently drop it; the user either
   uploads their own material or explicitly requests AI generation for that item.
3. **Студия** — assign each chosen news item to a specific anchor; sends it off for voice
   (TTS) generation.
4. **Сетка** — the real editing timeline (NLE-style), auto-populated per the show's
   broadcast algorithm. Holds the VO track (from Студия), music, and color-coded blocks per
   rubric. **Rubrics air as grouped blocks** (all "Игры" together, then all "Софт", etc.) —
   reordering within the right-pane picker only reorders within a rubric's own block, never
   across rubrics. Blocks arrive ALREADY pre-filled with concrete found/generated material
   (not abstract placeholder slots) — the user just previews and approves or swaps it. Real
   broadcast "package" editing style: anchor is lipsync-animated only for on-camera
   open/close of a story; the middle is full-screen cutaway stills/clips (5-15 sec each,
   VO continues underneath) — NOT the anchor animated for the whole segment. Future
   additions planned: volume mixers, jingles/station stings (a FIXED set reused every week,
   like a real recurring show — not regenerated per episode), possibly ad blocks.
5. **TASKS** — generation queue with model selection, direct analog of TAKE:ONE's TASKS.
6. **Архив** — direct analog of TAKE:ONE's Archive.
7. **Эфир** — final render/output of the finished episode.

## Approval mechanic

Every tab has ONE big "утверждено / в выпуск" button — multi-stage approval (one gate per
tab), not per-item checkboxes scattered everywhere.

## Automation

- The episode assembly runs automatically every Monday, on a schedule — no manual trigger
  needed in normal operation.
- Real archival photos/screenshots (Wikimedia Commons, official press kits, archive.org
  magazine scans) are fine to source directly and use freely.
- Real YouTube video footage is explicitly OK to clip and use too — the user has accepted
  the copyright/Content-ID risk personally. The system should let the user mark material
  "утверждено в выпуск" (approved for release) so it's clear what's cleared to use, but
  do not add extra copyright-safety gating beyond that approval flag; this was a deliberate
  user decision after being warned of the risk once, not something to relitigate.
- YouTube upload stays manual for now — download the finished render, no auto-upload yet.
- Everything (reference search, episode assembly, animation) should run automatically with
  minimal manual involvement — the user's role is limited to approvals, not doing steps
  by hand.

## Already scaffolded (as of this file's writing)

- `tv.html` — entry page, 7-tab structure (placeholders for most tabs so far)
- `js/tv-state.js` — client state shape: `tvAnchors`, `tvNewsItems`, `tvGridBlocks`, etc.
- `js/tv-app.js` — tab-switching logic
- `db.js` — draft Postgres schema added (or pending — check the file): `tv_anchors`,
  `tv_episodes`, `tv_news_items`, `tv_grid_blocks`, `tv_anniversary_events`

## New routes to build (none exist yet — check before assuming duplicates)

```
GET/POST /api/tv/news              — aggregation + two-pane picker data
POST     /api/tv/news/:id/assign   — assign a news item to an anchor
GET/POST /api/tv/grid              — read/build the episode's Сетка timeline
POST     /api/tv/episode/generate  — kick off automated episode assembly (cron target)
GET      /api/tv/anniversary       — anniversary-event calendar
```

## Next planned step

Build out the anchor Character Card flow in **Work**, reusing `characters.js` +
`object-card.js` as the direct template.
