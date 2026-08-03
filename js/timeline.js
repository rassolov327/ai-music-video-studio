// ---------- timeline: scenes ----------

// Renders the lip-sync reserve/release control for a shot's timeline block. This only
// applies to the photo->singing-performance pipeline (a still image + the song audio
// under it, sent as one model call) — NOT the older video-resync pipeline, which is kept
// in the codebase (queueLipsyncGeneration, /api/lipsync/start, etc.) but no longer wired to
// any button, per the decision to set it aside for now rather than delete it outright.
// One click both reserves the shot (blocking it from being sent to ANIMATIC) and queues
// the TASKS draft in the same action; clicking again just releases the reservation — the
// TASKS draft/result, if any, is left alone rather than being un-queued or deleted.
function renderLipsyncControl(sceneId, shot){
  const reserved = !!shot.lipsyncReserved;
  return `
    <div class="shot-lipsync-wrap">
      <button class="shot-lipsync-btn${reserved ? ' on' : ''}" data-lipsync-toggle="${sceneId}|${shot.id}" title="${reserved ? 'Reserved for lip-sync — click the switch to release it' : 'Reserve this shot for lip-sync (sends to TASKS)'}">Lip-sync</button>
      <button class="shot-lipsync-arrow" data-lipsync-toggle="${sceneId}|${shot.id}" title="${reserved ? 'Release — allow sending to Animatic again' : 'Reserve for lip-sync'}"><svg viewBox="0 0 20 12" width="14" height="9" fill="none"><rect x="0.5" y="0.5" width="19" height="11" rx="5.5" fill="currentColor" fill-opacity="${reserved?0.9:0.35}" stroke="currentColor" stroke-opacity="0.6"></rect><circle cx="${reserved?14:6}" cy="6" r="4" fill="#12141a"></circle></svg></button>
    </div>`;
}
function toggleLipsyncReservation(sceneId, shotId){
  const scene = state.scenes.find(s=> s.id===sceneId);
  const shot = scene && scene.shots.find(sh=> sh.id===shotId);
  if(!scene || !shot) return;
  if(shot.lipsyncReserved){
    shot.lipsyncReserved = false;
  } else {
    shot.lipsyncReserved = true;
    if(typeof queuePhotoLipsyncGeneration==='function') queuePhotoLipsyncGeneration(scene, shot);
  }
  renderTimelineScenes();
  if(typeof saveProjectSoon==='function') saveProjectSoon();
}

function addScene(){
  const id = 's' + (sceneSeq++);
  state.scenes.push({ id, name: 'Scene ' + (state.scenes.length + 1), colorIdx: paletteSeq++, shots: [] });
  focus = { sceneId: id, shotId: null };
  renderTimelineScenes();
  movePlayheadToFocus();
  positionPlayhead();
  wireTimelineDrag();
  renderAssets();
  showSceneGallery(id);
}
function deleteScene(id){
  state.scenes = state.scenes.filter(s=>s.id!==id);
  if(focus.sceneId===id) focus = { sceneId:null, shotId:null };
  renderTimelineScenes();
  renderAssets();
  refreshMainPreview();
}
function startRenameScene(id, labelEl){
  const scene = state.scenes.find(s=>s.id===id);
  if(!scene) return;
  const input = document.createElement('input');
  input.type = 'text';
  input.value = scene.name;
  input.className = 'scene-rename-input';
  labelEl.replaceWith(input);
  input.focus();
  input.select();
  function commit(){
    scene.name = input.value.trim() || scene.name;
    renderTimelineScenes();
    renderAssets();
    if(focus.sceneId===id) refreshMainPreview();
  }
  input.addEventListener('blur', commit);
  input.addEventListener('keydown', (e)=>{ if(e.key==='Enter') input.blur(); });
}
function addShotAt(sceneId, index){
  const scene = state.scenes.find(s=>s.id===sceneId);
  if(!scene) return;
  const shot = { id: 'sh' + (shotSeq++), name: 'Shot ' + (scene.shots.length + 1), duration: 5 };
  scene.shots.splice(index, 0, shot);
  focus = { sceneId, shotId: shot.id };
  renderTimelineScenes();
  movePlayheadToFocus();
  positionPlayhead();
  wireTimelineDrag();
  refreshMainPreview();
}
function deleteShot(sceneId, shotId){
  const scene = state.scenes.find(s=>s.id===sceneId);
  if(!scene) return;
  const shot = scene.shots.find(sh=>sh.id===shotId);
  if(shot && typeof deleteShotPreviewImage==='function') deleteShotPreviewImage(shot);
  scene.shots = scene.shots.filter(sh=>sh.id!==shotId);
  if(focus.shotId===shotId) focus = { sceneId, shotId:null };
  renderTimelineScenes();
  refreshMainPreview();
  if(typeof saveProjectSoon==='function') saveProjectSoon();
}
function startRenameShot(sceneId, shotId, labelEl){
  const scene = state.scenes.find(s=>s.id===sceneId);
  const shot = scene && scene.shots.find(sh=>sh.id===shotId);
  if(!shot) return;
  const input = document.createElement('input');
  input.type = 'text';
  input.value = shot.name;
  input.className = 'scene-rename-input';
  input.style.width = '64px';
  labelEl.replaceWith(input);
  input.focus();
  input.select();
  function commit(){
    shot.name = input.value.trim() || shot.name;
    renderTimelineScenes();
    if(focus.shotId===shotId) refreshMainPreview();
  }
  input.addEventListener('blur', commit);
  input.addEventListener('keydown', (e)=>{ if(e.key==='Enter') input.blur(); });
}
function setFocus(sceneId, shotId){
  focus = { sceneId, shotId: shotId || null };
  pausePlayback();
  renderTimelineScenes();
  movePlayheadToFocus();
  positionPlayhead();
  wireTimelineDrag();
  refreshMainPreview();
}

