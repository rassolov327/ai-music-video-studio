# /TV — retro tech news show (context for Claude Code)

This repo is **TAKE:ONE LAB** (AI Music Video Studio) — an existing, working, production app.
A NEW feature, `/TV`, is being built inside the same repo on the `dev` branch. Read this
file before starting any work on `/TV`. Replace this file (don't just append) whenever the
user gives you a newer version — it supersedes older copies.

## Hard rule: never touch production

- Production (`main` branch) must keep working exactly as it does today, untouched.
- All `/TV` work happens on `dev`. Never merge to `main` unless the user explicitly asks.
- `dev` has its own Railway environment with its own Postgres instance (fully separate from
  production's database) — confirmed by the user. That Postgres instance is used ONLY for
  the shared users/login/token system TAKE:ONE already had (`db.js`) — `/TV` itself does
  NOT use Postgres, see "Architecture" below.
- Костян (the user) may step away from this project for extended periods (e.g. travel) —
  nothing about `/TV` should require ongoing maintenance to avoid breaking anything.

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
  (uploads by Pavel Tsirulnikov / InquisitorAlex) — real full episodes:
  https://www.youtube.com/playlist?list=PLAWq99KZfygXMCI6oUHKF832ZDMeB7Njt
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
- `/TV` is **browser-driven, exactly like TAKE:ONE** — no scheduler, no unattended runs.
  The user logs in, presses a button (e.g. "Собрать новости" on Новости), and it runs while
  the browser is open. This was a deliberate reversal of an earlier server-side-Postgres/
  cron plan (see git history if the reasoning is ever needed again) — do not reintroduce a
  scheduler or move `/TV`'s own data to Postgres without the user explicitly asking again.
  Storage is local disk/IndexedDB, via `js/tv-persistence.js` — a single-workspace
  adaptation of TAKE:ONE's own `js/persistence.js` pattern (folder picker, "Saved" status
  pill, diff-based autosave, blob assets on disk with an IndexedDB fallback; `tv-project.json`
  + an `assets/` folder when a disk folder is connected). Postgres (`db.js`) is only used
  for the shared login/token/credits system, not for `/TV`'s own content data.
- Reuses TAKE:ONE's proven engine pieces directly: KIE.ai generation wrappers in `server.js`
  (model catalogs, field-name quirks per model — see comments in `server.js`, hard-won via
  real trial and error, do not re-derive from scratch), Character Card / Object Card builder
  pattern (`characters.js`, `object-card.js`, `locations.js`) for anchors and backdrops,
  multi-track voice/magnet timeline (`audio-track.js`) for the VO-under-cutaways pattern,
  TASKS queue (`tasks.js`), Archive (`archive.js`), ffmpeg.wasm render pipeline (`render.js`),
  and the Gemini quick-assistant chat pattern (`gemini-chat.js`) — extended for /TV, see
  "Staff chat" below.

## Tab structure (final, in this order)

1. **Work** — create anchors (Character Card pattern, built) and virtual studio backdrops/
   camera angles (Object Card + angle-shots pattern from `locations.js`, built). **Every
   anchor is tied to one rubric** at creation time (`anchor.rubric`, a required `<select>`
   over `TV_RUBRICS` in the anchor form) — mirrors the real show's structure of one
   dedicated host per rubric, not one anchor reading everything.
2. **Новости** — real-news aggregator for the matching week 25 years ago. UI: two-pane
   Total-Commander-style picker — left pane = system-proposed news items, right pane = items
   dragged in to include in the episode. Items are rubric-tagged. A calendar of known "big
   anniversary" events (e.g. PS2 launch) flags especially notable stories automatically. If
   real material (photo/video) is scarce for an item, flag it "мало материала" and WAIT —
   never auto-generate or silently drop it; the user either uploads their own material or
   explicitly requests AI generation for that item. "Собрать новости" button exists and
   calls Gemini for a draft candidate list (`POST /api/tv/gather-news`) — see "News
   sourcing" below for the fuller, not-yet-built free-API pipeline this should grow into.
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

## News sourcing — FREE ONLY, no paid search — BUILT

The user wants this to cost nothing beyond what's already paid for (KIE, and Gemini stays
on its free tier). Do NOT use Gemini's paid Grounding-with-Google-Search tool. Костян's hard
requirement: **only real, sourced topics — no inventing** — and **strict week-level
accuracy**, not just "some year." `POST /api/tv/gather-news` (`server.js`) now runs two
real sources in parallel, merged, with no recall/invention fallback at all (if both come
back empty for a week, the response is an empty list):

