// ---------- WORK / TASKS bottom page tabs (DaVinci-Resolve style) ----------
let tasksRefreshTimer = null;
let selectedModelId = null;
let appliedTaskIds = new Set(); // avoid re-applying the same finished result repeatedly

function wirePageTabs(){
  document.querySelectorAll('.page-tab').forEach(tab=>{
    tab.onclick = ()=> showPage(tab.dataset.page);
  });
  const modal = document.getElementById('taskPreviewModal');
  document.getElementById('taskPreviewClose').onclick = ()=> modal.classList.add('hidden');
  modal.onclick = (e)=>{ if(e.target===modal) modal.classList.add('hidden'); };
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
  const select = document.getElementById('taskModelSelect');
  if(!select) return;
  try{
    const res = await fetch('/api/models');
    const data = await res.json();
    const models = (data && data.models) || [];
    select.innerHTML = models.map(m=>`<option value="${m.id}">${m.label}</option>`).join('');
    if(models.length) selectedModelId = models[0].id;
    select.onchange = ()=>{ selectedModelId = select.value; };
  } catch(err){
    select.innerHTML = '<option>Unavailable</option>';
  }
}

async function refreshTasks(){
  if(!currentProjectId) return;
  try{
    const res = await fetch('/api/tasks?projectId=' + encodeURIComponent(currentProjectId));
    const data = await res.json();
    const list = (data && data.tasks) || [];
    renderTasksGrid(list);
    applyFinishedTasks(list);
    updateTasksBadge(list);
  } catch(err){
    // backend not reachable (e.g. no server, plain file:// use) — just leave the tab empty
  }
}

function updateTasksBadge(list){
  const badge = document.getElementById('tasksBadge');
  if(!badge) return;
  const pendingCount = list.filter(t=> t.status==='pending').length;
  badge.style.display = pendingCount ? '' : 'none';
  badge.textContent = String(pendingCount);
}

function renderTasksGrid(list){
  const grid = document.getElementById('tasksGrid');
  if(!grid) return;
  if(list.length===0){
    grid.innerHTML = `<div class="tasks-empty">No generation tasks yet. Use "Generate (real AI)" on a shot to start one — it'll show up here and keep working even while you edit other scenes.</div>`;
    return;
  }
  grid.innerHTML = list.map(t=>{
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
        </div>
        <div class="task-tile-body">
          <div class="task-tile-scene">${meta.sceneName || 'Scene'}</div>
          <div class="task-tile-shot">${meta.shotName || 'Shot'}</div>
          <div class="task-tile-model">${t.model || ''}</div>
        </div>
      </div>`;
  }).join('');

  grid.querySelectorAll('.task-tile').forEach(tile=>{
    tile.onclick = ()=>{
      const t = list.find(x=> x.taskId===tile.dataset.taskId);
      if(t && t.status==='success' && t.imageUrl){
        document.getElementById('taskPreviewImg').src = t.imageUrl;
        document.getElementById('taskPreviewModal').classList.remove('hidden');
      }
    };
  });
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

// Fire-and-forget: creates the task and immediately hands control back — the shot's
// Inspector panel is never blocked waiting, the Tasks tab (and the background watcher)
// take it from here.
async function startPaidGenerationTask(scene, shot){
  const prompt = buildShotPrompt(shot, scene);
  const meta = state.projectMeta || { width:1920, height:1080 };
  try{
    const res = await fetch('/api/generate-image/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt, width: meta.width, height: meta.height, model: selectedModelId,
        meta: { projectId: currentProjectId, sceneId: scene.id, sceneName: scene.name, shotId: shot.id, shotName: shot.name },
      }),
    });
    const data = await res.json().catch(()=> null);
    if(!res.ok || !data || !data.taskId){
      throw new Error((data && data.message) || ('Request failed (HTTP ' + res.status + ')'));
    }
    return data.taskId;
  } catch(err){
    throw err;
  }
}
