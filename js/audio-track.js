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
function drawVoiceBlockWaveform(canvas, entry, trimIn, durationSec){
  if(!entry || !entry.peaks || !entry.duration) return;
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if(w===0 || h===0) return;
  canvas.width = w*dpr; canvas.height = h*dpr;
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = '#cfe8ee';
  const peaks = entry.peaks;
  const total = peaks.length;
  const startIdx = Math.max(0, Math.floor((trimIn / entry.duration) * total));
  const endIdx = Math.min(total, Math.ceil(((trimIn + durationSec) / entry.duration) * total));
  const sliceLen = Math.max(1, endIdx - startIdx);
  const step = 3;
  const bars = Math.floor(w/step);
  for(let i=0; i<bars; i++){
    const idx = startIdx + Math.floor((i/bars) * sliceLen);
    const amp = peaks[Math.min(idx, total-1)] || 0;
    const bh = Math.max(2, amp*h*0.8);
    ctx.fillRect(i*step, (h-bh)/2, 2, bh);
  }
}

// Magnet: finds the nearest snap-worthy point to targetSec (shot boundaries, the playhead,
// or another voice block's edge on any track), within a small pixel tolerance that scales
// with zoom. Returns null if magnet is off or nothing is close enough.
function findSnapPoint(targetSec, excludeTrackId, excludeBlockId){
  if(!magnetEnabled) return null;
  const toleranceSec = 8 / PX_PER_SEC;
  const candidates = [];
  let t = 0;
  state.scenes.forEach(scene=> scene.shots.forEach(shot=>{
    candidates.push(t);
    t += shot.duration;
    candidates.push(t);
  }));
  candidates.push(playheadX / PX_PER_SEC);
  (state.voiceTracks||[]).forEach(track=>{
    (track.blocks||[]).forEach(b=>{
      if(track.id===excludeTrackId && b.id===excludeBlockId) return;
      candidates.push(b.startSec);
      candidates.push(b.startSec + b.durationSec);
    });
  });
  let best = null, bestDist = toleranceSec;
  candidates.forEach(c=>{
    const dist = Math.abs(c - targetSec);
    if(dist < bestDist){ bestDist = dist; best = c; }
  });
  return best;
}

