// ---------- /TV state ----------
// Client state for the /TV retro tech-news show. Separate from the main app's `state`
// (js/state.js) on purpose. Browser-driven, just like TAKE:ONE — no scheduler, no
// server-side data store. `tvState` IS the source of truth; js/tv-persistence.js loads it
// from and saves it to a local disk folder or IndexedDB (see that file's header comment).
const TV_RUBRICS = [
  { key:'news',     label:'Новости'    },
  { key:'games',    label:'Игры'       },
  { key:'soft',     label:'Софт'       },
  { key:'hardware', label:'Железо'     },
  { key:'internet', label:'Интернет'   },
  { key:'mobile',   label:'Мобильные технологии' },
];

// One entry per tab — each tab has its own single approval gate ("утверждено / в выпуск"),
// not per-item checkboxes scattered around.
const TV_TABS = ['work', 'news', 'studio', 'grid', 'tasks', 'archive', 'air'];

// Character Card input slots for anchors — same 6-angle set characters.js uses
// (js/state.js CARD_INPUT_SLOTS), duplicated here since tv.html doesn't load state.js.
const TV_CARD_INPUT_SLOTS = [
  { key:'front',            label:'Анфас',        hint:'Нейтральное лицо, прямо в камеру' },
  { key:'threeQuarterLeft', label:'3/4 слева',     hint:'Голова повёрнута на ~45° влево' },
  { key:'threeQuarterRight',label:'3/4 справа',    hint:'Голова повёрнута на ~45° вправо' },
  { key:'profileLeft',      label:'Профиль слева', hint:'Полный вид сбоку, лицом влево' },
  { key:'profileRight',     label:'Профиль справа',hint:'Полный вид сбоку, лицом вправо' },
  { key:'back',             label:'Затылок',       hint:'Вид сзади' },
];
function tvEmptyCardInputSlots(){
  const obj = {};
  TV_CARD_INPUT_SLOTS.forEach(s=> obj[s.key]=null);
  return obj;
}
// Fixed, wide turnaround-sheet output size — independent of the episode's own video
// format, same reasoning as CARD_SHEET_WIDTH/HEIGHT in state.js.
const TV_CARD_SHEET_WIDTH = 1600;
const TV_CARD_SHEET_HEIGHT = 900;

// Studio backdrops (Object Card pattern, same idea as Locations/Props in object-card.js —
// 4 reference-photo input slots, one generated turnaround sheet used as the consistency
// reference for everything else).
const TV_OBJECT_CARD_INPUT_SLOTS = [
  { key:'front', label:'Спереди', hint:'Вид прямо на декорацию' },
  { key:'left',  label:'Слева',   hint:'Вид с левой стороны' },
  { key:'right', label:'Справа',  hint:'Вид с правой стороны' },
  { key:'back',  label:'Сзади',   hint:'Вид сзади' },
];
function tvEmptyObjectCardInputSlots(){
  const obj = {};
  TV_OBJECT_CARD_INPUT_SLOTS.forEach(s=> obj[s.key]=null);
  return obj;
}

// Angle shots (locations.js's LOCATION_ANGLE_KEYS pattern) — five independently generated,
// actually-usable establishing-shot images of the backdrop, each one using every OTHER
// already-filled angle as a reference so the model sees the set from multiple sides at
// once instead of guessing a new one from text alone every time.
const TV_ANGLE_KEYS = ['wide', 'front', 'reverse', 'left', 'right'];
const TV_ANGLE_UI_LABELS = { wide:'Общий план', front:'Спереди', reverse:'Разворот назад', left:'Слева', right:'Справа' };
const TV_ANGLE_PROMPT_LABELS = { wide:'a wide establishing shot', front:'a front-facing shot', reverse:'the reverse angle, looking back the other way', left:'the camera turned to the left', right:'the camera turned to the right' };

// ---- Сетка format template ----
// Draft, derived from scripts/analyze-show-format.js's Gemini pass over 3 real reference
// episodes (scripts/show-format-draft.json — 28.06/04.07/11.07.2002). Костян's own viewing
// notes are the source of truth wherever they'd disagree with this — treat it as a
// starting point to correct, not a finished spec (see CLAUDE.md's "Show format analysis").
// Common pattern across all 3 episodes: ~44s station-ID/sponsor/title intro -> short host
// intro -> a "Hot Line" rapid-fire news roundup -> one or more single-topic rubric
// deep-dives (FAQ/software, internet, mobile) -> a large "Игры" block, always last and
// biggest (280-470s observed) -> a ~30s outro. The real show interleaves news roundups
// between rubric segments; /TV groups each rubric into one contiguous block instead (per
// CLAUDE.md's "Rubrics air as grouped blocks" — a deliberate simplification, not an
// oversight). Exact per-episode runtimes were NOT stable across repeated Gemini analysis
// runs of the same video (seen a >15min swing) — don't trust the raw seconds without a
// human sanity check; the segment ORDER and relative proportions held up better.
const TV_FORMAT_TEMPLATE = {
  introDurationSec: 44,      // fixed station-ID/sponsor/title jingle, reused every week
  hostIntroDurationSec: 60,  // anchor on-camera open
  jingleDurationSec: 4,      // graphic-bumper transition between blocks
  outroDurationSec: 32,      // anchor sign-off + close
  // News airs first (grouped, not interleaved — see comment above), then the deep-dive
  // rubrics, with games always last to match all 3 analyzed episodes. hardware/mobile
  // inserted alongside soft/internet — same "single-topic deep-dive" shape as those,
  // just not separately analyzed in the 3-episode pass (added later, per Костян).
  rubricOrder: ['news', 'hardware', 'soft', 'internet', 'mobile', 'games'],
  // Per-story estimate within a rubric block, seconds — used only to show an approximate
  // timeline length before any real VO/cutaway material exists. 'news' matches CLAUDE.md's
  // "full-screen cutaway stills/clips (5-15 sec each, VO continues underneath)" plus a
  // short anchor open/close; the others are the observed deep-dive segment range (60-220s),
  // 'games' skewed up since it's consistently the episode's biggest single block.
  storyDurationSec: { news: 30, soft: 100, hardware: 100, internet: 100, mobile: 100, games: 160 },
};

