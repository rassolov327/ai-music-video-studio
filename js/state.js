// ---------- state ----------
const state = {
  categories: [
    {key:'music', name:'Music', icon:'ti-music', addType:'music', collapsed:true, items:[]},
    {key:'band', name:'Band / Characters', icon:'ti-users', addType:'character', collapsed:true, items:[]},
    {key:'looks', name:'Looks', icon:'ti-shirt', addType:'look', collapsed:true, items:[]},
    {key:'locations', name:'Locations', icon:'ti-map-pin', addType:'location', collapsed:true, items:[]},
    {key:'props', name:'Props', icon:'ti-box', addType:'prop', collapsed:true, items:[]},
    {key:'scenes', name:'Scenes', icon:'ti-movie', addType:'scene', collapsed:true, items:[]},
  ],
  scenes: [],
  timelineAudio: null, // { trackId, trimIn, trimOut, volume } — which Music asset (and window/volume) is on the timeline
  projectMeta: { id:null, name:'Untitled Project', format:'horizontal', width:1920, height:1080, fps:25, createdAt:null, updatedAt:null },
  // Draft generation tasks — created when you click "Generate" on a shot, but not sent to
  // any provider until you pick a model and hit Generate on the tile (or batch-select
  // several and hit the big Generate button), same idea as DaVinci's render queue.
  taskQueue: [], // [{ id, kind:'image', sceneId, shotId, sceneName, shotName, model, createdAt }]
  // Every successful generation ever made in this project, kept forever (even if removed
  // from the Tasks list or the shot/asset it was made for gets deleted) — a running history
  // to pull old results back from, not just a queue of current work.
  archive: [], // [{ id, kind, sourceLabel, model, prompt, photo, _assetFiles, createdAt }]
  // Script tab: the pasted text, and the last structured breakdown Gemini produced from it.
  // Nothing here ever touches the real project until "Export to project" is clicked.
  script: { text: '', proposal: null },
};

let sceneSeq = 1, shotSeq = 1, paletteSeq = 0, charSeq = 1, locSeq = 1, trackSeq = 1, lookSeq = 1, propSeq = 1, draftTaskSeq = 1, archiveSeq = 1, scriptItemSeq = 1;
let focus = { sceneId: null, shotId: null };
let timelineMode = 'assembly'; // 'assembly' (spaced, insert-between) | 'edit' (flush clips, drag-to-reorder within scene)
let playheadX = 0;
let PX_PER_SEC = 40; // scale of the ruler/track: 1 real second of playback = 40px — adjustable via timeline zoom
let PROJECT_FPS = 25; // per-project — set from state.projectMeta.fps when a project is created/opened
// CSS `zoom` scales rendered/visual pixels (getBoundingClientRect, clientX) but NOT layout
// pixels (offsetLeft/offsetWidth/scrollWidth) — read it once so pointer math can convert
// between the two consistently instead of drifting off the cursor.
const ZOOM = parseFloat(getComputedStyle(document.body).zoom) || 1;
const SONG_DURATION_SEC = 332; // Enter Sandman runtime (5:32) — placeholder until real audio analysis is wired up
const TIMELINE_END_SEC = SONG_DURATION_SEC * 1.1; // full scrubbable/playable range: song length + 10%

// Resolution choices offered in the New Project dialog, grouped by orientation — plain
// pixel dimensions only (no named-platform presets: some regions restrict displaying
// certain platform logos/names, so we keep this purely technical).
const RESOLUTION_OPTIONS = {
  horizontal: [
    { label:'1280 × 720',  width:1280, height:720 },
    { label:'1920 × 1080', width:1920, height:1080 },
    { label:'3840 × 2160', width:3840, height:2160 },
  ],
  vertical: [
    { label:'720 × 1280',  width:720,  height:1280 },
    { label:'1080 × 1920', width:1080, height:1920 },
    { label:'2160 × 3840', width:2160, height:3840 },
  ],
};
const FPS_OPTIONS = [24, 25, 30];

const TIMELINE_COLORS = [
  { dot:'#5f8ad4', bg:'rgba(60,95,150,0.22)',  thumb:'linear-gradient(160deg,#3a5f8a,#1c2f45)', hexA:'#3a5f8a', hexB:'#1c2f45' },
  { dot:'#7ec463', bg:'rgba(80,140,60,0.22)',  thumb:'linear-gradient(160deg,#5f8a3a,#2f451c)', hexA:'#5f8a3a', hexB:'#2f451c' },
  { dot:'#d873a3', bg:'rgba(150,60,110,0.22)', thumb:'linear-gradient(160deg,#8a3a5f,#451c2f)', hexA:'#8a3a5f', hexB:'#451c2f' },
  { dot:'#e0a54f', bg:'rgba(150,110,60,0.22)', thumb:'linear-gradient(160deg,#8a6a3a,#45351c)', hexA:'#8a6a3a', hexB:'#45351c' },
  { dot:'#4fc4b0', bg:'rgba(58,140,125,0.22)', thumb:'linear-gradient(160deg,#3a8a7a,#1c453d)', hexA:'#3a8a7a', hexB:'#1c453d' },
  { dot:'#a878e0', bg:'rgba(105,60,150,0.22)', thumb:'linear-gradient(160deg,#6a3a8a,#351c45)', hexA:'#6a3a8a', hexB:'#351c45' },
];

const assetsEl = document.getElementById('assets');
const previewEl = document.getElementById('preview');
const previewBarEl = document.getElementById('previewBar');
// waveformWrap is created fresh inside #timelineScenes on every render (see renderTimelineScenes) —
// look it up via document.getElementById('waveformWrap') at point of use instead of caching it here.
const timelineScenesEl = document.getElementById('timelineScenes');