function wireVoiceBlockInteractions(){
  document.querySelectorAll('[data-voice-block-drag]').forEach(el=>{
    el.addEventListener('pointerdown', (e)=>{
      if(e.target.closest('.voice-block-trim') || e.target.closest('.voice-block-volume-line')) return;
      e.preventDefault();
      e.stopPropagation();
      const [tid, bid] = el.dataset.voiceBlockDrag.split('|');
      const originTrack = (state.voiceTracks||[]).find(t=> t.id===tid);
      const block = originTrack && (originTrack.blocks||[]).find(b=> b.id===bid);
      if(!originTrack || !block) return;
      const startX = e.clientX;
      const startSec0 = block.startSec;
      let pendingStart = startSec0;
      let targetTrackId = tid; // may change mid-drag if the pointer moves over a different track row
      document.body.style.cursor = 'grabbing';
      const onMove = (ev)=>{
        const deltaSec = (ev.clientX - startX) / PX_PER_SEC;
        let newStart = Math.max(0, startSec0 + deltaSec);
        // No live clamping against neighbors here on purpose — dragging visually past/into
        // one is how a swap is signalled; the actual collide-vs-swap decision happens on drop.
        if(magnetEnabled){
          const snapStart = findSnapPoint(newStart, tid, bid);
          const snapEnd = findSnapPoint(newStart + block.durationSec, tid, bid);
          if(snapStart !== null) newStart = snapStart;
          else if(snapEnd !== null) newStart = snapEnd - block.durationSec;
        }
        const rowEl = document.elementFromPoint(ev.clientX, ev.clientY);
        const trackRow = rowEl && rowEl.closest('.voice-track-row');
        if(trackRow && trackRow.dataset.voiceTrack) targetTrackId = trackRow.dataset.voiceTrack;
        pendingStart = Math.max(0, newStart);
        el.style.left = Math.round(pendingStart * PX_PER_SEC) + 'px';
      };
      const onUp = ()=>{
        document.removeEventListener('pointermove', onMove);
        document.removeEventListener('pointerup', onUp);
        document.body.style.cursor = '';
        const targetTrack = (state.voiceTracks||[]).find(t=> t.id===targetTrackId) || originTrack;
        const finalStart = Math.round(pendingStart*10)/10;
        const finalEnd = finalStart + block.durationSec;
        const siblings = targetTrack.blocks.filter(b=> b.id!==bid);
        const prevBlock = siblings.filter(b=> b.startSec < finalStart).sort((a,b2)=> b2.startSec - a.startSec)[0];
        const nextBlock = siblings.filter(b=> b.startSec >= finalStart).sort((a,b2)=> a.startSec - b2.startSec)[0];
        // A neighbor the block was dragged substantially into (more than 40% of the
        // shorter block's length) is treated as "swap with this one" rather than a mere
        // graze — anything less is just a normal move, clamped against that same neighbor
        // so the two still never overlap in the committed result. Swapping only makes
        // sense within the same track — a cross-track drop always just clamps.
        const candidate = targetTrack===originTrack ? [prevBlock, nextBlock].filter(Boolean).find(b=>{
          const bEnd = b.startSec + b.durationSec;
          const overlapAmt = Math.min(finalEnd, bEnd) - Math.max(finalStart, b.startSec);
          return overlapAmt > Math.min(block.durationSec, b.durationSec) * 0.4;
        }) : null;
        if(candidate){
          const otherOldStart = candidate.startSec;
          candidate.startSec = Math.round(startSec0*10)/10;
          block.startSec = Math.round(otherOldStart*10)/10;
        } else {
          const minStart = prevBlock ? prevBlock.startSec + prevBlock.durationSec : 0;
          const maxStart = nextBlock ? nextBlock.startSec - block.durationSec : Infinity;
          block.startSec = Math.max(minStart, Math.min(maxStart, finalStart));
          if(targetTrack !== originTrack){
            originTrack.blocks = originTrack.blocks.filter(b=> b.id!==bid);
            targetTrack.blocks = targetTrack.blocks || [];
            targetTrack.blocks.push(block);
          }
        }
        renderTimeline();
        if(typeof saveProjectSoon==='function') saveProjectSoon();
      };
      document.addEventListener('pointermove', onMove);
      document.addEventListener('pointerup', onUp);
    });
  });

  document.querySelectorAll('[data-voice-block-trim]').forEach(el=>{
    el.addEventListener('pointerdown', (e)=>{
      e.preventDefault();
      e.stopPropagation();
      const [tid, bid, side] = el.dataset.voiceBlockTrim.split('|');
      const track = (state.voiceTracks||[]).find(t=> t.id===tid);
      const block = track && (track.blocks||[]).find(b=> b.id===bid);
      if(!track || !block) return;
      const entry = (state.archive||[]).find(e2=> e2.id===block.archiveEntryId);
      const fullDuration = entry && entry.duration ? entry.duration : (block.trimIn||0) + block.durationSec;
      const startX = e.clientX;
      const startSec0 = block.startSec, startDur0 = block.durationSec, startTrimIn0 = block.trimIn || 0;
      const MIN_SEC = 0.5;
      const blockEl = el.parentElement;
      document.body.style.cursor = 'ew-resize';
      // Same idea as the drag case — the relevant neighbor for each side never changes
      // mid-trim, so it's found once here rather than on every pointermove.
      const nextBlock = track.blocks.filter(b=> b.id!==bid && b.startSec >= startSec0+startDur0-0.01)
        .sort((a,b2)=> a.startSec - b2.startSec)[0];
      const prevBlock = track.blocks.filter(b=> b.id!==bid && (b.startSec+b.durationSec) <= startSec0+0.01)
        .sort((a,b2)=> (b2.startSec+b2.durationSec) - (a.startSec+a.durationSec))[0];
      let pending = { startSec: startSec0, durationSec: startDur0, trimIn: startTrimIn0 };
      const onMove = (ev)=>{
        const deltaSec = (ev.clientX - startX) / PX_PER_SEC;
        if(side==='right'){
          let newDur = startDur0 + deltaSec;
          let newEnd = startSec0 + newDur;
          if(magnetEnabled){
            const snapEnd = findSnapPoint(newEnd, tid, bid);
            if(snapEnd !== null) newEnd = snapEnd;
          }
          newDur = newEnd - startSec0;
          newDur = Math.max(MIN_SEC, Math.min(newDur, fullDuration - startTrimIn0));
          if(nextBlock) newDur = Math.min(newDur, nextBlock.startSec - startSec0);
          newDur = Math.max(MIN_SEC, newDur);
          pending.durationSec = Math.round(newDur*10)/10;
        } else {
          let newTrimIn = startTrimIn0 + deltaSec;
          newTrimIn = Math.max(0, Math.min(newTrimIn, startTrimIn0 + startDur0 - MIN_SEC));
          let newStart = startSec0 + (newTrimIn - startTrimIn0);
          if(magnetEnabled){
            const snapStart = findSnapPoint(newStart, tid, bid);
            if(snapStart !== null){
              newStart = snapStart;
              newTrimIn = startTrimIn0 + (newStart - startSec0);
              newTrimIn = Math.max(0, Math.min(newTrimIn, startTrimIn0 + startDur0 - MIN_SEC));
              newStart = startSec0 + (newTrimIn - startTrimIn0);
            }
          }
          const minStart = prevBlock ? prevBlock.startSec + prevBlock.durationSec : 0;
          if(newStart < minStart){
            newStart = minStart;
            newTrimIn = startTrimIn0 + (newStart - startSec0);
          }
          const newDur = startDur0 - (newTrimIn - startTrimIn0);
          pending.startSec = Math.round(newStart*10)/10;
          pending.trimIn = Math.round(newTrimIn*10)/10;
          pending.durationSec = Math.round(newDur*10)/10;
        }
        blockEl.style.left = Math.round(pending.startSec*PX_PER_SEC)+'px';
        blockEl.style.width = Math.max(20, Math.round(pending.durationSec*PX_PER_SEC))+'px';
      };
      const onUp = ()=>{
        document.removeEventListener('pointermove', onMove);
        document.removeEventListener('pointerup', onUp);
        document.body.style.cursor = '';
        block.startSec = pending.startSec;
        block.durationSec = pending.durationSec;
        block.trimIn = pending.trimIn;
        renderTimeline();
        if(typeof saveProjectSoon==='function') saveProjectSoon();
      };
      document.addEventListener('pointermove', onMove);
      document.addEventListener('pointerup', onUp);
    });
  });

  document.querySelectorAll('[data-voice-block-volume]').forEach(el=>{
    el.addEventListener('pointerdown', (e)=>{
      e.preventDefault();
      e.stopPropagation();
      const [tid, bid] = el.dataset.voiceBlockVolume.split('|');
      const track = (state.voiceTracks||[]).find(t=> t.id===tid);
      const block = track && (track.blocks||[]).find(b=> b.id===bid);
      if(!block) return;
      const blockEl = el.parentElement;
      const rect = blockEl.getBoundingClientRect();
      document.body.style.cursor = 'ns-resize';
      const setFromClientY = (clientY)=>{
        let ratio = 1 - (clientY - rect.top) / rect.height;
        ratio = Math.max(0, Math.min(1, ratio));
        block.volume = Math.round(ratio*100)/100;
        el.style.top = Math.round((1-ratio)*100) + '%';
      };
      setFromClientY(e.clientY);
      const onMove = (ev)=> setFromClientY(ev.clientY);
      const onUp = ()=>{
        document.removeEventListener('pointermove', onMove);
        document.removeEventListener('pointerup', onUp);
        document.body.style.cursor = '';
        if(typeof saveProjectSoon==='function') saveProjectSoon();
      };
      document.addEventListener('pointermove', onMove);
      document.addEventListener('pointerup', onUp);
    });
  });
}