function renderTimelineScenes(){
  if(typeof markProjectDirty==='function') markProjectDirty();
  if(!timelineScenesEl) return;
  const isEdit = timelineMode==='edit';

  if(isEdit){
    renderEditModeTrack();
  } else {
    renderAssemblyModeTrack();
  }

  renderRuler();
  positionPlayhead();
  wireTimelineDrag();
}

function renderAssemblyModeTrack(){
  let trackHtml = '<div class="timeline-track" id="timelineTrack">';
  state.scenes.forEach(scene=>{
    const col = sceneColor(scene);
    trackHtml += `<div class="scene-column">
      <div class="scene-label-row">
        <span class="scene-color-dot" style="background:${col.dot};"></span>
        <span class="scene-label-name" data-rename-scene="${scene.id}">${scene.name}</span>
        <span class="scene-label-actions">
          <span class="scene-label-btn" data-rename-btn-scene="${scene.id}" title="Rename">${pencilSvg(9)}</span>
          <span class="scene-label-btn" data-del-scene="${scene.id}" title="Delete scene">${trashSvg(9)}</span>
        </span>
      </div>
      <div class="scene-cells-row" style="background:${col.bg};">`;

    if(scene.shots.length===0){
      trackHtml += `<div class="empty-scene-cell" data-anchor data-scene="${scene.id}" data-add-at="${scene.id}|0" title="Add first shot">${plusSvg(18)}</div>`;
    } else {
      trackHtml += `<div class="insert-btn" data-add-at="${scene.id}|0" title="Insert shot">${plusSvg(11)}</div>`;
      scene.shots.forEach((shot, i)=>{
        const isFocused = focus.sceneId===scene.id && focus.shotId===shot.id;
        const wpx = Math.round(shot.duration * PX_PER_SEC);
        const thumbBg = shot.previewImage ? '' : `background:${col.thumb};`;
        trackHtml += `
          <div class="shot-thumb${isFocused?' focused':''}" data-anchor data-scene="${scene.id}" data-shot="${shot.id}" style="${thumbBg}width:${wpx}px;flex-basis:${wpx}px;">
            ${shot.previewImage ? `<img src="${shot.previewImage}">` : ''}
            ${shot.videoUrl ? `<div class="shot-thumb-animated-badge" title="Animated"><svg viewBox="0 0 24 24" width="9" height="9" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg></div>` : ''}
            ${shot.previewImage && !shot.videoUrl && typeof getActiveTrack==='function' && getActiveTrack() ? renderLipsyncControl(scene.id, shot) : ''}
            <div class="shot-trim left" data-trim="${scene.id}|${shot.id}|left" title="Drag to trim"></div>
            <div class="shot-trim right" data-trim="${scene.id}|${shot.id}|right" title="Drag to trim"></div>
            <div class="block-rename" data-rename-btn-shot="${scene.id}|${shot.id}" title="Rename">${pencilSvg(9)}</div>
            <div class="block-del" data-del-shot="${scene.id}|${shot.id}" title="Delete shot">${trashSvg(9)}</div>
            <span class="st-name" data-rename-shot="${scene.id}|${shot.id}">${shot.name}</span>
            <span class="st-meta">${shot.duration}s</span>
          </div>
          <div class="insert-btn" data-add-at="${scene.id}|${i+1}" title="Insert shot">${plusSvg(11)}</div>`;
      });
    }
    trackHtml += `</div></div>`;
  });
  trackHtml += `
      <div class="add-scene-column" id="addSceneBtn" title="Add scene">${plusSvg(18)}</div>
    </div>
    <div id="waveformWrap"></div>`;
  timelineScenesEl.innerHTML = `<div class="timeline-ruler" id="timelineRuler"></div>` + trackHtml;
  document.getElementById('addSceneBtn').onclick = addScene;
  wireCommonTimelineHandlers();
  renderTimeline();
}

