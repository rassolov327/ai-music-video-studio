# /TV — retro tech news show (context for Claude Code)

This repo is **TAKE:ONE LAB** (AI Music Video Studio) — an existing, working, production app.
A NEW feature, `/TV`, is being built inside the same repo on the `dev` branch. Read this
file before starting any work on `/TV`. Replace this file (don't just append) whenever the
user gives you a newer version — it supersedes older copies.

## Hard rule: never touch production

- Production (`main` branch) must keep working exactly as it does today, untouched.
- All `/TV` work happens on `dev`. Never merge to `main` unless the user explicitly asks.
- `dev` has its own Railway environment with its own Postgres instance (fully separate from
  production's database) — confirmed by the user, so DB schema changes here are safe.
- Костян (the user) may step away from this project for extended periods (e.g. travel) —
  nothing about `/TV` should require ongoing maintenance to avoid breaking anything. Any
  scheduler/cron job must default to OFF/inert until explicitly enabled, so an idle `dev`
  environment doesn't do anything unexpected while unattended.

## Who the user is

Костян works professionally in television and film production (younger than the people who
made the reference show, but knows the craft from the inside) — he's a reliable judge of
whether generated output "feels real," so his review notes on tone/pacing/craft carry real
weight, not just taste.

## What /TV is

A parallel-timeline retro tech news show: each week's episode covers REAL news (IT, games,
software, internet) from the *same calendar week, but 25 years ago* — not a modern show
with a nostalgic vibe. Styled as an early-2000s TV broadcast, explicitly modeled on
**"Мир компьютера"** (later renamed "PROкомпьютер"), which aired 1997–2005 on 11 канал /
6 канал / СТС-Петербург. Weekly output, currently downloaded and uploaded to YouTube by
hand (no auto-upload yet).

### Reference material for the format

- YouTube playlist: **"Мир Компьютера (11 канал, 6 канал, СТС, 1997-2003 год)"**
  (uploads by Pavel Tsirulnikov / InquisitorAlex) — real full episodes.
- Archive: **staroetv.su** — 356 catalogued episodes with descriptions.
- Real show staff/rubric structure (from episode credits, confirmed via research — this is
  the model for how `/TV`'s own anchors should map to rubrics, see below):
  - Владимир Богданов — host of the whole program
  - Татьяна Осекина — "Новости" rubric
  - Дмитрий Довженко — "Интернет" rubric
  - Александр Строев / Станислав Концевич — "Игры" rubric
  - Андрей Соловьёв — "Мобильный мир" (gadgets) rubric
  - Sample 1998 episode opens with a rapid-fire "Новости [Hot line]" segment (several short
    news items back to back), then moves into a deeper single-topic rubric segment.

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
  TASKS queue (`tasks.js`), Archive (`archive.js`), ffmpeg.wasm render pipeline (`render.js`),
  and the Gemini quick-assistant chat pattern (`gemini-chat.js`) — extended for /TV, see
  "Staff chat" below.

## Tab structure (final, in this order)

1. **Work** — create anchors (Character Card pattern) and virtual studio backdrops/camera
   angles (Object Card + angle-shots pattern from `locations.js`). **Every anchor is tied to
   one rubric** at creation time (Новости / Игры / Софт / Интернет) — mirrors the real
   show's structure of one dedicated host per rubric, not one anchor reading everything.
2. **Новости** — real-news aggregator for the matching week 25 years ago. UI: two-pane
   Total-Commander-style picker — left pane = system-proposed news items, right pane = items
   dragged in to include in the episode. Items are rubric-tagged. A calendar of known "big
   anniversary" events (e.g. PS2 launch) flags especially notable stories automatically. If
   real material (photo/video) is scarce for an item, flag it "мало материала" and WAIT —
   never auto-generate or silently drop it; the user either uploads their own material or
   explicitly requests AI generation for that item.
3. **Студия** — assign each chosen news item to a specific anchor (defaults to that item's
   rubric's anchor); sends it off for voice (TTS) generation.
4. **Сетка** — the real editing timeline (NLE-style), auto-populated per the show's
   broadcast algorithm (a fixed template extracted from the reference show — see "Show
   format analysis" below, not re-derived by AI each week). Holds the VO track (from
   Студия), music, and color-coded blocks per rubric. **Rubrics air as grouped blocks** (all
   "Игры" together, then all "Софт", etc.) — reordering within the right-pane picker only
   reorders within a rubric's own block, never across rubrics. Blocks arrive ALREADY
   pre-filled with concrete found/generated material (not abstract placeholder slots) — the
   user just previews and approves or swaps it. Real broadcast "package" editing style:
   anchor is lipsync-animated only for on-camera open/close of a story; the middle is
   full-screen cutaway stills/clips (5-15 sec each, VO continues underneath) — NOT the
   anchor animated for the whole segment. Fixed jingles/station stings (a FIXED set reused
   every week, like a real recurring show — not regenerated per episode). Future additions
   planned: volume mixers, possibly ad blocks.
5. **TASKS** — generation queue with model selection, direct analog of TAKE:ONE's TASKS.
6. **Архив** — direct analog of TAKE:ONE's Archive.
7. **Эфир** — final render/output of the finished episode.

## Approval mechanic

Every tab has ONE big "утверждено / в выпуск" button — multi-stage approval (one gate per
tab), not per-item checkboxes scattered everywhere.

## News sourcing — FREE ONLY, no paid search

The user wants this to cost nothing beyond what's already paid for (KIE, and Gemini stays
on its free tier). Do NOT use Gemini's paid Grounding-with-Google-Search tool. Instead:

1. **Raw facts** come from free, keyless public APIs, scoped to the target week (current
   week's dates, year = currentYear − 25):
   - Wikipedia API (category pages like "Category:2001 in video gaming", "on this day"
     endpoints)
   - Wayback Machine / archive.org CDX API (e.g.
     `web.archive.org/cdx/search/cdx?url=cnet.com&from=20010810&to=20010816`) to find real
     archived snapshots of period tech-news sites for that exact week
   - Wikinews archive by date
2. **Structuring** — feed the raw retrieved text into a normal (free) Gemini text call,
   same JSON-schema-response pattern already used in `script-tab.js`'s
   `/api/assist/analyze-script` (`responseMimeType: application/json` + `responseSchema`),
   to get structured `{headline, summary, rubric, sourceUrl, sourceDate}` candidates.
   Gemini here is NOT searching or recalling from its own training data — it's only
   organizing text that was actually retrieved, so it can't invent a fact or a date.
3. **Images/photos for cutaways** — separate from the above, via direct free APIs:
   Wikimedia Commons API, archive.org magazine scans, and optionally YouTube Data API for
   video references. These photos are fine to source and use directly.

## Journalist — voiceover text only, must read as human-written

Only ONE text output is needed per news item: what the anchor reads aloud. No separate
print-article version.

The generation must be indistinguishable from a real human writer of that era. This is a
prompting/context problem, not a model-choice problem:

- **Few-shot with real period text.** Pull 3-5 real excerpts from period Russian tech press
  (Компьютерра, Мир ПК, Игромания, Хакер, Compulenta, iXBT — reachable via the Wayback
  Machine) and include them directly in the prompt as style examples. A generic "write like
  it's 2001" instruction produces generic retro-flavored text; showing the model real period
  sentences produces text that actually mimics real phrasing, sentence length, and clichés
  of the era.
- **Explicit anachronism blocklist** in the prompt — call out specific words/concepts that
  didn't exist yet in the target year (period-appropriate list needs to shift with the
  rolling year offset) and instruct the model to avoid them.
- **Explicit AI-tell blocklist** in the prompt — no bullet lists, no subheadings, no stock
  "Подводя итог..." closers, no artificially "balanced" both-sides hedging. Explicitly allow
  and encourage: continuous running prose, a real subjective opinion, varied sentence
  rhythm, the kind of clichés real 2000s TV journalism actually used.

## Editing / Сетка — fully automated

The user does not want to manually edit, insert photos/materials, place jingles, or place
rubric transitions by hand. He wants to only lightly review/adjust. Concretely:

- **Сетка auto-populates from a fixed algorithm/template**, not from an AI "deciding" pacing
  fresh each week. That template comes from analyzing the real reference show once (see
  "Show format analysis" below) and is then applied mechanically every week — segment order,
  typical block durations, transition style are baked in as rules, not re-improvised.
- **Staff chat** — instead of (or alongside) dragging blocks by hand, the user should be
  able to type natural-language notes like "вырежи второй план у новости про PS2" or
  "удлини кадр с ведущим" into a chat, and have it actually apply the edit. Build this by
  extending the existing Gemini chat pattern (`gemini-chat.js`) with **function
  calling/tool use**: the model's reply includes a structured action (e.g.
  `{action: "trim_block", blockId, newDurationSec}`), the server applies it to the grid
  data, and the UI re-renders. This is meant to feel like directing a real editor by note,
  not like operating a timeline UI.
  - Longer-term idea, not required for v1: since the pipeline is framed as a virtual
    "редакция" (editorial staff — journalist, editor, director, anchor), consider giving
    each virtual role its own addressable chat (not one generic assistant) — e.g. a
    "chat with the editor" for content notes vs. a "chat with the monter/editor" for
    cut/timing notes — so directing the show feels like managing a real small newsroom, not
    talking to one undifferentiated bot. Revisit once the single staff-chat (montage notes)
    is working end to end.

## Show format analysis (next concrete task)

Goal: produce a written "формат" document — the fixed template Сетка's auto-assembly will
follow every week (segment order, typical durations, transition style, anchor-to-rubric
pacing) — based on the REAL reference show, not invented.

Two parallel passes, then reconcile:
1. **Костян watches 2-3 real episodes himself** (from the YouTube playlist / staroetv.su
   above) and notes: exact length of each segment type, how transitions between rubrics
   look/feel, overall episode runtime, and craft details that don't show up in a transcript
   (pacing of speech, camera framing choices, edit rhythm).
2. **A parallel AI draft, done via Gemini's video understanding** (same `GEMINI_API_KEY`
   already in use — this is free-tier eligible, no extra cost):
   - Gemini can analyze a video directly by public YouTube URL — no download/upload needed.
   - Free tier: up to 8 hours of YouTube video per day; only public (not unlisted/private)
     videos; Gemini 2.5+ can take up to 10 videos in a single request, prior models only 1.
   - Suggested one-off script (NOT part of the weekly pipeline — run manually once, or
     re-run only if the reference set changes), e.g. `scripts/analyze-show-format.js`:
     ```js
     // one-off, manual run — analyzes the real reference show to draft a format template.
     // Uses the SAME GEMINI_API_KEY already configured; free-tier eligible.
     const EPISODE_URLS = [
       'https://www.youtube.com/watch?v=REPLACE_WITH_REAL_EPISODE_URL_1',
       'https://www.youtube.com/watch?v=REPLACE_WITH_REAL_EPISODE_URL_2',
     ];
     const PROMPT = `
     You are analyzing archival footage of a Russian TV show ("Мир компьютера" /
     "PROкомпьютер") to extract its structural format, for use as a template.
     For each video, produce a timestamped breakdown:
     - Every segment boundary (MM:SS) and what kind of segment it is (intro/jingle,
       rapid-fire news roundup, single-topic deep-dive rubric, transition, outro).
     - The approximate duration of each segment.
     - How the transition INTO and OUT OF each segment looks/sounds (jingle only? host
       speaks to camera first? cut style?).
     - Total episode runtime.
     Be precise about timestamps — use the video's actual timeline, don't estimate blindly.
     Reply as structured JSON: an array of episodes, each with a `segments` array.
     `;
     // POST to https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent
     // input: [{type:'text', text: PROMPT}, ...EPISODE_URLS.map(uri => ({type:'video', uri}))]
     // (adjust to whichever Gemini SDK/endpoint shape the rest of server.js already uses)
     ```
   - Output is a DRAFT — Костян's own viewing notes are the source of truth where they
     disagree with the model's read, especially anything about craft/feel that a transcript
     can't capture.