function trashSvg(size){
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"></path><path d="M10 11v6"></path><path d="M14 11v6"></path></svg>`;
}
function pencilSvg(size){
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4Z"></path></svg>`;
}
function plusSvg(size){
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>`;
}
function noteSvg(size){
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"></path><circle cx="6" cy="18" r="3"></circle><circle cx="18" cy="16" r="3"></circle></svg>`;
}
function shirtSvg(size){
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M16 4l4 3-2.5 3-1.5-1v10a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V9l-1.5 1L4 7l4-3 2 2h4l2-2z"></path></svg>`;
}
function propSvg(size){
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M21 8l-9-5-9 5 9 5 9-5z"></path><path d="M3 8v8l9 5 9-5V8"></path><path d="M12 13v8"></path></svg>`;
}
function lookStatus(it){
  if(!it.name || !it.description) return 'red';
  if(!it.previewImage || !it.approved) return 'yellow';
  return 'green';
}

// Angle set for the character turnaround sheet — mirrors how reference-based consistency
// actually works in models like Kling Elements / GPT-Image-1 / Nano Banana: a handful of
// well-chosen angles + one expression beats a pile of near-duplicate photos.
const CHAR_ANGLE_SLOTS = [
  { key:'front',            label:'Front',        hint:'Neutral face, straight at camera', required:true },
  { key:'threeQuarterLeft', label:'3/4 Left',      hint:'Head turned ~45° left',            required:true },
  { key:'threeQuarterRight',label:'3/4 Right',     hint:'Head turned ~45° right',           required:true },
  { key:'profile',          label:'Profile',       hint:'Full side view',                   required:true },
  { key:'fullBody',         label:'Full body',     hint:'Neutral pose, base outfit',         required:true },
  { key:'smile',            label:'Expression',    hint:'Smiling / genuine expression',      required:true },
  { key:'back',             label:'Back',          hint:'Back of head (optional)',           required:false },
  { key:'closeup',          label:'Close-up',      hint:'Distinctive detail (optional)',     required:false },
];
function emptyAngleSlots(){
  const obj = {};
  CHAR_ANGLE_SLOTS.forEach(s=> obj[s.key]=null);
  return obj;
}
function filledCoreAngleCount(slots){
  if(!slots) return 0;
  return CHAR_ANGLE_SLOTS.filter(s=>s.required && slots[s.key]).length;
}
function coreAngleCountTotal(){
  return CHAR_ANGLE_SLOTS.filter(s=>s.required).length;
}

// ---------- Character Card (the real, generation-driving reference) ----------
// Source photos for building the card — deliberately ALL optional (even one photo is
// enough to attempt a full card from; more just makes it more reliable).
const CARD_INPUT_SLOTS = [
  { key:'front',            label:'Front',        hint:'Neutral face, straight at camera' },
  { key:'threeQuarterLeft', label:'3/4 Left',      hint:'Head turned ~45° left' },
  { key:'threeQuarterRight',label:'3/4 Right',     hint:'Head turned ~45° right' },
  { key:'profileLeft',      label:'Profile Left',  hint:'Full side view, facing left' },
  { key:'profileRight',     label:'Profile Right', hint:'Full side view, facing right' },
  { key:'back',             label:'Back',          hint:'Back of head/body' },
];
function emptyCardInputSlots(){
  const obj = {};
  CARD_INPUT_SLOTS.forEach(s=> obj[s.key]=null);
  return obj;
}
// The generated output — a single combined reference sheet (top row: full-body turnaround
// across a few angles, bottom row: matching close-ups directly below each) rather than many
// separate paid generations. One call, one image, everything needed is on it.
const CARD_OUTPUT_SLOTS = [
  { key:'sheet', label:'Reference Sheet' },
];
// Fixed, wide, independent of the project's own video format — the sheet's 2-row×4-panel
// layout needs width regardless of whether the video itself is vertical or horizontal.
const CARD_SHEET_WIDTH = 1600;
// Fixed clip length for MOVIE animation — full duration controls are a later task, but even
// this fixed value needs to be the ONE source of truth: the shot's timeline duration for an
// animated shot can never exceed how long the actual generated clip is (DaVinci-style — you
// can't stretch a clip's slot past its source footage).
const MOVIE_CLIP_DURATION_SEC = 5;
const CARD_SHEET_HEIGHT = 900;

// ---------- Object Card (Locations & Props — same idea as Character Card) ----------
const OBJECT_CARD_INPUT_SLOTS = [
  { key:'front', label:'Front', hint:'Straight-on view' },
  { key:'left',  label:'Left',  hint:'Turned/viewed from the left' },
  { key:'right', label:'Right', hint:'Turned/viewed from the right' },
  { key:'back',  label:'Back',  hint:'From directly behind' },
];
function emptyObjectCardInputSlots(){
  const obj = {};
  OBJECT_CARD_INPUT_SLOTS.forEach(s=> obj[s.key]=null);
  return obj;
}

function formatTimecode(seconds){
  const m = Math.floor(seconds/60);
  const s = Math.floor(seconds%60);
  return m + ':' + String(s).padStart(2,'0');
}
function formatTimecodeFrames(seconds){
  const m = Math.floor(seconds/60);
  const s = Math.floor(seconds%60);
  const f = Math.floor((seconds - Math.floor(seconds)) * PROJECT_FPS);
  return m + ':' + String(s).padStart(2,'0') + ':' + String(f).padStart(2,'0');
}
function sceneColor(scene){ return TIMELINE_COLORS[scene.colorIdx % TIMELINE_COLORS.length]; }

