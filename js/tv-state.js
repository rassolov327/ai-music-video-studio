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

const tvState = {
  activeTab: 'work',

  // Work tab — anchors (Character Card pattern) and studio backdrops (Object Card pattern).
  tvAnchors: [],    // [{ id, name, cardInputSlots, cardOutputSlots, approved }]
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

let tvAnchorSeq = 1, tvBackdropSeq = 1, tvNewsItemSeq = 1, tvGridBlockSeq = 1, tvTaskSeq = 1, tvArchiveSeq = 1;

function tvRubricLabel(key){
  const r = TV_RUBRICS.find(r=> r.key===key);
  return r ? r.label : key;
}
