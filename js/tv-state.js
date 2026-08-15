// ---------- /TV state ----------
// Client state for the /TV retro tech-news show. Separate from the main app's `state`
// (js/state.js) on purpose — /TV persists server-side (Postgres, see db.js) since its
// pipeline runs on a schedule with no browser open; this object is just the in-memory
// mirror the UI renders from, refreshed from /api/tv/* endpoints.
const TV_RUBRICS = [
  { key:'news',     label:'Новости'  },
  { key:'games',     label:'Игры'     },
  { key:'soft',     label:'Софт'     },
  { key:'internet', label:'Интернет' },
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

const tvState = {
  activeTab: 'work',

  // Work tab — anchors (Character Card pattern) and studio backdrops (Object Card pattern).
  // Anchors are persisted server-side (tv_anchors table) via /api/tv/anchors, not in this
  // in-memory mirror alone — this array is refreshed from the server on load and after
  // every save.
  tvAnchors: [],    // [{ id, name, role, description, photo, voiceId, card:{inputSlots,prompt,images:{sheet:{url}}}, approved }]
  tvBackdrops: [],  // [{ id, name, cardInputSlots, cardOutputSlots, angleShots, approved }]

  // Новости tab — two-pane picker: proposed items (left) vs items dragged into the episode
  // (right, `included:true`). `materialStatus` is 'ok' or 'мало материала' — when scarce,
  // the item waits for the user to upload material or explicitly request AI generation;
  // it is never auto-generated or silently dropped.
  tvNewsItems: [], // [{ id, rubric, title, summary, sourceDate, sourceUrl, media:[],
                    //    materialStatus, isAnniversary, included, assignedAnchorId,
                    //    approvedForRelease, sortOrder }]

  // Сетка tab — the assembled timeline, grouped into rubric blocks (all of one rubric
  // together before the next rubric starts).
  tvGridBlocks: [], // [{ id, rubric, newsItemId, sortOrder, voTrack, cutaways:[] }]

  // TASKS / Архив — direct analogs of the main app's taskQueue / archive.
  tvTaskQueue: [], // [{ id, kind, newsItemId, model, status, createdAt }]
  tvArchive: [],   // [{ id, kind, sourceLabel, model, prompt, url, createdAt }]

  // Anniversary calendar — flags especially notable stories automatically.
  tvAnniversaryEvents: [], // [{ id, eventDate, title, description, rubric }]

  // Current episode being worked on (the one shown across all tabs).
  tvEpisode: null, // { id, weekStartDate, sourceWeekStartDate, status, renderUrl }

  // One approval flag per tab — the "утверждено / в выпуск" gate.
  approvals: { work:false, news:false, studio:false, grid:false, tasks:false, archive:false, air:false },
};

// tvAnchors get their id from the server (tv_anchors.id, SERIAL) once saved — no client
// sequence needed for them. The rest are still client-only placeholders.
let tvBackdropSeq = 1, tvNewsItemSeq = 1, tvGridBlockSeq = 1, tvTaskSeq = 1, tvArchiveSeq = 1;

function tvRubricLabel(key){
  const r = TV_RUBRICS.find(r=> r.key===key);
  return r ? r.label : key;
}
