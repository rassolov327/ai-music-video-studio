// ---------- MOVIE tab: animate already-generated shots (image-to-video) ----------
let videoModelOptions = []; // [{id, label, costUsd, blurb}]
let movieSelectedShotIds = new Set();

async function loadVideoModelList(){
  try{
    const res = await fetch('/api/video-models');
    const data = await res.json();
    videoModelOptions = (data && data.models) || [];
  } catch(err){
    videoModelOptions = [];
  }
}

function wireMoviePage(){
  const btn = document.getElementById('movieGenerateSelectedBtn');
  if(btn) btn.onclick = generateSelectedMovieShots;
}

// Every shot across every scene that has a generated still — that's the only requirement
// to show up here, per the plan: no picture yet means nothing to animate.
function collectAnimatableShots(){
  const list = [];
  for(const scene of state.scenes){
    for(const shot of (scene.shots||[])){
      if(shot.previewImage) list.push({ scene, shot });
    }
  }
  return list;
}

function videoModelSelectHtml(selectedId){
  const fallback = videoModelOptions[0] && videoModelOptions[0].id;
  const opts = videoModelOptions.map(m=>
    `<option value="${m.id}" title="${m.blurb || ''}" ${m.id===(selectedId||fallback)?'selected':''}>${m.label} — $${m.costUsd.toFixed(2)}</option>`
  ).join('');
  return `<select class="movie-tile-model-select">${opts}</select>`;
}

function renderMovieGrid(){
  const grid = document.getElementById('movieGrid');
  if(!grid) return;
  const entries = collectAnimatableShots();
  const validIds = new Set(entries.map(e=> e.shot.id));
  movieSelectedShotIds.forEach(id=>{ if(!validIds.has(id)) movieSelectedShotIds.delete(id); });

  if(entries.length===0){
    grid.innerHTML = `<div class="tasks-empty">No shots with a generated picture yet — generate a shot's preview first, then it'll show up here to animate.</div>`;
    updateMovieGenerateButton();
    return;
  }

  grid.innerHTML = entries.map(({scene, shot})=>{
    const selected = movieSelectedShotIds.has(shot.id);
    const isAnimated = !!shot.videoUrl;
    const modelId = shot._movieModel || (videoModelOptions[0] && videoModelOptions[0].id);
    const model = videoModelOptions.find(m=> m.id===modelId);
    const blurb = model ? model.blurb : '';
    return `
      <div class="task-tile draft${selected ? ' selected' : ''}" data-shot-id="${shot.id}">
        <div class="task-tile-thumb" title="Click to select for batch animate">
          <img src="${shot.previewImage}">
          ${isAnimated ? '<div class="movie-animated-badge" title="Already animated"><svg viewBox="0 0 24 24" width="11" height="11" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg></div>' : ''}
          ${selected ? '<div class="task-tile-selected-badge"><svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg></div>' : ''}
        </div>
        <div class="task-tile-body">
          <div class="task-tile-scene">${scene.name}</div>
          <div class="task-tile-shot">${shot.name}</div>
          <div class="movie-tile-desc">${shot.description ? shot.description : '<span style="color:var(--text-3);">(no description)</span>'}</div>
          ${videoModelSelectHtml(modelId)}
          ${blurb ? `<div class="gen-hint" style="margin-top:4px;">${blurb}</div>` : ''}
          <button class="cf-btn primary movie-tile-send-btn" style="width:100%;margin-top:8px;">${isAnimated ? 'Re-animate' : 'Animate'}${model ? ' — $' + model.costUsd.toFixed(2) : ''}</button>
        </div>
      </div>`;
  }).join('');

  wireMovieTiles();
  updateMovieGenerateButton();
}

