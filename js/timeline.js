// ---------- timeline: scenes ----------
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
  scene.shots = scene.shots.filter(sh=>sh.id!==shotId);
  if(focus.shotId===shotId) focus = { sceneId, shotId:null };
  renderTimelineScenes();
  refreshMainPreview();
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
  timelineScenesEl.querySelectorAll('.shot-thumb').forEach(el=>{
    el.onclick = (e)=>{
      if(e.target.closest('.block-del') || e.target.closest('.block-rename') || e.target.closest('.shot-trim')) return;
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
      el.setPointerCapture(e.pointerId);
      document.body.style.cursor = 'ew-resize';
      const MIN_SEC = 0.5;
      const onMove = (ev)=>{
        const deltaPx = (ev.clientX - startX) / ZOOM;
        const deltaSec = deltaPx / PX_PER_SEC;
        const raw = side==='right' ? startDuration + deltaSec : startDuration - deltaSec;
        const newDuration = Math.max(MIN_SEC, Math.round(raw*10)/10);
        const wpx = Math.round(newDuration * PX_PER_SEC);
        thumbEl.style.width = wpx + 'px';
        thumbEl.style.flexBasis = wpx + 'px';
        const meta = thumbEl.querySelector('.st-meta');
        if(meta) meta.textContent = newDuration.toFixed(1) + 's';
        thumbEl.dataset.pendingDuration = newDuration;
      };
      const onUp = ()=>{
        el.removeEventListener('pointermove', onMove);
        el.removeEventListener('pointerup', onUp);
        document.body.style.cursor = '';
        const pending = parseFloat(thumbEl.dataset.pendingDuration);
        if(!isNaN(pending)) shot.duration = pending;
        renderTimelineScenes();
        if(focus.sceneId===sid && focus.shotId===shid) renderInspectorPanel();
      };
      el.addEventListener('pointermove', onMove);
      el.addEventListener('pointerup', onUp);
    });
  });
}

function wireEditModeReorder(){
  timelineScenesEl.querySelectorAll('.shot-thumb.edit-clip').forEach(el=>{
    el.addEventListener('pointerdown', (e)=>{
      if(e.target.closest('.shot-trim') || e.target.closest('.block-del') || e.target.closest('.block-rename')) return;
      const sceneId = el.dataset.scene;
      const shotId = el.dataset.shot;
      el.setPointerCapture(e.pointerId);
      let moved = false;
      let lastSwapX = e.clientX;
      const onMove = (ev)=>{
        if(Math.abs(ev.clientX - lastSwapX) < 4 && !moved) return;
        if(!moved){ moved = true; el.classList.add('dragging'); }
        const scene = state.scenes.find(s=>s.id===sceneId);
        if(!scene) return;
        const rect = el.getBoundingClientRect();
        const draggedCenter = rect.left + rect.width/2;
        const siblings = Array.from(timelineScenesEl.querySelectorAll(`.shot-thumb.edit-clip[data-scene="${sceneId}"]`));
        for(const sib of siblings){
          if(sib===el) continue;
          const sRect = sib.getBoundingClientRect();
          const sCenter = sRect.left + sRect.width/2;
          const overSib = ev.clientX > sRect.left && ev.clientX < sRect.right;
          if(overSib){
            const fromIdx = scene.shots.findIndex(sh=>sh.id===shotId);
            const toIdx = scene.shots.findIndex(sh=>sh.id===sib.dataset.shot);
            if(fromIdx>-1 && toIdx>-1 && fromIdx!==toIdx){
              const [moved_] = scene.shots.splice(fromIdx,1);
              scene.shots.splice(toIdx,0,moved_);
              lastSwapX = ev.clientX;
              renderTimelineScenes();
              const again = timelineScenesEl.querySelector(`.shot-thumb.edit-clip[data-shot="${shotId}"]`);
              if(again){ again.classList.add('dragging'); again.setPointerCapture(e.pointerId); }
            }
            break;
          }
        }
      };
      const onUp = ()=>{
        el.removeEventListener('pointermove', onMove);
        el.removeEventListener('pointerup', onUp);
        if(moved){
          const stillHere = timelineScenesEl.querySelector(`.shot-thumb.edit-clip[data-shot="${shotId}"]`);
          if(stillHere){ stillHere.classList.remove('dragging'); stillHere.dataset.wasDragged = '1'; }
        }
      };
      el.addEventListener('pointermove', onMove);
      el.addEventListener('pointerup', onUp);
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
  const totalHeight = ruler.offsetHeight + (labelsRow ? labelsRow.offsetHeight : 0) + track.offsetHeight;
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
  const track = document.getElementById('timelineTrack');
  if(!track) return null;
  const anchors = Array.from(track.querySelectorAll('[data-anchor]')).sort((a,b)=>a.offsetLeft-b.offsetLeft);
  if(anchors.length===0) return null;
  let candidate = null;
  for(const el of anchors){
    if(x >= el.offsetLeft && x < el.offsetLeft + el.offsetWidth) return el;
    if(el.offsetLeft <= x) candidate = el;
  }
  return candidate || anchors[0];
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
  focus = anchor ? { sceneId: anchor.dataset.scene, shotId: anchor.dataset.shot || null } : { sceneId:null, shotId:null };
  renderTimelineScenes();
  refreshMainPreview();
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

