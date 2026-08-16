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
  real trial and error, do not re-derive from scratch), Character Card builder pattern
  (`characters.js`) for anchors, multi-track voice/magnet timeline (`audio-track.js`) for the
  VO-under-cutaways pattern, TASKS queue (`tasks.js`), Archive (`archive.js`), ffmpeg.wasm
  render pipeline (`render.js`), and the Gemini quick-assistant chat pattern
  (`gemini-chat.js`) — extended for /TV, see "Staff chat" below. Studios (see Work tab below)
  deliberately do NOT reuse the Object Card/angle-shots generation pattern — see "Studios +
  virtual editor (planned, staged)" below for why.

## Tab structure (final, in this order)

1. **Work** — create anchors (Character Card pattern, built) and **studios** (built, see
   "Studios + virtual editor" below): one dedicated "corner" per rubric, or one for the
   general host (`тvOpenStudioForm`/`tvOpenStudioDetail`, `js/tv-app.js`) — name, rubric
   (`<select>` over `TV_RUBRICS`, same nullable pattern as anchors), and exactly 4 general/
   establishing shots uploaded manually from disk. NOT AI-generated — this replaced an
   earlier Object Card + 5-angle-shots generation flow for backdrops, which Костян had built
   and then explicitly discarded once the real requirement became clear: one studio per
   rubric (not one backdrop with multiple angles), 4 wide shots only, and framing/crop
   decisions belong to the planned virtual editor, not to per-shot AI generation. Each anchor
   picks a rubric at creation time (`anchor.rubric`, `<select>` over `TV_RUBRICS`) OR leaves
   it unset — `rubric: null` means "hosts the whole show" (like Владимир Богданов in the
   reference show, or Сергей Пушной in Галилео), a real, named case, not a missing value.
   Mirrors the real show's structure of specialist rubric hosts plus one overall host.
   Each anchor also has a **Персона** screen (`tvOpenAnchorPersona`, `js/tv-app.js`) —
   structured character-bible fields (`TV_PERSONA_TEXT_FIELDS`/`TV_PERSONA_LIST_FIELDS` in
   `js/tv-state.js`: age, archetype, character traits, on-camera role, visual style,
   catchphrase, delivery style, on-camera habits, speech patterns, sample lines, misc
   details) — separate from Character Card (appearance only). `tvBuildAnchorVoiceContext()`
   assembles these into the plain-text block a future generation call would actually read;
   the Персона screen shows this assembled text live so it's visible before any model call
   exists. This is how new hosts get defined going forward — Костян hands over a character
   sheet like a real show's on-air talent bible, it becomes these fields, not free prose.
2. **Новости** — real-news aggregator for the matching week 25 years ago. UI: two-pane
   Total-Commander-style picker — left pane = system-proposed news items, right pane = items
   dragged in to include in the episode. Items are rubric-tagged. A calendar of known "big
   anniversary" events (e.g. PS2 launch) flags especially notable stories automatically. If
   real material (photo/video) is scarce for an item, flag it "мало материала" and WAIT —
   never auto-generate or silently drop it; the user either uploads their own material or
   explicitly requests AI generation for that item. "Собрать новости" button exists and
   calls Gemini for a draft candidate list (`POST /api/tv/gather-news`) — see "News
   sourcing" below for the fuller, not-yet-built free-API pipeline this should grow into.