1. **Wayback Machine (week-precise, primary)** — `tvGatherWaybackNews()`: for a curated
   list of real period tech sites (`TV_WAYBACK_SITES` — cnet.com, zdnet.com, wired.com,
   gamespot.com, ign.com, compulenta.ru, ixbt.com), queries the CDX API
   (`web.archive.org/cdx/search/cdx?url=...&from=...&to=...`) for real snapshots within the
   *exact* target week, fetches each snapshot's real page content, strips it to plain text
   (`tvStripHtml`), then feeds it to Gemini with a strict "extract only what's literally
   present in this text, do not add anything" instruction — this is the "Structuring" step:
   organizing real retrieved text, never searching/recalling. Every item's `sourceUrl` is a
   real, clickable archive.org snapshot link; `sourceDate` is the real archived date.
2. **Wikipedia (year-precise, supplementary)** — `tvGatherWikipediaNews()`: known-stable
   per-rubric category name patterns (`Category:{year} video games` etc.) → real category
   member titles → real page summaries (REST `/api/rest_v1/page/summary/{title}`, includes
   a real extract + thumbnail image) → same Gemini structuring treatment. Fills gaps Wayback
   can't cover, but only ever at year precision (Wikipedia's category system has no week
   granularity) — every such item is tagged `sourcePrecision:'year'` so the UI can show the
   user which is which.
3. **Images/photos for cutaways** — Wikipedia page summaries already include a thumbnail
   where available (used directly). Wikimedia Commons API / archive.org magazine scans /
   YouTube Data API remain a future upgrade for richer material, not wired in yet.

**Caveat, unverified end-to-end**: `web.archive.org` was not reachable from the tooling
used to build this (blocked in that sandbox) — the CDX query shape and page-fetch approach
are correct per Wayback's public docs, but this genuinely needs a real run on Костян's
machine/deployment to confirm the Wayback pass actually returns results. If it comes back
consistently empty, the Wikipedia pass alone still keeps the feature usable (just at
year-level precision) while that gets debugged.

**Calendar**: Новости tab shows a small month-grid calendar (`tvRenderNewsCalendar()`,
`#tvNewsCalendar`) with the target week's 7 days highlighted, computed client-side
(`tvComputeTargetWeek()`, mirrors `server.js`'s `tvHistoricalWeekRange()`). Display-only,
no navigation to other weeks (Костян's choice).

**Expandable rows**: click a card in either pane (`renderTvNewsPickers()`) to expand it
inline — full extract text, a real clickable source link, and any collected material
thumbnails. Expand state is UI-only (`tvExpandedNewsIds`, a `Set`), not persisted.

## Journalist — voiceover text only, must read as human-written

Only ONE text output is needed per news item: what the anchor reads aloud. No separate
print-article version. NOT YET BUILT.

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
  `{action: "trim_block", blockId, newDurationSec}`), the client applies it to
  `tvState.tvGridBlocks` (no server round-trip needed to persist it — same local workspace
  as everything else), and the UI re-renders. This is meant to feel like directing a real
  editor by note, not like operating a timeline UI. NOT YET BUILT.
  - Longer-term idea, not required for v1: since the pipeline is framed as a virtual
    "редакция" (editorial staff — journalist, editor, director, anchor), consider giving
    each virtual role its own addressable chat (not one generic assistant) — e.g. a
    "chat with the editor" for content notes vs. a "chat with the monter/editor" for
    cut/timing notes — so directing the show feels like managing a real small newsroom, not
    talking to one undifferentiated bot. Revisit once the single staff-chat (montage notes)
    is working end to end.

## Show format analysis (current task, in progress)

Goal: produce a written "формат" document — the fixed template Сетка's auto-assembly will
follow every week (segment order, typical durations, transition style, anchor-to-rubric
pacing) — based on the REAL reference show, not invented.

Two parallel passes, then reconcile:
1. **Костян watches the reference episodes himself** and notes: exact length of each
   segment type, how transitions between rubrics look/feel, overall episode runtime, and
   craft details that don't show up in a transcript (pacing of speech, camera framing
   choices, edit rhythm).
2. **A parallel AI draft, via Gemini's video understanding** (same `GEMINI_API_KEY` already
   in use — free-tier eligible, no extra cost). Script: `scripts/analyze-show-format.js`
   (one-off, manual run — NOT part of the weekly pipeline; re-run only if the reference set
   changes). Analyzes 3 real full episodes by public YouTube URL (Gemini can take a URL
   directly, no download/upload needed):
   - https://www.youtube.com/watch?v=HP3Qs4sbrBU (28.06.2002, СТС-6 канал)
   - https://www.youtube.com/watch?v=wR27UEbLjnE (04.07.2002, СТС-6 канал)
   - https://www.youtube.com/watch?v=VI797LxEM6M (11.07.2002, СТС-6 канал)

   Same 3 episodes Костян should watch himself, so the two passes reconcile against the
   same source material. Output is a DRAFT — Костян's own viewing notes are the source of
   truth where they disagree with the model's read, especially anything about craft/feel
   that a transcript can't capture.