function wireMovieTiles(){
  document.querySelectorAll('#movieGrid .task-tile').forEach(tile=>{
    const shotId = tile.dataset.shotId;
    const modelSelect = tile.querySelector('.movie-tile-model-select');
    modelSelect.onchange = (e)=>{
      const found = collectAnimatableShots().find(x=> x.shot.id===shotId);
      if(found){
        found.shot._movieModel = e.target.value;
        if(typeof saveProjectSoon==='function') saveProjectSoon();
      }
      renderMovieGrid();
    };
    tile.querySelector('.task-tile-thumb').onclick = (e)=>{
      if(e.target.closest('select')) return;
      if(movieSelectedShotIds.has(shotId)) movieSelectedShotIds.delete(shotId);
      else movieSelectedShotIds.add(shotId);
      renderMovieGrid();
    };
    tile.querySelector('.movie-tile-send-btn').onclick = (e)=>{
      e.stopPropagation();
      sendMovieShot(shotId);
    };
  });
}

function updateMovieGenerateButton(){
  const btn = document.getElementById('movieGenerateSelectedBtn');
  if(!btn) return;
  const selected = collectAnimatableShots().filter(e=> movieSelectedShotIds.has(e.shot.id));
  const count = selected.length;
  const total = selected.reduce((sum, e)=>{
    const modelId = e.shot._movieModel || (videoModelOptions[0] && videoModelOptions[0].id);
    const m = videoModelOptions.find(x=> x.id===modelId);
    return sum + (m ? m.costUsd : 0);
  }, 0);
  btn.disabled = count===0;
  btn.textContent = count ? ('Animate (' + count + ')' + (total ? ' — $' + total.toFixed(2) : '')) : 'Animate';
}

// Shot size and camera movement are already set in the shot's own inspector settings —
// the prompt only clarifies/reinforces them for the video model, it doesn't re-decide them.
function buildVideoPromptForShot(shot, scene){
  const parts = [];
  if(shot.description) parts.push(shot.description);
  const moveText = {
    'Static': 'camera holds steady, no camera movement',
    'Push In': 'camera slowly pushes in toward the subject',
    'Pull Out': 'camera slowly pulls back away from the subject',
    'Steadicam': 'smooth handheld steadicam movement, subtle natural drift',
    'Crane': 'sweeping crane camera movement',
  }[shot.cameraMove] || '';
  if(moveText) parts.push(moveText);
  if(shot.shotSize) parts.push('keep the ' + shot.shotSize.toLowerCase() + ' framing throughout, do not zoom past it');
  parts.push('natural believable motion, consistent lighting throughout, no morphing or distortion');
  return parts.join(', ');
}

async function sendMovieShot(shotId){
  const found = collectAnimatableShots().find(x=> x.shot.id===shotId);
  if(!found) return;
  const { scene, shot } = found;
  const tile = document.querySelector('#movieGrid .task-tile[data-shot-id="' + shotId + '"]');
  const btn = tile ? tile.querySelector('.movie-tile-send-btn') : null;
  if(btn){ btn.disabled = true; btn.textContent = 'Sending…'; }
  try{
    const modelId = shot._movieModel || (videoModelOptions[0] && videoModelOptions[0].id);
    if(!modelId) throw new Error('No video model available.');
    const imageUrl = await uploadReferencePhoto(shot.previewImage);
    if(!imageUrl) throw new Error('Could not upload the shot image.');
    const prompt = buildVideoPromptForShot(shot, scene);
    const res = await fetch('/api/generate-video/start', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt, imageUrl, duration: 5, model: modelId,
        meta: { projectId: currentProjectId, kind: 'movie', sceneId: scene.id, sceneName: scene.name, shotId: shot.id, shotName: shot.name },
      }),
    });
    const data = await res.json().catch(()=> null);
    if(!res.ok || !data || !data.taskId) throw new Error((data && data.message) || 'Could not start generation.');
    movieSelectedShotIds.delete(shotId);
    if(typeof refreshTasks==='function') await refreshTasks();
    renderMovieGrid();
  } catch(err){
    if(btn){ btn.disabled = false; btn.textContent = 'Try again'; }
    alert('Could not start animation: ' + err.message);
  }
}

async function generateSelectedMovieShots(){
  const ids = Array.from(movieSelectedShotIds);
  for(const id of ids){
    await sendMovieShot(id);
  }
}