3. **Редакция** (nav tab id stays `studio` internally — renamed in the UI only, since
   "Студия" clashed with the Студии entity gallery on Work; BUILT) — every included news
   item as a row, grouped by rubric block. Each row: anchor `<select>` and studio `<select>`
   (`tvOpenStudioForm`'s rubric picker's sibling pattern), both auto-filled whenever the
   match is unambiguous ("тот, кто обычно отвечает за рубрику" — Костян's framing) and
   re-checked on every render, not just once, so adding an anchor/studio later fills gaps.
   Status dot: red (nothing assigned), yellow (one of two), green (both). "Отправить на
   написание статей" queues a `kind:'article'` TASKS entry for every green item that isn't
   already written/queued (`tvSendToWriting()`, `js/tv-app.js`) — writing itself happens
   from the TASKS tile, never auto-started.
4. **Микрофонная** (BUILT) — new tab, sits between Редакция and Сетка. Anchor tile gallery
   (only anchors with at least one written item show up); clicking one opens a panel listing
   everything written for them — text, and a speaker icon that's crossed out until voiced.
   "ОЗВУЧИТЬ" queues a `kind:'voice'` TASKS entry (`tvSendToVoicing()`); once done, the icon
   turns solid/green and an inline `<audio>` player appears. Same non-auto-start rule as
   Редакция — voicing only runs when picked up from a TASKS tile.
5. **Сетка** — the real editing timeline (NLE-style), auto-populated per the show's
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
6. **TASKS** (BUILT for `kind:'article'`/`'voice'`, same two-phase tile lifecycle as
   `js/tasks.js`: draft — model picker with cost shown, waits for a manual "Сгенерировать"
   click — never auto-starts — then running/done/failed) — generation queue with model
   selection. Other kinds (image/video/lipsync for Сетка's shots) are a future extension of
   the same tile pattern, not built yet.
7. **Архив** — direct analog of TAKE:ONE's Archive.
8. **Эфир** — final render/output of the finished episode.

## Approval mechanic

Every tab has ONE big "утверждено / в выпуск" button — multi-stage approval (one gate per
tab), not per-item checkboxes scattered everywhere.

## News sourcing — FREE ONLY, no paid search — BUILT

The user wants this to cost nothing beyond what's already paid for (KIE, and Gemini stays
on its free tier). Do NOT use Gemini's paid Grounding-with-Google-Search tool. Костян's hard
requirement: **only real, sourced topics — no inventing** — and **strict week-level
accuracy**, not just "some year." `POST /api/tv/gather-news` (`server.js`) now runs three
real sources in parallel, merged, with no recall/invention fallback at all (if all three
come back empty for a week, the response is an empty list). Deliberately mixed EN + RU —
not limited to the Russian-language segment.

1. **Wayback Machine (week-precise)** — `tvGatherWaybackNews()`: for a curated list of real
   period tech sites (`TV_WAYBACK_SITES` — 14 sites: cnet.com, zdnet.com, wired.com,
   gamespot.com, ign.com, theregister.co.uk, arstechnica.com, slashdot.org, pcworld.com,
   compulenta.ru, ixbt.com, 3dnews.ru, overclockers.ru, cnews.ru), queries the CDX API with
   `matchType=domain&collapse=urlkey` for real ARTICLE pages archived anywhere under the
   domain within the *exact* target week (an earlier version queried the bare domain with no
   `matchType`, which the CDX API's default `exact` mode resolves to ONLY that literal
   homepage URL — confirmed against the CDX server's own docs as the main reason so few
   items came back; fixed), fetches each page's real content, strips it to plain text
   (`tvStripHtml`), then feeds it to Gemini with a strict "extract only what's literally
   present in this text, do not add anything" instruction — this is the "Structuring" step:
   organizing real retrieved text, never searching/recalling. Every item's `sourceUrl` is a
   real, clickable archive.org snapshot link; `sourceDate` is the real archived date. The
   14-site list is research-based, not individually confirmed against live captures (see
   caveat below).
2. **Компьютерра (week-precise, `old.computerra.ru`)** — `tvGatherComputerraNews()`: the
   exact period Russian IT outlet this file's own Journalist section names as the style
   reference. No CDX/snapshot-timing luck involved at all — the outlet keeps a real,
   permanently live per-day archive index at a confirmed URL pattern,
   `old.computerra.ru/archive/{year}/{month}/{day}/` (month/day NOT zero-padded). Every day
   of the target week gets its own direct fetch (guaranteed to exist, unlike a Wayback
   snapshot), same Gemini structuring treatment as Wayback. Confirmed live end-to-end
   (unlike Wayback, `old.computerra.ru` IS reachable from this environment) — a real fetch
   of 16.08.2001 returned the real article "Разнософт №11" dated exactly that day.
3. **Wikipedia (year-precise, supplementary)** — `tvGatherWikipediaNews()`: known-stable
   per-rubric category name patterns (`Category:{year} video games` etc.) → up to 25 real
   category member titles, top 12 used → real page summaries (REST
   `/api/rest_v1/page/summary/{title}`, includes a real extract + thumbnail image) → same
   Gemini structuring treatment. Fills gaps the other two can't cover, but only ever at year
   precision (Wikipedia's category system has no week granularity) — every such item is
   tagged `sourcePrecision:'year'` so the UI can show the user which is which. Confirmed
   live (this API IS reachable from this environment).
4. **Rubric-coverage fallback + honesty** — if a rubric still has zero items after all three
   week-precise passes, `tvMonthRange()` widens to a ~30-day window and re-runs the Wayback
   pass only, tagging results `sourcePrecision:'month'`. Rubrics still empty after that stay
   in `emptyRubrics`; rubrics that needed the wider window land in `filledFromFallback` —
   both are reported honestly in the Новости UI hint text (`tvGatherNews()`, `js/tv-app.js`),
   never silently left unexplained.
5. **Manual add** — a "+" above the "В выпуске" pane (`tvOpenManualNewsForm()`,
   `js/tv-app.js`) lets Костян add a story directly (title/rubric/content/his own photos),
   tagged `source:'manual'`, landing `included:true` immediately. A separate "Очистить"
   above "Предложено" (`tvClearProposedNews()`) archives everything still-proposed-but-not-
   included so a fresh "Собрать новости" run doesn't treat them as duplicates and can
   re-propose the same real stories (the dedup check in `tvGatherNews()` only looks at
   `!n.archived` items) — "В выпуске" is left untouched by this button on purpose.
6. **Images/photos for cutaways** — Wikipedia page summaries already include a thumbnail
   where available (used directly), everything else gets a real Wikimedia Commons search
   (`tvSearchCommonsImage()`). archive.org magazine scans / YouTube Data API remain a future
   upgrade for richer material, not wired in yet — see the archive.org full-text search API
   (`archive.org/services/search/v1/scrape`) as a promising researched-but-not-built lead for
   digitized period magazines.

**Caveat, partially unverified end-to-end**: `web.archive.org` is not reachable from the
tooling used to build this (confirmed twice — hangs, then a 504 from an intermediate proxy)
— the CDX query shape and page-fetch approach are correct per Wayback's own public docs, but
the Wayback pass genuinely needs a real run on Костян's machine/deployment to confirm it
returns results, and the 14-site list needs a real run to see which sites actually yield
material. Wikipedia and Компьютерра, by contrast, ARE confirmed live end-to-end from this
environment — if Wayback comes back consistently empty, those two alone still keep the
feature usable.

**Calendar**: Новости tab shows a small month-grid calendar (`renderTvNewsCalendar()`,
`#tvNewsCalendar`) with the target week's 7 days highlighted, computed client-side
(`tvComputeTargetWeek()`, mirrors `server.js`'s `tvHistoricalWeekRange()`). Display-only,
no navigation to other weeks (Костян's choice).

**Expandable rows**: click a card in either pane (`renderTvNewsPickers()`) to expand it
inline — full extract text, a real clickable source link, and any collected material
thumbnails. Expand state is UI-only (`tvExpandedNewsIds`, a `Set`), not persisted.

## Journalist — voiceover text only, must read as human-written

Only ONE text output is needed per news item: what the anchor reads aloud. No separate
print-article version. **v1 BUILT** (`POST /api/tv/write-article`, `server.js`) — Gemini
only, free tier, no `requireAuth` (same reasoning as `/api/tv/gather-news`: $0 cost, nothing
to bill). Client sends title/summary/extract/rubric/sourceDate plus
`tvBuildAnchorVoiceContext(anchor)`'s assembled persona text; the server prompt tells Gemini
which real year it's writing for (derived from `sourceDate`) and to use only the facts in
`extract`. Dispatched from a TASKS tile (`kind:'article'`), never auto-started — see
Редакция above for how a task gets queued.

The generation must be indistinguishable from a real human writer of that era. This is a
prompting/context problem, not a model-choice problem — v1's prompt covers the anachronism
and AI-tell rules below via instruction only:

- **Few-shot with real period text — NOT YET in the v1 prompt.** Pulling 3-5 real excerpts
  from period Russian tech press (Компьютерра, Мир ПК, Игромания, Хакер, Compulenta, iXBT —
  reachable via the Wayback Machine) and including them as style examples would sharpen this
  further; deferred as a follow-up polish pass rather than blocking v1, since a generic
  "write like it's 2001" instruction still produces usable if less sharply period-accurate
  text than showing the model real sentences would.
- **Explicit anachronism blocklist** — v1 tells the model the real target year (from the
  item's `sourceDate`) and instructs it to avoid anything that didn't exist yet, rather than
  maintaining a hardcoded per-year word list.
- **Explicit AI-tell blocklist** in the prompt — no bullet lists, no subheadings, no stock
  "Подводя итог..." closers, no artificially "balanced" both-sides hedging. Explicitly allow
  and encourage: continuous running prose, a real subjective opinion, varied sentence
  rhythm, the kind of clichés real 2000s TV journalism actually used.
- **Paid text-model alternative (Claude/GPT via KIE.ai)** — deliberately NOT wired. KIE.ai
  does proxy these, but their exact createTask request shape for text/chat wasn't confirmed
  against real docs while building this (unlike the image/video/lipsync models, whose field
  names were confirmed the hard way — see `LIPSYNC_MODELS`'s comment in `server.js`). Add it
  to `TV_TEXT_MODELS` only once that shape is confirmed for real, not guessed.

## Voicing (Микрофонная tab) — v1 BUILT

`POST /api/tv/generate-voice` (`server.js`) — Gemini's native-audio TTS, same free tier/no
`requireAuth` reasoning as writing above. Takes approved `articleText` + the anchor's
`voiceId` field (already existed, doubles as the Gemini voice name — e.g. `Kore`) and
returns raw WAV bytes directly (Gemini's response is base64 PCM; `tvPcmToWav()` wraps it
with a real WAV header so `<audio>` can play it, no separate decoder needed). Dispatched
from a TASKS tile (`kind:'voice'`), same non-auto-start rule.

**Two things genuinely unverified — no real `GEMINI_API_KEY` was available while building
this, so neither route has run against the real API yet:**
- `GEMINI_TTS_MODEL` (`server.js`) is a best-guess model id (`gemini-2.5-flash-preview-tts`),
  overridable via env without a code change — Google's TTS-specific model names churn fast,
  same caveat as `GEMINI_MODEL`'s own comment. If this 404s, that's the first thing to check.
  Error-handling itself IS verified — a real 503 "not configured" round-trips correctly
  through the TASKS tile UI when no key is set at all.
- **Paid voice alternative (ElevenLabs via KIE.ai)** — same story as the paid text model:
  KIE.ai does list ElevenLabs TTS models, but the real createTask request shape wasn't
  confirmed, so it's not wired into `TV_VOICE_MODELS`. Confirm the field names for real
  before adding it, not guessing.

## Studios + virtual editor (planned, staged)

Design agreed with Костян (chat discussion, not yet fully built) for how on-camera rubric
segments in Сетка should look — the goal is real broadcast-style cutting between shots
during a rubric's on-camera moments, not one static continuous shot of the anchor talking.
Staged into 6 steps because each depends on data the previous one produces; work through
them in order, confirming scope with Костян before starting each one (his explicit
instruction — do not batch-implement the remaining stages without checking in first).

- **A. Studios entity — BUILT.** One studio per rubric (or the null-rubric general host —
  "ведущий живёт в своей студии"), gallery of tiles like anchors (`tvOpenStudioForm`/
  `tvOpenStudioDetail`, `js/tv-app.js`; `tvState.tvStudios`, `js/tv-state.js`). Exactly 4
  general/establishing shots (`TV_STUDIO_ANGLE_KEYS`), uploaded manually from disk only —
  **no generation step anywhere in this flow**. This replaced an earlier Object Card +
  5-angle-shots AI-generation flow for "Декорации студии" (backdrops), which Костян
  explicitly discarded once the real shape of the requirement became clear: a rubric isn't
  a different angle of one shared set, it's its own dedicated studio; crop/framing decisions
  belong to the virtual editor (step D), not to separate AI-generated shots per crop size.
  Multiple studio cards CAN share a rubric — the assignment step (B) is where a specific one
  gets picked, defaulting to the match if there's only one.
- **B. Studio assignment — NOT YET BUILT.** Wherever a news item's script gets assigned to
  an anchor (planned for the Студия tab, see above, or wherever the tabled "Выход ведущего"
  work resumes), also assign which studio that anchor performs from.
- **C. Editing-technique research — NOT YET BUILT.** A separate one-off Gemini
  video-understanding script, same idea as `scripts/analyze-show-format.js` (see "Show
  format analysis" below) but analyzing cut rhythm, shot-size choices, and camera movement
  in the same reference episodes, instead of segment timing. Output: a draft ruleset the
  virtual editor (step D) follows mechanically, not something re-decided by AI every week.
- **D. Virtual editor logic — NOT YET BUILT.** Given a block's VO duration, its assigned
  studio's 4 wide shots, and the ruleset from step C, generate a sequence of "shots" — which
  of the 4 angles, what crop/shot-size, what camera movement. Camera movement is Ken Burns
  only (pan/push/pull on a still image) — explicitly nothing more elaborate. Output is data
  only at this stage (no image processing yet) — one shot list per Сетка block.
- **E. Сетка timeline + Inspector — NOT YET BUILT.** Two parts: (1) drag-to-reorder for
  rubric blocks specifically (their relative order in the episode) — NOT story order within
  a rubric, which stays picker-controlled, and NOT the fixed bumpers (intro/jingle/outro).
  (2) Clicking a block opens a timeline reusing TAKE:ONE's own scene/shot editor
  (`js/timeline.js`, `js/scenes-preview.js`) almost directly: a VO track, a music track, and
  a shots track populated from step D's output, with an Inspector panel (same shape as
  `renderInspectorPanel()` in `scenes-preview.js` — `SHOT_SIZES`, `CAMERA_MOVES`, and a
  location-angle-style picker over the block's 4 studio shots) so Костян can review/override
  what the virtual editor chose, the same way he already edits AI-video shot parameters in
  the main app.
- **F. Render integration — NOT YET BUILT.** Applying the chosen crop + Ken Burns movement
  to the studio's static photos happens only at final render (`render.js`, ffmpeg) — until
  then every studio photo is untouched, and framing/movement is only ever stored as data on
  the block's shots.

## Editing / Сетка — fully automated

The user does not want to manually edit, insert photos/materials, place jingles, or place
rubric transitions by hand. He wants to only lightly review/adjust. Concretely:

- **Сетка auto-populates from a fixed algorithm/template**, not from an AI "deciding" pacing
  fresh each week. That template comes from analyzing the real reference show once (see
  "Show format analysis" below) and is then applied mechanically every week — segment order,
  typical block durations, transition style are baked in as rules, not re-improvised.
- **Host structural text (BUILT)** — `host_intro`, `rubric_intro` (new block type — the
  host's tease before every rubric AFTER the first one; the first rubric is already teased
  by `host_intro` itself, so no redundant lead-in there), and `outro` blocks are clickable
  in Сетка (`tvOpenGridBlockEditor()`, `js/tv-app.js`). These are always the null-rubric
  general host's lines ("живёт" across the whole show, like Богданов), never a rubric
  specialist's. Left empty, a `rubric_intro` block is silently skipped in the final assembly
  (straight to that rubric's jingle); `host_intro`/`outro` can be left empty too. Text is
  written directly via a "Сделать ведущему" button (`POST /api/tv/write-block-text`,
  `server.js`, Gemini only, un-queued — unlike article writing this is meant to feel like a
  quick retake, not a TASKS job) — whatever's currently typed in the box is sent as a
  steering directive ("ведущий радостный, потому что всю ночь играл в Doom"), not dictated
  text, and the model's result replaces the box for further hand-editing. The prompt is
  grounded in the real episode lineup (`tvBuildEpisodeSummaryText()` walks the already-built
  `tvGridBlocks`+`tvNewsItems`, per Костян: "мы сначала формируем новости и уже из этого
  понимаем, каким будет выпуск"). Voicing reuses the exact same TASKS pipeline as news
  articles (`tvResolveTaskTarget()` normalizes a task's target to either a news item or a
  grid block so the rest of TASKS doesn't care which).
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
   intro/host-intro/jingle/outro durations, rubric order (news → hardware → soft → internet
   → mobile → games, games always last), per-story duration guidelines.
   `tvAutoPopulateGrid()` (`js/tv-app.js`,
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

- `tv.html` — entry page, 8-tab structure (Work, Новости, Редакция, Микрофонная, Сетка,
  TASKS, Архив, Эфир). Top-right: save-status pill + "connect folder" button. Bottom-right:
  KIE credits indicator (personal balance = live KIE balance minus a manually-entered
  "roздано пользователям" number, since dev's Postgres has no record of main's real users —
  see `js/tv-app.js`'s `tvSyncOwedInput`/`tvRenderCreditsIndicator`).
- `js/tv-state.js` — client state shape: `tvAnchors`, `tvStudios`, `tvNewsItems` (now with
  `assignedAnchorId`/`assignedStudioId`/`articleText`/`articleTaskId`/`voiceUrl`/
  `voiceTaskId`), `tvGridBlocks`, `tvTaskQueue`, etc. `tvState` IS the source of truth (no
  server mirror).
- `js/tv-persistence.js` — local disk/IndexedDB workspace persistence (see Architecture);
  `tvPersistBlobAssetDirect()` persists a Blob already in hand (e.g. straight from a fetch
  response) without the `fetch(dataUrl)` round trip local-upload photos need.
- `js/tv-app.js` — tab-switching; full anchor Character Card flow (gallery → detail → quick
  form → 6-slot reference builder → generated turnaround sheet) plus a Персона screen
  (character-bible fields — age/archetype/catchphrase/speech quirks/sample lines, see Work
  tab above); studios flow (gallery → detail → form with 4 manually-uploaded angle slots, no
  generation — see "Studios + virtual editor" above, Stage A); "Собрать новости" on Новости;
  Редакция assignment UI + "Отправить на написание статей"; real TASKS tile rendering
  (`renderTvTasks()`, `tvRunTvTask()`) for `kind:'article'`/`'voice'`; Микрофонная tab
  (`renderTvMic()`, `tvOpenMicPanel()`, `tvSendToVoicing()`).
- `server.js` — `POST /api/tv/gather-news` (real sourcing: Wayback Machine + Wikipedia,
  stateless — see "News sourcing"); `POST /api/tv/write-article` + `POST
  /api/tv/generate-voice` (see "Journalist"/"Voicing" above — Gemini only, no `requireAuth`,
  $0 cost); anchor Character Card generation reuses the existing
  `/api/upload-reference-image` + `/api/generate-image/start`/`/status` routes. Studios have
  no server route at all — pure local file upload, nothing to generate.
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
3. Journalist v1 + Voicing v1 are built (Редакция → TASKS → Микрофонная → TASKS pipeline,
   see "Journalist"/"Voicing" above) but **need a real live test with a real
   `GEMINI_API_KEY`** — neither `/api/tv/write-article` nor `/api/tv/generate-voice` has run
   against the actual Gemini API yet (no key was available while building this). Everything
   up to that boundary IS verified live: assignment defaults, TASKS draft tiles with correct
   model/cost display, the 503-not-configured error round-tripping cleanly into the TASKS
   tile instead of crashing, and the whole Микрофонная panel (crossed-out/solid speaker
   icon, audio playback) using a simulated result. Try a real write→voice round trip and
   correct `GEMINI_TTS_MODEL` if it 404s (see "Voicing" above for the fallback-via-env path).
4. Studios Stage B is done (see "Studios + virtual editor" above) — next is Stage C
   (editing-technique research script), D (virtual editor logic), E (Сетка
   timeline+Inspector), F (render). Confirm scope with Костян before starting each stage —
   do not batch them.
5. Paid model alternatives were deliberately left unwired — Claude/GPT (text) and ElevenLabs
   (voice), both via KIE.ai — because their real createTask request shapes weren't confirmed
   against actual docs while building this (WebFetch to docs.kie.ai 404'd/403'd during
   research). Confirm the real field names before adding either to `TV_TEXT_MODELS`/
   `TV_VOICE_MODELS` — guessing would repeat the exact mistake `LIPSYNC_MODELS`'s own comment
   in `server.js` already warns about.
