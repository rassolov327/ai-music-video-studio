// ---------- WORK / TASKS bottom page tabs (DaVinci-Resolve style render queue) ----------
let tasksRefreshTimer = null;
let liveTasks = []; // last fetched snapshot from the server
let modelOptions = [];
let appliedTaskIds = new Set(); // avoid re-applying the same finished result repeatedly

function wirePageTabs(){
  document.querySelectorAll('.page-tab').forEach(tab=>{
    tab.onclick = ()=> showPage(tab.dataset.page);
  });
  const modal = document.getElementById('taskPreviewModal');
  document.getElementById('taskPreviewClose').onclick = ()=> modal.classList.add('hidden');
  modal.onclick = (e)=>{ if(e.target===modal) modal.classList.add('hidden'); };

  document.getElementById('tasksSelectAll').onchange = (e)=>{
    document.querySelectorAll('.task-tile-select').forEach(cb=>{ cb.checked = e.target.checked; });
    updateGenerateSelectedButton();
  };
  document.getElementById('tasksGenerateSelectedBtn').onclick = generateSelectedDraftTasks;
}

function showPage(page){
  document.querySelectorAll('.page-tab').forEach(t=> t.classList.toggle('active', t.dataset.page===page));
  document.getElementById('workPage').classList.toggle('hidden', page!=='work');
  document.getElementById('tasksPage').classList.toggle('hidden', page!=='tasks');
  if(page==='tasks'){
    refreshTasks();
    if(tasksRefreshTimer) clearInterval(tasksRefreshTimer);
    tasksRefreshTimer = setInterval(refreshTasks, 4000);
  } else if(tasksRefreshTimer){
    clearInterval(tasksRefreshTimer);
    tasksRefreshTimer = null;
  }
}

// Tasks keep working in the background regardless of which page is showing — this timer
// is separate from the tab's own refresh loop and just needs to catch completed results
// so they land on their shot even if the user never opens the Tasks tab at all.
function startBackgroundTaskWatcher(){
  setInterval(refreshTasks, 6000);
}

async function loadModelList(){
  try{
    const res = await fetch('/api/models');
    const data = await res.json();
    modelOptions = (data && data.models) || [];
  } catch(err){
    modelOptions = [];
  }
}

async function refreshTasks(){
  if(!currentProjectId) return;
  try{
    const res = await fetch('/api/tasks?projectId=' + encodeURIComponent(currentProjectId));
    const data = await res.json();
    liveTasks = (data && data.tasks) || [];
  } catch(err){
    liveTasks = [];
  }
  renderTasksGrid();
  applyFinishedTasks(liveTasks);
  updateTasksBadge();
}

function updateTasksBadge(){
  const badge = document.getElementById('tasksBadge');
  if(!badge) return;
  const draftCount = (state.taskQueue || []).length;
  const pendingCount = liveTasks.filter(t=> t.status==='pending').length;
  const total = draftCount + pendingCount;
  badge.style.display = total ? '' : 'none';
  badge.textContent = String(total);
}

function modelSelectHtml(selectedId, extraClass){
  const opts = modelOptions.map(m=> `<option value="${m.id}" ${m.id===selectedId?'selected':''}>${m.label}</option>`).join('');
  return `<select class="${extraClass||''}">${opts}</select>`;
}

function renderTasksGrid(){
  const grid = document.getElementById('tasksGrid');
  if(!grid) return;
  const drafts = state.taskQueue || [];
  if(drafts.length===0 && liveTasks.length===0){
    grid.innerHTML = `<div class="tasks-empty">No generation tasks yet. Use "Add to Tasks (real AI)" on a shot to queue one — pick a model here and hit Generate whenever you're ready.</div>`;
    updateGenerateSelectedButton();
    return;
  }

  const draftTiles = drafts.map(t=>`
    <div class="task-tile draft" data-draft-id="${t.id}">
      <div class="task-tile-thumb">
        <input type="checkbox" class="task-tile-select" title="Select for batch generate">
        <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"></rect><circle cx="9" cy="11" r="2"></circle><path d="M21 16l-5-4-4 3-3-2-6 5"></path></svg>
        <div class="task-tile-status draft">draft</div>
        <div class="task-tile-trash" title="Remove from queue"><svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"></path><path d="M10 11v6"></path><path d="M14 11v6"></path></svg></div>
      </div>
      <div class="task-tile-body">
        <div class="task-tile-scene">${t.sceneName || 'Scene'}</div>
        <div class="task-tile-shot">${t.shotName || 'Shot'}</div>
        ${modelSelectHtml(t.model || (modelOptions[0] && modelOptions[0].id), 'task-tile-model-select')}
        <button class="cf-btn primary task-tile-send-btn" style="width:100%;margin-top:8px;">Generate</button>
      </div>
    </div>`).join('');

  const liveTiles = liveTasks.map(t=>{
    const meta = t.meta || {};
    const thumb = t.status==='success' && t.imageUrl
      ? `<img src="${t.imageUrl}">`
      : t.status==='failed'
        ? `<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><circle cx="12" cy="12" r="9"></circle><line x1="9" y1="9" x2="15" y2="15"></line><line x1="15" y1="9" x2="9" y2="15"></line></svg>`
        : `<div class="task-tile-spin"></div>`;
    return `
      <div class="task-tile" data-task-id="${t.taskId}">
        <div class="task-tile-thumb">
          ${thumb}
          <div class="task-tile-status ${t.status}">${t.status}</div>
          <div class="task-tile-trash" title="Remove from list"><svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"></path><path d="M10 11v6"></path><path d="M14 11v6"></path></svg></div>
        </div>
        <div class="task-tile-body">
          <div class="task-tile-scene">${meta.sceneName || 'Scene'}</div>
          <div class="task-tile-shot">${meta.shotName || 'Shot'}</div>
          <div class="task-tile-model">${t.model || ''}</div>
        </div>
      </div>`;
  }).join('');

  grid.innerHTML = draftTiles + liveTiles;
  wireDraftTiles();
  wireLiveTiles();
  updateGenerateSelectedButton();
}