3. **Draft template written and wired**: `TV_FORMAT_TEMPLATE` (`js/tv-state.js`) — fixed
   intro/host-intro/jingle/outro durations, rubric order (news → soft → internet → games,
   games always last), per-story duration guidelines. `tvAutoPopulateGrid()` (`js/tv-app.js`,
   "Собрать сетку" button on Сетка) builds `tvState.tvGridBlocks` from it: included news
   items grouped by rubric, with fixed bumper blocks between groups. This is explicitly a
   DRAFT from the AI-only pass (Костян hasn't reconciled his own viewing notes against it
   yet) — expect it to need correcting, especially exact durations (Gemini's own runtime
   reads were unstable across repeated runs of the same video, see the comment above
   `TV_FORMAT_TEMPLATE`). Durations shown in Сетка are estimates only — no real VO/cutaway
   material exists yet to measure against (that's the Студия/Journalist work, still NOT
   YET BUILT).

## Automation

- No scheduler/cron — every stage (news gathering, episode assembly, animation) is
  triggered manually from the browser while logged in (e.g. the "Собрать новости" button on
  Новости), not run unattended. This was a deliberate reversal of an earlier
  scheduled-Monday-cron plan — the user's role is still limited to approvals/adjustments
  rather than doing generation steps by hand, but nothing runs without the browser open.
- Real archival photos/screenshots (Wikimedia Commons, official press kits, archive.org
  magazine scans) are fine to source directly and use freely.
- Real YouTube video footage is explicitly OK to clip and use, not just reference images —
  the user has accepted the copyright/Content-ID risk personally, after being warned once.
  Don't add extra copyright-safety gating beyond the "утверждено в выпуск" approval flag —
  this was a deliberate, already-litigated decision.
- YouTube upload stays manual for now — download the finished render, no auto-upload yet.

## Already built (as of this file's writing — verify current state, may be stale)

- `tv.html` — entry page, 7-tab structure. Top-right: save-status pill + "connect folder"
  button. Bottom-right: KIE credits indicator (personal balance = live KIE balance minus a
  manually-entered "roздано пользователям" number, since dev's Postgres has no record of
  main's real users — see `js/tv-app.js`'s `tvSyncOwedInput`/`tvRenderCreditsIndicator`).
- `js/tv-state.js` — client state shape: `tvAnchors`, `tvBackdrops`, `tvNewsItems`,
  `tvGridBlocks`, etc. `tvState` IS the source of truth (no server mirror).
- `js/tv-persistence.js` — local disk/IndexedDB workspace persistence (see Architecture).
- `js/tv-app.js` — tab-switching; full anchor Character Card flow (gallery → detail → quick
  form → 6-slot reference builder → generated turnaround sheet); full backdrop flow (same,
  plus a 5-slot independently-generated angle-shots screen, `object-card.js`/`locations.js`
  pattern); "Собрать новости" on Новости.
- `server.js` — `POST /api/tv/gather-news` (real sourcing: Wayback Machine + Wikipedia,
  stateless — see "News sourcing"); anchor/backdrop Character/Object Card generation
  reuses the existing `/api/upload-reference-image` + `/api/generate-image/start`/`/status`
  routes.
- `db.js` — no `/TV`-specific tables; Postgres here is only the shared users/login/token
  schema TAKE:ONE already had.
- `scripts/analyze-show-format.js` — one-off Gemini video-understanding script for the
  show-format-analysis task above.

## New routes to build (check before assuming duplicates)

Only add a server route for something that genuinely needs the server (an external call,
like `/api/tv/gather-news`) — everything else is client-side against the local workspace.

```
POST /api/tv/staff-chat   — natural-language edit commands for Сетка (function calling).
                             Could plausibly stay 100% client-side (call Gemini directly
                             the way gather-news does, apply the returned action to
                             tvState.tvGridBlocks) — only make this a real server route if
                             there's a concrete reason the client can't do it alone.
```

## Next planned step

1. All 3 reference episodes analyzed (`scripts/show-format-draft.json`), draft template
   written and wired into Сетка (see "Show format analysis" step 3). Костян still needs to
   watch the same 3 episodes and correct the template where his notes disagree with the
   AI-only draft — treat `TV_FORMAT_TEMPLATE` as provisional until that happens.
2. News sourcing is wired (Wayback + Wikipedia, see above) but **needs a real live test**
   — specifically whether the Wayback pass returns anything at all (unverified — see the
   caveat under "News sourcing"). Try "Собрать новости" for real and report what comes
   back before trusting it.
3. Journalist: generate the actual voiceover text per news item (not yet built at all) —
   now has real sourced `extract` text per item to work from once this is confirmed
   working.
