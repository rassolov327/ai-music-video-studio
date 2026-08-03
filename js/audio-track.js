// ---------- timeline / audio track ----------
function setTimelineAudioTrack(trackId){
  pausePlayback();
  state.timelineAudio = { trackId, trimIn:0, trimOut:null, volume:1 };
  const musicCat = state.categories.find(c=>c.key==='music');
  const track = musicCat.items.find(t=>t.id===trackId);
  if(track) state.timelineAudio.trimOut = track.fullDuration;
  renderTimeline();
  if(typeof saveProjectSoon==='function') saveProjectSoon();
}

const MAX_VOICE_TRACKS = 5;
function addVoiceTrack(){
  state.voiceTracks = state.voiceTracks || [];
  if(state.voiceTracks.length >= MAX_VOICE_TRACKS){
    alert('Up to ' + MAX_VOICE_TRACKS + ' voice tracks are supported.');
    return;
  }
  state.voiceTracks.push({ id: 'vt' + (voiceTrackSeq++), name: 'Voice ' + (state.voiceTracks.length + 1), volume: 1, blocks: [] });
  renderTimeline();
  if(typeof saveProjectSoon==='function') saveProjectSoon();
}
function deleteVoiceTrack(trackId){
  state.voiceTracks = (state.voiceTracks || []).filter(t=> t.id!==trackId);
  renderTimeline();
  if(typeof saveProjectSoon==='function') saveProjectSoon();
}
function renameVoiceTrack(trackId, name){
  const t = (state.voiceTracks || []).find(t=> t.id===trackId);
  if(!t) return;
  t.name = (name || '').trim() || t.name;
  renderTimeline();
  if(typeof saveProjectSoon==='function') saveProjectSoon();
}

function renderTimeline(){
  if(typeof markProjectDirty==='function') markProjectDirty();
  const musicCat = state.categories.find(c=>c.key==='music');
  const waveformWrap = document.getElementById('waveformWrap');
  if(!waveformWrap) return;
  renderMixerPanel();

  // The music row keeps its own existing rendering logic entirely (real track / legacy
  // placeholder / empty state) untouched, just redirected to write into its own
  // sub-container instead of the whole wrap — the voice-tracks area sits below it and
  // renders independently, every time, regardless of which music-row branch ran.
  if(!document.getElementById('musicTrackRow')){
    waveformWrap.innerHTML = `<div id="musicTrackRow"></div><div id="voiceTracksArea"></div>`;
  }

  if(state.timelineAudio){
    const track = musicCat.items.find(t=>t.id===state.timelineAudio.trackId);
    if(track){ renderRealAudioTrack(track); wireWaveformDropZone(); renderVoiceTracksArea(); return; }
    state.timelineAudio = null;
  }

  // legacy placeholder track (no real audio bytes — kept so existing projects still show something)
  const track = musicCat.items.find(it=>!it.id) || musicCat.items[0];
  const musicRow = document.getElementById('musicTrackRow');
  if(!track){
    musicRow.innerHTML = `<div class="no-track">No music track added. Add one from the Music library on the left, or drag a track here.</div>`;
    wireWaveformDropZone();
    renderVoiceTracksArea();
    return;
  }
  musicRow.innerHTML = `
    <div class="waveform">
      <div class="audio-sticky-label"><div class="audio-sticky-label-inner">
        <span class="track-name"><i class="ti ti-music"></i> ${track.name}</span>
      </div></div>
      <canvas class="wave-canvas" id="wave"></canvas>
    </div>`;
  requestAnimationFrame(drawWave);
  wireWaveformDropZone();
  renderVoiceTracksArea();
}

// Empty voice-track rows + the "+" button to add another one, per the agreed stage-1
// scope — no block content, drag, or trim yet, just the tracks existing and being visible.
function renderVoiceTracksArea(){
  const area = document.getElementById('voiceTracksArea');
  if(!area) return;
  const tracks = state.voiceTracks || [];
  const canAddMore = tracks.length < MAX_VOICE_TRACKS;
  area.innerHTML = tracks.map(vt=> `
    <div class="voice-track-row" data-voice-track="${vt.id}">
      <div class="audio-sticky-label"><div class="audio-sticky-label-inner">
        <span class="track-name"><i class="ti ti-mic"></i> ${vt.name}</span>
        <span class="voice-track-del" data-del-voice-track="${vt.id}" title="Delete track">${trashSvg(10)}</span>
      </div></div>
      <div class="voice-track-blocks"></div>
    </div>`).join('')
    + (canAddMore ? `<div class="voice-track-add" id="addVoiceTrackBtn" title="Add voice track">${plusSvg(16)}</div>` : '');

  const addBtn = document.getElementById('addVoiceTrackBtn');
  if(addBtn) addBtn.onclick = addVoiceTrack;
  area.querySelectorAll('[data-del-voice-track]').forEach(el=>{
    el.onclick = (e)=>{
      e.stopPropagation();
      deleteVoiceTrack(el.dataset.delVoiceTrack);
    };
  });
}