const tvState = {
  activeTab: 'work',

  // Work tab — anchors (Character Card pattern) and studio backdrops (Object Card pattern).
  // Persisted locally (disk folder/IndexedDB, js/tv-persistence.js) — this array IS the
  // source of truth, restored from the workspace on load and saved after every change.
  tvAnchors: [],    // [{ id, name, rubric, description, photo, voiceId, card:{inputSlots,prompt,images:{sheet:{url}}}, approved, _assetFiles }]
  tvBackdrops: [],  // [{ id, name, description, photo, card:{inputSlots,prompt,images:{sheet:{url}}}, angleShots:{wide,front,reverse,left,right:{photo}}, approved, _assetFiles }]

  // Новости tab — two-pane picker: proposed items (left) vs items dragged into the episode
  // (right, `included:true`). `materialStatus` is 'ok' or 'мало материала' — when scarce,
  // the item waits for the user to upload material or explicitly request AI generation;
  // it is never auto-generated or silently dropped. Every item is REAL — sourced from
  // Wayback Machine (sourcePrecision:'week') or Wikipedia (sourcePrecision:'year') via
  // /api/tv/gather-news, never recalled/invented (see server.js's comment there).
  // `gatheredForWeek` (ISO week-start date) tags which target week an item was fetched
  // for — tvGatherNews() archives non-included items whose week no longer matches instead
  // of letting stale proposals pile up. Archived items (`archived:true`) are deleted for
  // good 30 days after `archivedAt` (tvPruneOldArchive in tv-app.js).
  tvNewsItems: [], // [{ id, rubric, title, summary, extract, sourceDate, sourceUrl,
                    //    source:'wayback'|'wikipedia', sourcePrecision:'week'|'year',
                    //    media:[{type,url,title}], materialStatus, isAnniversary, included,
                    //    archived, archivedAt, gatheredForWeek, assignedAnchorId,
                    //    approvedForRelease, sortOrder }]

  // Сетка tab — the assembled timeline, grouped into rubric blocks (all of one rubric
  // together before the next rubric starts). Auto-populated from TV_FORMAT_TEMPLATE by
  // tvAutoPopulateGrid() in tv-app.js.
  tvGridBlocks: [], // [{ id, blockType:'intro'|'host_intro'|'jingle'|'outro'|'story',
                     //    rubric, newsItemId, sortOrder, estimatedDurationSec, voTrack, cutaways:[] }]

  // TASKS / Архив — direct analogs of the main app's taskQueue / archive.
  tvTaskQueue: [], // [{ id, kind, newsItemId, model, status, createdAt }]
  tvArchive: [],   // [{ id, kind, sourceLabel, model, prompt, url, createdAt }]

  // Anniversary calendar — flags especially notable stories automatically.
  tvAnniversaryEvents: [], // [{ id, eventDate, title, description, rubric }]

  // Current episode being worked on (the one shown across all tabs).
  tvEpisode: null, // { id, weekStartDate, sourceWeekStartDate, status, renderUrl }

  // One approval flag per tab — the "утверждено / в выпуск" gate.
  approvals: { work:false, news:false, studio:false, grid:false, tasks:false, archive:false, air:false },

  // dev has its own, separate Postgres DB from main (deliberate isolation — see
  // CLAUDE.md) — so /TV can't compute "KIE credits minus tokens owed to users" the way
  // TAKE:ONE's admin panel does, since dev genuinely has no record of main's other users.
  // The raw KIE balance itself IS live and accurate (same KIE key, no DB involved), so the
  // only missing piece is this one number — Костян checks main's admin panel and updates
  // it here himself, no DB connection between dev and main needed.
  tvOwedToUsers: 0,
};

let tvAnchorSeq = 1, tvBackdropSeq = 1, tvNewsItemSeq = 1, tvGridBlockSeq = 1, tvTaskSeq = 1, tvArchiveSeq = 1;

function tvRubricLabel(key){
  const r = TV_RUBRICS.find(r=> r.key===key);
  return r ? r.label : key;
}
