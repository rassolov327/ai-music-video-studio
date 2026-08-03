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
  // If a video for the current shot is already sitting in the preview (paused — either from
  // an earlier pause, or from just clicking the shot), resume it exactly where it is. A full
  // refresh here would tear down and recreate the <video> element, restarting it from 0 —
  // that was the bug: pausing mid-clip and pressing play again jumped back to the start.
  // Only fall back to a full refresh when nothing (or no video) is currently shown, e.g. the
  // very first play, or the focused shot doesn't have a video ready yet.
  const existingVideo = previewEl.querySelector('video');
  if(existingVideo){
    existingVideo.play().catch(()=>{});
  } else if(typeof refreshMainPreview==='function'){
    refreshMainPreview();
  }
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

// One <audio> element per voice track, reused for whichever block is currently under the
// playhead — blocks on the same track never overlap by design, so at most one is ever
// active per track at a time.
const voiceTrackAudioEls = {};
function getVoiceTrackAudioEl(trackId){
  if(!voiceTrackAudioEls[trackId]){
    const el = new Audio();
    el.style.display = 'none';
    document.body.appendChild(el);
    voiceTrackAudioEls[trackId] = el;
  }
  return voiceTrackAudioEls[trackId];
}
function syncVoiceTracksPlayback(currentSec){
  (state.voiceTracks||[]).forEach(track=>{
    const el = getVoiceTrackAudioEl(track.id);
    const activeBlock = (track.blocks||[]).find(b=> currentSec >= b.startSec && currentSec < b.startSec + b.durationSec);
    if(!activeBlock){
      if(!el.paused) el.pause();
      el.dataset.blockId = '';
      return;
    }
    const entry = (state.archive||[]).find(e=> e.id===activeBlock.archiveEntryId);
    if(!entry || !entry.photo){
      if(!el.paused) el.pause();
      return;
    }
    const trackVol = track.volume!=null ? track.volume : 1;
    const blockVol = activeBlock.volume!=null ? activeBlock.volume : 1;
    el.volume = Math.max(0, Math.min(1, trackVol * blockVol));
    if(el.dataset.blockId !== activeBlock.id){
      el.src = entry.photo;
      el.dataset.blockId = activeBlock.id;
      const seekTarget = (activeBlock.trimIn||0) + (currentSec - activeBlock.startSec);
      const doSeek = ()=>{ el.currentTime = seekTarget; if(isPlaying) el.play().catch(()=>{}); };
      if(el.readyState >= 1) doSeek();
      else el.addEventListener('loadedmetadata', doSeek, { once:true });
    } else if(isPlaying && el.paused){
      el.play().catch(()=>{});
    }
  });
}
function pauseAllVoiceTracks(){
  Object.values(voiceTrackAudioEls).forEach(el=>{ if(!el.paused) el.pause(); });
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
  syncVoiceTracksPlayback(playheadX / PX_PER_SEC);

  const marker = document.getElementById('timelinePlayhead');
  if(marker) marker.style.left = playheadX + 'px';
  updateTimecodeReadout();
  updateVuMeter();

  const anchor = anchorAtX(playheadX);
  const newSceneId = anchor ? anchor.sceneId : null;
  const newShotId = anchor ? anchor.shotId : null;
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
  pauseAllVoiceTracks();
  const previewVideo = previewEl && previewEl.querySelector('video');
  if(previewVideo) previewVideo.pause();
  isPlaying = false;
  updateTransportButtons();
  updateVuMeter(true);
}
function stopPlayback(){
  pausePlayback();
  playheadX = 0;
  if(audioEl && state.timelineAudio) audioEl.currentTime = state.timelineAudio.trimIn;
  Object.keys(voiceTrackAudioEls).forEach(tid=>{ voiceTrackAudioEls[tid].dataset.blockId = ''; });
  syncFocusToPlayhead();
}

// ---------- mixer: one vertical volume fader + live VU meter per track, side by side ----------
function renderMixerPanel(){
  if(typeof markProjectDirty==='function') markProjectDirty();
  const panel = document.getElementById('mixerPanel');
  if(!panel) return;

  const channels = [];
  const musicTrack = getActiveTrack();
  if(musicTrack && state.timelineAudio){
    channels.push({
      id: 'music', name: musicTrack.name, hasVu: true,
      getVolume: ()=> state.timelineAudio.volume,
      setVolume: (v)=>{ state.timelineAudio.volume = v; if(audioEl) audioEl.volume = v; },
    });
  }
  (state.voiceTracks || []).forEach(vt=>{
    channels.push({
      id: vt.id, name: vt.name, hasVu: false,
      getVolume: ()=> vt.volume,
      setVolume: (v)=>{ vt.volume = v; },
    });
  });

  if(channels.length===0){
    panel.innerHTML = `<div class="mixer-empty">No audio track<br>on the timeline</div>`;
    return;
  }

  panel.innerHTML = channels.map(ch=>{
    const vol = Math.round(ch.getVolume() * 100);
    return `
      <div class="mixer-channel">
        <div class="mixer-track-name" title="${ch.name}">${ch.name}</div>
        <div class="mixer-fader-row">
          ${ch.hasVu ? `<div class="vu-meter"><div class="vu-meter-fill" id="vuMeterFill" style="height:0%;"></div></div>` : ''}
          <div class="fader-track" data-fader-channel="${ch.id}">
            <div class="fader-fill" style="height:${vol}%;"></div>
            <div class="fader-handle" style="bottom:${vol}%;"></div>
          </div>
        </div>
        <div class="mixer-vol-label" data-vol-label-channel="${ch.id}">${vol}</div>
      </div>`;
  }).join('');

  channels.forEach(ch=> wireFader(ch));
}

function wireFader(channel){
  const trackEl = document.querySelector(`[data-fader-channel="${channel.id}"]`);
  if(!trackEl) return;
  function setFromClientY(clientY){
    const rect = trackEl.getBoundingClientRect();
    let ratio = 1 - (clientY - rect.top) / rect.height; // ratio-based: immune to CSS zoom, top=100%
    ratio = Math.max(0, Math.min(1, ratio));
    const vol = Math.round(ratio * 100);
    channel.setVolume(vol / 100);
    const fill = trackEl.querySelector('.fader-fill');
    const handle = trackEl.querySelector('.fader-handle');
    const label = document.querySelector(`[data-vol-label-channel="${channel.id}"]`);
    if(fill) fill.style.height = vol + '%';
    if(handle) handle.style.bottom = vol + '%';
    if(label) label.textContent = vol;
  }
  trackEl.addEventListener('pointerdown', (e)=>{
    e.preventDefault();
    trackEl.setPointerCapture(e.pointerId);
    setFromClientY(e.clientY);
    const onMove = (ev)=> setFromClientY(ev.clientY);
    const onUp = ()=>{
      trackEl.removeEventListener('pointermove', onMove);
      trackEl.removeEventListener('pointerup', onUp);
      if(typeof saveProjectSoon==='function') saveProjectSoon();
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