// Edit mode: one continuous flush strip, so clip widths line up exactly with the ruler.
// No plus buttons anywhere here — adding scenes/shots happens in Assembly mode.
function renderEditModeTrack(){
  let x = 0;
  let clipsHtml = '';
  let labelsHtml = '';
  state.scenes.forEach(scene=>{
    if(scene.shots.length===0) return; // nothing to place on a real timeline yet
    const col = sceneColor(scene);
    const sceneStartX = x;
    scene.shots.forEach(shot=>{
      const isFocused = focus.sceneId===scene.id && focus.shotId===shot.id;
      const wpx = Math.round(shot.duration * PX_PER_SEC);
      const thumbBg = shot.previewImage ? '' : `background:${col.thumb};`;
      clipsHtml += `
        <div class="shot-thumb edit-clip${isFocused?' focused':''}" data-anchor data-scene="${scene.id}" data-shot="${shot.id}"
             style="${thumbBg}border-bottom:3px solid ${col.dot};position:absolute;left:${x}px;top:0;width:${wpx}px;height:100%;">
          ${shot.previewImage ? `<img src="${shot.previewImage}">` : ''}
          ${shot.videoUrl ? `<div class="shot-thumb-animated-badge" title="Animated"><svg viewBox="0 0 24 24" width="9" height="9" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg></div>` : ''}
          ${shot.previewImage && !shot.videoUrl && typeof getActiveTrack==='function' && getActiveTrack() ? renderLipsyncControl(scene.id, shot) : ''}
          <div class="shot-trim left" data-trim="${scene.id}|${shot.id}|left" title="Drag to trim"></div>
          <div class="shot-trim right" data-trim="${scene.id}|${shot.id}|right" title="Drag to trim"></div>
          <div class="block-rename" data-rename-btn-shot="${scene.id}|${shot.id}" title="Rename">${pencilSvg(9)}</div>
          <div class="block-del" data-del-shot="${scene.id}|${shot.id}" title="Delete shot">${trashSvg(9)}</div>
          <span class="st-name" data-rename-shot="${scene.id}|${shot.id}">${shot.name}</span>
          <span class="st-meta">${shot.duration}s</span>
        </div>`;
      x += wpx;
    });
    const sceneWidth = x - sceneStartX;
    labelsHtml += `
      <div class="scene-label-row edit-label" style="position:absolute;left:${sceneStartX}px;width:${sceneWidth}px;">
        <span class="scene-color-dot" style="background:${col.dot};"></span>
        <span class="scene-label-name" data-rename-scene="${scene.id}">${scene.name}</span>
        <span class="scene-label-actions">
          <span class="scene-label-btn" data-rename-btn-scene="${scene.id}" title="Rename">${pencilSvg(9)}</span>
          <span class="scene-label-btn" data-del-scene="${scene.id}" title="Delete scene">${trashSvg(9)}</span>
        </span>
      </div>`;
  });

  const totalWidth = Math.max(x, 1);
  const html = `
    <div class="timeline-ruler" id="timelineRuler"></div>
    <div class="edit-labels-row" style="position:relative;height:16px;width:${totalWidth}px;">${labelsHtml}</div>
    <div class="timeline-track edit-track" id="timelineTrack" style="position:relative;height:60px;width:${totalWidth}px;">${clipsHtml}</div>
    <div id="waveformWrap"></div>
  `;
  timelineScenesEl.innerHTML = html;
  wireCommonTimelineHandlers();
  if(x===0){
    timelineScenesEl.querySelector('.timeline-track').innerHTML =
      `<div class="insp-empty" style="padding:8px 4px;">No shots yet — switch to Assembly to add some.</div>`;
  } else {
    wireEditModeReorder();
  }
  renderTimeline();
}

