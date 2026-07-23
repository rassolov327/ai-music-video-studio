// ---------- transport: play / pause / stop (with real audio playback) ----------
let isPlaying = false;
let playRafId = null;
let playStartPerf = 0, playStartX = 0;
let audioEl = null;

function updateTransportButtons(){
  const playBtn2 = document.getElementById('playBtn2');
  const pauseBtn2 = document.getElementById('pauseBtn2');
  if(playBtn2) playBtn2.classList.toggle('active', isPlaying);
  if(pauseBtn2) pauseBtn2.classList.toggle('active', !isPlaying);
}

function getActiveTrack(){
  if(!state.timelineAudio) return null;
  const musicCat = state.categories.find(c=>c.key==='music');
  return musicCat.items.find(t=>t.id===state.timelineAudio.trackId) || null;
}

function startPlayback(){
  if(isPlaying) return;
  isPlaying = true;
  updateTransportButtons();
  const track = getActiveTrack();
  if(track && track.audioUrl){
    if(!audioEl){
      audioEl = new Audio();
      audioEl.style.display = 'none';
      document.body.appendChild(audioEl);
    }
    if(audioEl.dataset.trackId !== track.id){
      audioEl.src = track.audioUrl;
      audioEl.dataset.trackId = track.id;
    }
    const ta = state.timelineAudio;
    audioEl.volume = Math.max(0, Math.min(1, ta.volume));

    // play() must be called synchronously inside the click/keydown handler — browsers
    // block audio started from an async callback instead of directly within the gesture.
    // Seeking doesn't have that restriction, so it's fine to defer until metadata is ready.
    const playPromise = audioEl.play();
    if(playPromise && playPromise.catch) playPromise.catch(err=> console.warn('Audio play() was blocked:', err));

    const doSeek = ()=>{
      try{
        const target = ta.trimIn + (playheadX / PX_PER_SEC);
        const safeOut = Math.max(ta.trimIn, (ta.trimOut || audioEl.duration || target) - 0.05);
        audioEl.currentTime = Math.min(target, safeOut);
      } catch(err){ console.warn('Audio seek failed:', err); }
    };
    if(audioEl.readyState >= 1){
      doSeek();
    } else {
      audioEl.addEventListener('loadedmetadata', doSeek, { once:true });
    }
  }
  playStartPerf = performance.now();
  playStartX = playheadX;
  runPlayLoop();
}

function runPlayLoop(){
  if(!isPlaying) return;
  const maxX = getTotalTimelinePx();

  // Single continuous driver for the whole pass, through both video shots and the audio
  // region alike — audio plays alongside it but never takes over driving the playhead, so
  // there's no jump when the track ends (or is shorter/offset) partway through the timeline.
  const elapsedSec = (performance.now() - playStartPerf) / 1000;
  playheadX = Math.min(playStartX + elapsedSec * PX_PER_SEC, maxX);

  const track = getActiveTrack();
  const ta = state.timelineAudio;
  if(track && audioEl && ta && !audioEl.paused && audioEl.currentTime >= ta.trimOut - 0.02){
    audioEl.pause();
  }

  const marker = document.getElementById('timelinePlayhead');
  if(marker) marker.style.left = playheadX + 'px';
  updateTimecodeReadout();
  updateVuMeter();

  const anchor = anchorAtX(playheadX);
  const newSceneId = anchor ? anchor.dataset.scene : null;
  const newShotId = anchor ? (anchor.dataset.shot || null) : null;
  if(newSceneId!==focus.sceneId || newShotId!==focus.shotId){
    focus = { sceneId:newSceneId, shotId:newShotId };
    renderTimelineScenes();
    refreshMainPreview();
  }

  if(playheadX >= maxX){ pausePlayback(); return; }
  playRafId = requestAnimationFrame(runPlayLoop);
}

function pausePlayback(){
  if(playRafId){ cancelAnimationFrame(playRafId); playRafId = null; }
  if(audioEl) audioEl.pause();
  isPlaying = false;
  updateTransportButtons();
  updateVuMeter(true);
}
function stopPlayback(){
  pausePlayback();
  playheadX = 0;
  if(audioEl && state.timelineAudio) audioEl.currentTime = state.timelineAudio.trimIn;
  syncFocusToPlayhead();
}

// ---------- mixer: vertical volume fader + live VU meter ----------
function renderMixerPanel(){
  if(typeof markProjectDirty==='function') markProjectDirty();
  const panel = document.getElementById('mixerPanel');
  if(!panel) return;
  const track = getActiveTrack();
  if(!track || !state.timelineAudio){
    panel.innerHTML = `<div class="mixer-empty">No audio track<br>on the timeline</div>`;
    return;
  }
  const vol = Math.round(state.timelineAudio.volume * 100);
  panel.innerHTML = `
    <div class="mixer-track-name" title="${track.name}">${track.name}</div>
    <div class="mixer-fader-row">
      <div class="vu-meter"><div class="vu-meter-fill" id="vuMeterFill" style="height:0%;"></div></div>
      <div class="fader-track" id="faderTrack">
        <div class="fader-fill" id="faderFill" style="height:${vol}%;"></div>
        <div class="fader-handle" id="faderHandle" style="bottom:${vol}%;"></div>
      </div>
    </div>
    <div class="mixer-vol-label" id="mixerVolLabel">${vol}</div>
  `;
  wireFader();
}

function applyVolume(vol){
  if(!state.timelineAudio) return;
  vol = Math.max(0, Math.min(100, Math.round(vol)));
  state.timelineAudio.volume = vol / 100;
  if(audioEl) audioEl.volume = vol / 100;
  const fill = document.getElementById('faderFill');
  const handle = document.getElementById('faderHandle');
  const label = document.getElementById('mixerVolLabel');
  if(fill) fill.style.height = vol + '%';
  if(handle) handle.style.bottom = vol + '%';
  if(label) label.textContent = vol;
}

function wireFader(){
  const trackEl = document.getElementById('faderTrack');
  if(!trackEl) return;
  function setFromClientY(clientY){
    const rect = trackEl.getBoundingClientRect();
    let ratio = 1 - (clientY - rect.top) / rect.height; // ratio-based: immune to CSS zoom, top=100%
    applyVolume(ratio * 100);
  }
  trackEl.addEventListener('pointerdown', (e)=>{
    e.preventDefault();
    trackEl.setPointerCapture(e.pointerId);
    setFromClientY(e.clientY);
    const onMove = (ev)=> setFromClientY(ev.clientY);
    const onUp = ()=>{
      trackEl.removeEventListener('pointermove', onMove);
      trackEl.removeEventListener('pointerup', onUp);
    };
    trackEl.addEventListener('pointermove', onMove);
    trackEl.addEventListener('pointerup', onUp);
  });
}

function updateVuMeter(reset){
  const fill = document.getElementById('vuMeterFill');
  if(!fill) return;
  if(reset || !isPlaying){
    fill.style.height = '0%';
    return;
  }
  const track = getActiveTrack();
  const ta = state.timelineAudio;
  if(!track || !track.peaks || !ta || !track.fullDuration){
    fill.style.height = '0%';
    return;
  }
  const curSec = ta.trimIn + (playheadX / PX_PER_SEC);
  const idx = Math.max(0, Math.min(track.peaks.length-1, Math.floor((curSec/track.fullDuration) * track.peaks.length)));
  const amp = track.peaks[idx] || 0;
  const level = Math.min(1, amp * 1.5) * (ta.volume || 0);
  fill.style.height = Math.round(level*100) + '%';
}