function wireWaveformDropZone(){
  const waveformWrap = document.getElementById('musicTrackRow');
  if(!waveformWrap) return;
  waveformWrap.addEventListener('dragover', (e)=>{ e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; });
  waveformWrap.addEventListener('drop', (e)=>{
    e.preventDefault();
    const id = e.dataTransfer.getData('text/plain');
    if(!id) return;
    const musicCat = state.categories.find(c=>c.key==='music');
    const track = musicCat.items.find(t=>t.id===id);
    if(track) setTimelineAudioTrack(track.id);
  });
}

function renderRealAudioTrack(track){
  const waveformWrap = document.getElementById('musicTrackRow');
  if(!waveformWrap) return;
  const ta = state.timelineAudio;
  const clipWidth = Math.max(20, Math.round((ta.trimOut - ta.trimIn) * PX_PER_SEC));
  waveformWrap.innerHTML = `
    <div class="waveform real-audio">
      <div class="audio-sticky-label"><div class="audio-sticky-label-inner">
        <span class="track-name"><i class="ti ti-music"></i> ${track.name}</span>
      </div></div>
      <div class="audio-clip-wrap" id="audioClipWrap" style="width:${clipWidth}px;">
        <canvas class="wave-canvas" id="wave"></canvas>
        <div class="shot-trim left" id="audioTrimLeft" title="Trim start"></div>
        <div class="shot-trim right" id="audioTrimRight" title="Trim end"></div>
      </div>
    </div>`;
  requestAnimationFrame(()=> drawRealWave(track, ta.trimIn, ta.trimOut));

  const clipWrap = document.getElementById('audioClipWrap');
  function wireAudioTrim(handleId, side){
    const handle = document.getElementById(handleId);
    handle.addEventListener('pointerdown', (e)=>{
      e.preventDefault();
      const startX = e.clientX;
      const startIn = ta.trimIn, startOut = ta.trimOut;
      const MIN_SEC = 1;
      document.body.style.cursor = 'ew-resize';
      const onMove = (ev)=>{
        const deltaSec = ((ev.clientX - startX) / ZOOM) / PX_PER_SEC;
        if(side==='right'){
          ta.trimOut = Math.max(startIn+MIN_SEC, Math.min(track.fullDuration, startOut + deltaSec));
        } else {
          ta.trimIn = Math.max(0, Math.min(startOut-MIN_SEC, startIn + deltaSec));
        }
        // clipWrap may belong to a since-replaced render pass (a periodic re-render can
        // happen mid-drag) — look it up fresh so the live width update still lands
        // somewhere visible instead of on a detached element.
        const liveClipWrap = document.getElementById('audioClipWrap') || clipWrap;
        const wpx = Math.max(20, Math.round((ta.trimOut - ta.trimIn) * PX_PER_SEC));
        if(liveClipWrap) liveClipWrap.style.width = wpx + 'px';
        drawRealWave(track, ta.trimIn, ta.trimOut);
      };
      const onUp = ()=>{
        document.removeEventListener('pointermove', onMove);
        document.removeEventListener('pointerup', onUp);
        document.body.style.cursor = '';
        if(typeof saveProjectSoon==='function') saveProjectSoon();
      };
      document.addEventListener('pointermove', onMove);
      document.addEventListener('pointerup', onUp);
    });
  }
  wireAudioTrim('audioTrimLeft', 'left');
  wireAudioTrim('audioTrimRight', 'right');
}

function drawRealWave(track, trimIn, trimOut){
  const canvas = document.getElementById('wave');
  if(!canvas) return;
  const dpr = window.devicePixelRatio||1;
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if(w===0) return;
  canvas.width = w*dpr; canvas.height = h*dpr;
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr,dpr);
  ctx.clearRect(0,0,w,h);
  ctx.fillStyle = '#3f6b4f';
  const peaks = track.peaks;
  const total = peaks.length;
  const startIdx = Math.max(0, Math.floor((trimIn/track.fullDuration) * total));
  const endIdx = Math.min(total, Math.ceil((trimOut/track.fullDuration) * total));
  const visibleCount = Math.max(1, endIdx-startIdx);
  const step = 3;
  const bars = Math.floor(w/step);
  for(let i=0;i<bars;i++){
    const idx = startIdx + Math.floor((i/bars) * visibleCount);
    const amp = peaks[Math.min(idx, total-1)] || 0;
    const bh = Math.max(2, amp*h);
    ctx.fillRect(i*step, (h-bh)/2, 2, bh);
  }
}

function drawWave(){
  const canvas = document.getElementById('wave');
  if(!canvas) return;
  const dpr = window.devicePixelRatio||1;
  const w = canvas.clientWidth, h = canvas.clientHeight;
  canvas.width = w*dpr; canvas.height = h*dpr;
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr,dpr);
  ctx.clearRect(0,0,w,h);
  const bars = Math.floor(w/3);
  ctx.fillStyle = '#3f6b4f';
  let seed = 42;
  function rnd(){ seed = (seed*9301+49297)%233280; return seed/233280; }
  for(let i=0;i<bars;i++){
    const amp = (Math.sin(i*0.12)*0.3+0.5) * (0.4+rnd()*0.6);
    const bh = Math.max(2, amp*h);
    ctx.fillRect(i*3, (h-bh)/2, 2, bh);
  }
}