3. Once reconciled, write the final format template as a plain structured doc (JSON or
   markdown table: segment type → typical duration → transition style) and wire it into
   Сетка's auto-population logic as the literal algorithm it follows.

## Automation

- The episode assembly runs automatically every Monday, on a schedule — no manual trigger
  needed in normal operation. Scheduler must default OFF until explicitly enabled (see
  "Hard rule" above — protects an unattended `dev` environment from doing anything while
  the user is away).
- Real YouTube video footage is explicitly OK to clip and use, not just reference images —
  the user has accepted the copyright/Content-ID risk personally, after being warned once.
  Don't add extra copyright-safety gating beyond the "утверждено в выпуск" approval flag —
  this was a deliberate, already-litigated decision.
- YouTube upload stays manual for now — download the finished render, no auto-upload yet.
- Everything (reference search, episode assembly, animation) should run automatically with
  minimal manual involvement — the user's role is limited to approvals/light chat-based
  notes, not doing steps by hand.

## Already scaffolded (as of this file's writing — verify current state, may be stale)

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
POST     /api/tv/episode/generate  — kick off automated episode assembly (cron target,
                                      default OFF)
GET      /api/tv/anniversary       — anniversary-event calendar
POST     /api/tv/staff-chat        — natural-language edit commands for Сетка (function
                                      calling → grid mutation)
```

## Next planned step

1. Run the show-format analysis (parallel: user's own viewing notes + the Gemini video
   script above), reconcile into a format template.
2. Build out the anchor Character Card flow in **Work**, reusing `characters.js` +
   `object-card.js` as the direct template, with the rubric field added.