// ---------- Timeline zoom ----------
const TZ_MIN = 10, TZ_MAX = 150;

function setTimelineZoom(newPxPerSec){
  newPxPerSec = Math.max(TZ_MIN, Math.min(TZ_MAX, Math.round(newPxPerSec)));
  if(newPxPerSec === PX_PER_SEC) return;
  const ratio = newPxPerSec / PX_PER_SEC;
  playheadX = playheadX * ratio; // keep the playhead pointing at the same moment in time, not the same pixel
  PX_PER_SEC = newPxPerSec;
  renderTimelineScenes();
  positionPlayhead();
  updateTimecodeReadout();
  const slider = document.getElementById('tzZoomSlider');
  if(slider) slider.value = PX_PER_SEC;
  if(typeof saveProjectSoon==='function') saveProjectSoon();
}
function zoomTimelineBy(deltaPxPerSec){
  setTimelineZoom(PX_PER_SEC + deltaPxPerSec);
}

function wireTimelineZoomControl(){
  const slider = document.getElementById('tzZoomSlider');
  const outBtn = document.getElementById('tzZoomOutBtn');
  const inBtn = document.getElementById('tzZoomInBtn');
  if(!slider || !outBtn || !inBtn) return;
  slider.value = PX_PER_SEC;
  slider.addEventListener('input', (e)=> setTimelineZoom(parseInt(e.target.value, 10)));
  outBtn.addEventListener('click', ()=> zoomTimelineBy(-10));
  inBtn.addEventListener('click', ()=> zoomTimelineBy(10));

  const magnetBtn = document.getElementById('magnetToggleBtn');
  if(magnetBtn){
    magnetBtn.classList.toggle('active', magnetEnabled);
    magnetBtn.addEventListener('click', ()=>{
      magnetEnabled = !magnetEnabled;
      magnetBtn.classList.toggle('active', magnetEnabled);
    });
  }

  // Redirects a normal (vertical) mouse-wheel gesture into horizontal scrolling of the
  // timeline — browsers don't do this by default, only Shift+wheel does natively.
  const scenesEl = document.getElementById('timelineScenes');
  if(scenesEl && !scenesEl.dataset.wheelWired){
    scenesEl.dataset.wheelWired = '1';
    scenesEl.addEventListener('wheel', (e)=>{
      if(Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return; // already a horizontal gesture (trackpad/shift+wheel) — let it through natively
      e.preventDefault();
      scenesEl.scrollLeft += e.deltaY;
    }, { passive:false });
  }
}

function wireCommonTimelineHandlers(){
  timelineScenesEl.querySelectorAll('[data-del-scene]').forEach(el=>{
    el.onclick = (e)=>{ e.stopPropagation(); deleteScene(el.dataset.delScene); };
  });
  timelineScenesEl.querySelectorAll('[data-rename-btn-scene]').forEach(el=>{
    el.onclick = (e)=>{
      e.stopPropagation();
      const id = el.dataset.renameBtnScene;
      const label = timelineScenesEl.querySelector(`[data-rename-scene="${id}"]`);
      if(label) startRenameScene(id, label);
    };
  });
  timelineScenesEl.querySelectorAll('[data-add-at]').forEach(el=>{
    el.onclick = (e)=>{
      e.stopPropagation();
      const [sid, idx] = el.dataset.addAt.split('|');
      addShotAt(sid, parseInt(idx,10));
    };
  });
  timelineScenesEl.querySelectorAll('[data-del-shot]').forEach(el=>{
    el.onclick = (e)=>{ e.stopPropagation(); const [sid,shid]=el.dataset.delShot.split('|'); deleteShot(sid,shid); };
  });
  timelineScenesEl.querySelectorAll('[data-rename-btn-shot]').forEach(el=>{
    el.onclick = (e)=>{
      e.stopPropagation();
      const [sid,shid] = el.dataset.renameBtnShot.split('|');
      const label = timelineScenesEl.querySelector(`[data-rename-shot="${sid}|${shid}"]`);
      if(label) startRenameShot(sid, shid, label);
    };
  });
  timelineScenesEl.querySelectorAll('[data-lipsync-toggle]').forEach(el=>{
    el.onclick = (e)=>{
      e.stopPropagation();
      const [sid, shid] = el.dataset.lipsyncToggle.split('|');
      toggleLipsyncReservation(sid, shid);
    };
  });
  timelineScenesEl.querySelectorAll('.shot-thumb').forEach(el=>{
    el.onclick = (e)=>{
      if(e.target.closest('.block-del') || e.target.closest('.block-rename') || e.target.closest('.shot-trim') || e.target.closest('.shot-lipsync-wrap')) return;
      if(el.dataset.wasDragged) { delete el.dataset.wasDragged; return; }
      setFocus(el.dataset.scene, el.dataset.shot);
    };
  });
  timelineScenesEl.querySelectorAll('[data-trim]').forEach(el=>{
    el.addEventListener('pointerdown', (e)=>{
      e.preventDefault();
      e.stopPropagation();
      const [sid, shid, side] = el.dataset.trim.split('|');
      const scene = state.scenes.find(s=>s.id===sid);
      const shot = scene && scene.shots.find(sh=>sh.id===shid);
      if(!shot) return;
      const thumbEl = el.parentElement;
      const startX = e.clientX;
      const startDuration = shot.duration;
      const startTrimIn = shot.trimInSec || 0;
      document.body.style.cursor = 'ew-resize';
      const MIN_SEC = 0.5;
      const isVideo = !!shot.videoUrl;
      const MAX_SEC = isVideo ? MOVIE_CLIP_DURATION_SEC : Infinity; // a clip's slot can never exceed its actual footage
      const onMove = (ev)=>{
        const deltaPx = (ev.clientX - startX) / ZOOM;
        const deltaSec = deltaPx / PX_PER_SEC;
        let newDuration, newTrimIn = startTrimIn;
        if(side==='right'){
          const raw = startDuration + deltaSec;
          newDuration = Math.min(MAX_SEC - startTrimIn, Math.max(MIN_SEC, Math.round(raw*10)/10));
        } else if(isVideo){
          // Dragging the left handle inward (right) skips further into the source clip —
          // the in-point moves forward and duration shrinks by the same amount, so the
          // shot's end position on the timeline doesn't jump. Dragging it back out reveals
          // more of the clip's own beginning, down to its actual start (trimIn can't go below 0).
          const rawTrimIn = Math.max(0, Math.min(startTrimIn + deltaSec, startTrimIn + startDuration - MIN_SEC));
          newTrimIn = Math.round(rawTrimIn*10)/10;
          newDuration = Math.round((startDuration - (newTrimIn - startTrimIn))*10)/10;
        } else {
          const raw = startDuration - deltaSec;
          newDuration = Math.max(MIN_SEC, Math.round(raw*10)/10);
        }
        // The element being dragged (and its parent thumb) may have been replaced by a
        // periodic re-render since the drag started (autosave-adjacent timers, Tasks
        // refresh) — re-look-up the current live element by the same data-trim key
        // instead of trusting the possibly-stale thumbEl/el closures.
        const liveHandle = timelineScenesEl.querySelector(`[data-trim="${sid}|${shid}|${side}"]`);
        const liveThumb = liveHandle ? liveHandle.parentElement : thumbEl;
        if(liveThumb){
          const wpx = Math.round(newDuration * PX_PER_SEC);
          liveThumb.style.width = wpx + 'px';
          liveThumb.style.flexBasis = wpx + 'px';
          const meta = liveThumb.querySelector('.st-meta');
          if(meta) meta.textContent = newDuration.toFixed(1) + 's';
          liveThumb.dataset.pendingDuration = newDuration;
          liveThumb.dataset.pendingTrimIn = newTrimIn;
        }
      };
      const onUp = ()=>{
        document.removeEventListener('pointermove', onMove);
        document.removeEventListener('pointerup', onUp);
        document.body.style.cursor = '';
        const liveHandle = timelineScenesEl.querySelector(`[data-trim="${sid}|${shid}|${side}"]`);
        const liveThumb = liveHandle ? liveHandle.parentElement : thumbEl;
        const pending = liveThumb ? parseFloat(liveThumb.dataset.pendingDuration) : NaN;
        const pendingTrimIn = liveThumb ? parseFloat(liveThumb.dataset.pendingTrimIn) : NaN;
        if(!isNaN(pending)) shot.duration = pending;
        if(!isNaN(pendingTrimIn)) shot.trimInSec = pendingTrimIn;
        renderTimelineScenes();
        if(focus.sceneId===sid && focus.shotId===shid) renderInspectorPanel();
        if(typeof saveProjectSoon==='function') saveProjectSoon();
      };
      document.addEventListener('pointermove', onMove);
      document.addEventListener('pointerup', onUp);
    });
  });
}

function wireEditModeReorder(){
  timelineScenesEl.querySelectorAll('.shot-thumb.edit-clip').forEach(el=>{
    el.addEventListener('pointerdown', (e)=>{
      if(e.target.closest('.shot-trim') || e.target.closest('.block-del') || e.target.closest('.block-rename')) return;
      const sceneId = el.dataset.scene;
      const shotId = el.dataset.shot;
      let moved = false;
      let lastSwapX = e.clientX;
      const onMove = (ev)=>{
        if(Math.abs(ev.clientX - lastSwapX) < 4 && !moved) return;
        if(!moved){
          moved = true;
          const liveEl = timelineScenesEl.querySelector(`.shot-thumb.edit-clip[data-shot="${shotId}"]`);
          if(liveEl) liveEl.classList.add('dragging');
        }
        const scene = state.scenes.find(s=>s.id===sceneId);
        if(!scene) return;
        const draggedEl = timelineScenesEl.querySelector(`.shot-thumb.edit-clip[data-shot="${shotId}"]`);
        if(!draggedEl) return;
        const siblings = Array.from(timelineScenesEl.querySelectorAll(`.shot-thumb.edit-clip[data-scene="${sceneId}"]`));
        for(const sib of siblings){
          if(sib===draggedEl) continue;
          const sRect = sib.getBoundingClientRect();
          const overSib = ev.clientX > sRect.left && ev.clientX < sRect.right;
          if(overSib){
            const fromIdx = scene.shots.findIndex(sh=>sh.id===shotId);
            const toIdx = scene.shots.findIndex(sh=>sh.id===sib.dataset.shot);
            if(fromIdx>-1 && toIdx>-1 && fromIdx!==toIdx){
              const [moved_] = scene.shots.splice(fromIdx,1);
              scene.shots.splice(toIdx,0,moved_);
              lastSwapX = ev.clientX;
              renderTimelineScenes();
              // renderTimelineScenes() just replaced every clip element, including the one
              // being dragged — re-find it and keep the visual "dragging" state on the new
              // instance. The listeners here are on document, though, so they keep working
              // regardless of this replacement.
              const again = timelineScenesEl.querySelector(`.shot-thumb.edit-clip[data-shot="${shotId}"]`);
              if(again) again.classList.add('dragging');
            }
            break;
          }
        }
      };
      const onUp = ()=>{
        document.removeEventListener('pointermove', onMove);
        document.removeEventListener('pointerup', onUp);
        if(moved){
          const stillHere = timelineScenesEl.querySelector(`.shot-thumb.edit-clip[data-shot="${shotId}"]`);
          if(stillHere){ stillHere.classList.remove('dragging'); stillHere.dataset.wasDragged = '1'; }
          if(typeof saveProjectSoon==='function') saveProjectSoon();
        }
      };
      document.addEventListener('pointermove', onMove);
      document.addEventListener('pointerup', onUp);
    });
  });
}

function getTotalTimelinePx(){
  const track = document.getElementById('timelineTrack');
  const contentWidth = track ? track.scrollWidth : 0;
  return Math.max(contentWidth, Math.round(TIMELINE_END_SEC * PX_PER_SEC));
}
function getActualClipDurationSec(){
  let total = 0;
  state.scenes.forEach(s=> s.shots.forEach(sh=> total += sh.duration));
  return total;
}
function updateTimecodeReadout(){
  const cur = document.getElementById('tcCurrent');
  const tot = document.getElementById('tcTotal');
  const cur2 = document.getElementById('tcCurrent2');
  if(cur) cur.textContent = formatTimecode(playheadX / PX_PER_SEC);
  if(tot) tot.textContent = formatTimecode(getActualClipDurationSec());
  if(cur2) cur2.textContent = formatTimecodeFrames(playheadX / PX_PER_SEC);
}

function renderRuler(){
  const ruler = document.getElementById('timelineRuler');
  const track = document.getElementById('timelineTrack');
  if(!ruler || !track) return;
  const totalWidth = getTotalTimelinePx();
  ruler.style.width = totalWidth + 'px';
  track.style.minWidth = totalWidth + 'px';
  const totalSeconds = Math.ceil(totalWidth / PX_PER_SEC);
  const showLabels = timelineMode==='edit';
  let html = '';
  for(let s=0; s<=totalSeconds; s+=2){
    html += `<div class="ruler-tick${showLabels?' labeled':''}" style="left:${s*PX_PER_SEC}px;">${showLabels?formatTimecode(s):''}</div>`;
  }
  ruler.innerHTML = html;
}

function positionPlayhead(){
  const ruler = document.getElementById('timelineRuler');
  const track = document.getElementById('timelineTrack');
  if(!ruler || !track) return;
  const old = document.getElementById('timelinePlayhead');
  if(old) old.remove();
  playheadX = Math.max(0, Math.min(playheadX, getTotalTimelinePx()));
  const labelsRow = timelineScenesEl.querySelector('.edit-labels-row');
  const waveformWrap = document.getElementById('waveformWrap');
  const totalHeight = ruler.offsetHeight + (labelsRow ? labelsRow.offsetHeight : 0) + track.offsetHeight + (waveformWrap ? waveformWrap.offsetHeight : 0);
  const marker = document.createElement('div');
  marker.className = 'playhead-hit';
  marker.id = 'timelinePlayhead';
  marker.style.left = playheadX + 'px';
  marker.style.height = totalHeight + 'px';
  marker.innerHTML = `<div class="playhead-handle"></div><div class="playhead-line"></div><div class="playhead-flag"></div>`;
  timelineScenesEl.appendChild(marker);
  updateTimecodeReadout();
}

// returns the shot/empty-cell whose pixel range contains x, or the last one before x if x sits in a gap
function anchorAtX(x){
  let cursor = 0;
  for(const scene of state.scenes){
    if(scene.shots.length===0){
      const w = 88; // matches the empty-scene-cell's fixed width in CSS
      if(x >= cursor && x < cursor + w) return { sceneId: scene.id, shotId: null };
      cursor += w;
      continue;
    }
    for(const shot of scene.shots){
      const w = Math.round(shot.duration * PX_PER_SEC);
      if(x >= cursor && x < cursor + w) return { sceneId: scene.id, shotId: shot.id };
      cursor += w;
    }
  }
  // past the end of everything — settle on the very last shot/scene rather than nothing,
  // so playback doesn't lose focus right as it's about to stop
  for(let i=state.scenes.length-1; i>=0; i--){
    const scene = state.scenes[i];
    if(scene.shots.length) return { sceneId: scene.id, shotId: scene.shots[scene.shots.length-1].id };
    if(scene.shots.length===0) return { sceneId: scene.id, shotId: null };
  }
  return null;
}

// moves the playhead to sit exactly on the currently focused shot/scene (used after creating or clicking one)
function movePlayheadToFocus(){
  const track = document.getElementById('timelineTrack');
  if(!track || !focus.sceneId) return;
  const anchor = focus.shotId
    ? track.querySelector(`.shot-thumb[data-shot="${focus.shotId}"]`)
    : track.querySelector(`.empty-scene-cell[data-scene="${focus.sceneId}"]`);
  if(anchor) playheadX = anchor.offsetLeft + anchor.offsetWidth/2;
}

function syncFocusToPlayhead(){
  const anchor = anchorAtX(playheadX);
  focus = anchor ? { sceneId: anchor.sceneId, shotId: anchor.shotId } : { sceneId:null, shotId:null };
  renderTimelineScenes();
  refreshMainPreview();
}

// Every shot boundary in the project, in absolute timeline px, in playback order —
// scene by scene, shot by shot — regardless of which timeline mode (Assembly/Edit) is
// currently displayed, since both share the same underlying duration data.
// Absolute timeline px where a specific shot begins — used to figure out how far into that
// shot's own footage the playhead currently sits (so scrubbing into a video actually seeks
// it, instead of always showing frame 0).
function getShotStartPx(sceneId, shotId){
  let x = 0;
  for(const scene of state.scenes){
    for(const shot of scene.shots){
      if(scene.id===sceneId && shot.id===shotId) return x;
      x += Math.round(shot.duration * PX_PER_SEC);
    }
  }
  return 0;
}
// Same idea as getShotStartPx but in real seconds, independent of the timeline's current
// zoom level — this is what actually matters for figuring out which slice of the music
// file corresponds to a given shot.
function getShotStartSec(sceneId, shotId){
  let t = 0;
  for(const scene of state.scenes){
    for(const shot of scene.shots){
      if(scene.id===sceneId && shot.id===shotId) return t;
      t += shot.duration;
    }
  }
  return 0;
}

function getShotBoundariesPx(){
  const boundaries = [0];
  let x = 0;
  state.scenes.forEach(scene=>{
    scene.shots.forEach(shot=>{
      x += Math.round(shot.duration * PX_PER_SEC);
      boundaries.push(x);
    });
  });
  return boundaries;
}

// Arrow Left/Right — step the playhead by exactly one frame, at the project's own fps.
function stepPlayheadByFrame(direction){
  pausePlayback();
  const framePx = PX_PER_SEC / (PROJECT_FPS || 25);
  playheadX = Math.max(0, Math.min(playheadX + direction*framePx, getTotalTimelinePx()));
  syncFocusToPlayhead();
}

// Arrow Up/Down — jump to the previous/next cut (shot boundary) on the timeline.
function jumpPlayheadToCut(direction){
  pausePlayback();
  const boundaries = getShotBoundariesPx();
  const eps = 0.5;
  if(direction>0){
    const next = boundaries.find(b => b > playheadX + eps);
    if(next===undefined) return; // already at (or past) the last cut — nothing further to jump to
    playheadX = next;
  } else {
    let prev = 0;
    for(const b of boundaries){ if(b < playheadX - eps) prev = b; else break; }
    playheadX = prev;
  }
  playheadX = Math.max(0, Math.min(playheadX, getTotalTimelinePx()));
  syncFocusToPlayhead();
}

function wireTimelineDrag(){
  const ruler = document.getElementById('timelineRuler');
  const track = document.getElementById('timelineTrack');
  const marker = document.getElementById('timelinePlayhead');
  const handle = marker ? marker.querySelector('.playhead-handle') : null;
  if(!ruler || !track) return;

  // clientX/getBoundingClientRect are in VISUAL (post-zoom) pixels, while offsetLeft/
  // scrollWidth are in LAYOUT (pre-zoom) pixels under CSS `zoom` — divide by ZOOM so the
  // marker lands exactly under the cursor instead of drifting.
  function setPlayheadFromClientX(clientX){
    const rect = track.getBoundingClientRect();
    const logicalX = (clientX - rect.left) / ZOOM + track.scrollLeft;
    playheadX = Math.max(0, Math.min(logicalX, getTotalTimelinePx()));
  }

  ruler.onclick = (e)=>{
    pausePlayback();
    setPlayheadFromClientX(e.clientX);
    syncFocusToPlayhead();
  };

  if(handle){
    handle.addEventListener('pointerdown', (e)=>{
      e.preventDefault();
      pausePlayback();
      handle.setPointerCapture(e.pointerId);
      document.body.style.cursor = 'ew-resize';
      const onMove = (ev)=>{
        setPlayheadFromClientX(ev.clientX);
        marker.style.left = playheadX + 'px';
        updateTimecodeReadout();
      };
      const onUp = (ev)=>{
        handle.removeEventListener('pointermove', onMove);
        handle.removeEventListener('pointerup', onUp);
        document.body.style.cursor = '';
        setPlayheadFromClientX(ev.clientX);
        syncFocusToPlayhead();
      };
      handle.addEventListener('pointermove', onMove);
      handle.addEventListener('pointerup', onUp);
    });
  }
}