function renderVoiceTracksArea(){
  const area = document.getElementById('voiceTracksArea');
  if(!area) return;
  const tracks = state.voiceTracks || [];
  const canAddMore = tracks.length < MAX_VOICE_TRACKS;
  const totalWidth = typeof getTotalTimelinePx==='function' ? getTotalTimelinePx() : 0;
  area.innerHTML = tracks.map(vt=> `
    <div class="voice-track-row" data-voice-track="${vt.id}" style="width:${totalWidth}px;">
      <div class="audio-sticky-label"><div class="audio-sticky-label-inner">
        <span class="track-name"><i class="ti ti-mic"></i> ${vt.name}</span>
        <span class="voice-track-del" data-del-voice-track="${vt.id}" title="Delete track">${trashSvg(10)}</span>
      </div></div>
      <div class="voice-track-blocks">${(vt.blocks||[]).map(b=>{
        const entry = (state.archive||[]).find(e=> e.id===b.archiveEntryId);
        const label = entry ? (entry.sourceLabel || 'Audio') : 'Missing audio';
        const x = Math.round(b.startSec * PX_PER_SEC);
        const w = Math.max(20, Math.round(b.durationSec * PX_PER_SEC));
        const vol = b.volume!=null ? b.volume : 1;
        const lineTopPct = Math.round((1-vol)*100);
        return `<div class="voice-block" data-voice-block-drag="${vt.id}|${b.id}" style="left:${x}px;width:${w}px;" title="${label}">
          <canvas class="voice-block-wave" data-voice-block-wave="${vt.id}|${b.id}"></canvas>
          <span class="voice-block-label">${label}</span>
          <div class="voice-block-volume-line" data-voice-block-volume="${vt.id}|${b.id}" style="top:${lineTopPct}%;" title="Drag to change this block's volume"></div>
          <div class="voice-block-trim left" data-voice-block-trim="${vt.id}|${b.id}|left"></div>
          <div class="voice-block-trim right" data-voice-block-trim="${vt.id}|${b.id}|right"></div>
        </div>`;
      }).join('')}</div>
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
  wireVoiceBlockInteractions();

  area.querySelectorAll('[data-voice-block-wave]').forEach(canvas=>{
    const [tid, bid] = canvas.dataset.voiceBlockWave.split('|');
    const track = tracks.find(t=> t.id===tid);
    const block = track && (track.blocks||[]).find(b=> b.id===bid);
    if(!block) return;
    const entry = (state.archive||[]).find(e=> e.id===block.archiveEntryId);
    if(entry) requestAnimationFrame(()=> drawVoiceBlockWaveform(canvas, entry, block.trimIn||0, block.durationSec));
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