function wireDraftTiles(){
  document.querySelectorAll('.task-tile.draft').forEach(tile=>{
    const draftId = tile.dataset.draftId;
    const draft = (state.taskQueue||[]).find(t=> t.id===draftId);
    if(!draft) return;
    tile.querySelector('.task-tile-model-select').onchange = (e)=>{
      draft.model = e.target.value;
      if(typeof saveProjectSoon==='function') saveProjectSoon();
    };
    tile.querySelector('.task-tile-select').onchange = updateGenerateSelectedButton;
    tile.querySelector('.task-tile-trash').onclick = (e)=>{
      e.stopPropagation();
      state.taskQueue = (state.taskQueue||[]).filter(t=> t.id!==draftId);
      if(typeof saveProjectSoon==='function') saveProjectSoon();
      renderTasksGrid();
      updateTasksBadge();
    };
    tile.querySelector('.task-tile-send-btn').onclick = (e)=>{
      e.stopPropagation();
      sendDraftTask(draftId);
    };
  });
}

function wireLiveTiles(){
  document.querySelectorAll('.task-tile:not(.draft)').forEach(tile=>{
    const taskId = tile.dataset.taskId;
    tile.querySelector('.task-tile-trash').onclick = async (e)=>{
      e.stopPropagation();
      try{ await fetch('/api/tasks/' + encodeURIComponent(taskId), { method:'DELETE' }); } catch(err){}
      liveTasks = liveTasks.filter(t=> t.taskId!==taskId);
      renderTasksGrid();
      updateTasksBadge();
    };
    tile.onclick = ()=>{
      const t = liveTasks.find(x=> x.taskId===taskId);
      if(t && t.status==='success' && t.imageUrl){
        document.getElementById('taskPreviewImg').src = t.imageUrl;
        document.getElementById('taskPreviewModal').classList.remove('hidden');
      }
    };
  });
}

function updateGenerateSelectedButton(){
  const btn = document.getElementById('tasksGenerateSelectedBtn');
  if(!btn) return;
  const count = document.querySelectorAll('.task-tile-select:checked').length;
  btn.disabled = count===0;
  btn.textContent = count ? ('Generate (' + count + ')') : 'Generate';
}

async function sendDraftTask(draftId){
  const draft = (state.taskQueue||[]).find(t=> t.id===draftId);
  if(!draft) return;
  const tile = document.querySelector('.task-tile[data-draft-id="' + draftId + '"]');
  const btn = tile ? tile.querySelector('.task-tile-send-btn') : null;
  if(btn){ btn.disabled = true; btn.textContent = 'Sending…'; }
  try{
    await sendGenerationTask(draft);
    state.taskQueue = (state.taskQueue||[]).filter(t=> t.id!==draftId);
    if(typeof saveProjectSoon==='function') saveProjectSoon();
    await refreshTasks();
  } catch(err){
    if(btn){ btn.disabled = false; btn.textContent = 'Try again'; }
    alert('Could not start generation: ' + err.message);
  }
}

async function generateSelectedDraftTasks(){
  const selectedIds = Array.from(document.querySelectorAll('.task-tile.draft')).filter(tile=>
    tile.querySelector('.task-tile-select').checked
  ).map(tile=> tile.dataset.draftId);
  for(const id of selectedIds){
    await sendDraftTask(id);
  }
}

// Looks up the scene/shot for a draft, builds its prompt, and sends it to the server —
// used both for the per-tile "Generate" button and the batch button.
async function sendGenerationTask(draft){
  const scene = state.scenes.find(s=> s.id===draft.sceneId);
  const shot = scene && scene.shots.find(sh=> sh.id===draft.shotId);
  if(!scene || !shot){
    throw new Error('This shot no longer exists.');
  }
  const prompt = buildShotPrompt(shot, scene);
  const meta = state.projectMeta || { width:1920, height:1080 };
  const res = await fetch('/api/generate-image/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      prompt, width: meta.width, height: meta.height, model: draft.model,
      meta: { projectId: currentProjectId, sceneId: scene.id, sceneName: scene.name, shotId: shot.id, shotName: shot.name },
    }),
  });
  const data = await res.json().catch(()=> null);
  if(!res.ok || !data || !data.taskId){
    throw new Error((data && data.message) || ('Request failed (HTTP ' + res.status + ')'));
  }
  return data.taskId;
}

// The moment a task shows success, drop its image onto the shot it was generated for —
// works whether or not that shot happens to be open right now.
function applyFinishedTasks(list){
  let touchedCurrentView = false;
  list.forEach(t=>{
    if(t.status!=='success' || !t.imageUrl) return;
    if(appliedTaskIds.has(t.taskId)) return;
    const meta = t.meta || {};
    const scene = state.scenes.find(s=> s.id===meta.sceneId);
    const shot = scene && scene.shots.find(sh=> sh.id===meta.shotId);
    if(scene && shot){
      shot.previewImage = t.imageUrl;
      appliedTaskIds.add(t.taskId);
      if(focus.sceneId===scene.id && focus.shotId===shot.id) touchedCurrentView = true;
    } else {
      appliedTaskIds.add(t.taskId); // shot/scene no longer exists — nothing to apply, stop retrying
    }
  });
  if(appliedTaskIds.size){
    renderTimelineScenes();
    if(touchedCurrentView) refreshMainPreview();
    if(typeof saveProjectSoon==='function') saveProjectSoon();
  }
}
