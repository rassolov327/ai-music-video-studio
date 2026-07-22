// ---------- state ----------
const state = {
  categories: [
    {key:'music', name:'Music', icon:'ti-music', addType:'music', collapsed:true, items:[]},
    {key:'band', name:'Band / Characters', icon:'ti-users', addType:'character', collapsed:true, items:[]},
    {key:'looks', name:'Looks', icon:'ti-shirt', addType:'look', collapsed:true, items:[]},
    {key:'locations', name:'Locations', icon:'ti-map-pin', addType:'location', collapsed:true, items:[]},
    {key:'scenes', name:'Scenes', icon:'ti-movie', addType:'scene', collapsed:true, items:[]},
  ],
  scenes: [],
  timelineAudio: null // { trackId, trimIn, trimOut, volume } — which Music asset (and window/volume) is on the timeline
};

let sceneSeq = 1, shotSeq = 1, paletteSeq = 0, charSeq = 1, locSeq = 1, trackSeq = 1, lookSeq = 1;
let focus = { sceneId: null, shotId: null };
let timelineMode = 'assembly'; // 'assembly' (spaced, insert-between) | 'edit' (flush clips, drag-to-reorder within scene)
let playheadX = 0;
const PX_PER_SEC = 40; // scale of the ruler/track: 1 real second of playback = 40px
const PROJECT_FPS = 24; // standard film rate — used for the frame-accurate timecode readout
// CSS `zoom` scales rendered/visual pixels (getBoundingClientRect, clientX) but NOT layout
// pixels (offsetLeft/offsetWidth/scrollWidth) — read it once so pointer math can convert
// between the two consistently instead of drifting off the cursor.
const ZOOM = parseFloat(getComputedStyle(document.body).zoom) || 1;
const SONG_DURATION_SEC = 332; // Enter Sandman runtime (5:32) — placeholder until real audio analysis is wired up
const TIMELINE_END_SEC = SONG_DURATION_SEC * 1.1; // full scrubbable/playable range: song length + 10%

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

