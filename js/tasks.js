// ---------- WORK / TASKS bottom page tabs (DaVinci-Resolve style render queue) ----------
let tasksRefreshTimer = null;
let liveTasks = []; // last fetched snapshot from the server
let modelOptions = []; // [{id, label, costUsd, supportsReferenceImage}]
let appliedTaskIds = new Set(); // avoid re-applying the same finished result repeatedly
// Selection lives here, not in the DOM — renderTasksGrid() rebuilds the tiles every few
// seconds (autosave-driven and its own refresh loop both touch this), and DOM-held state
// like a checkbox's checked attribute gets wiped out on every rebuild. Keeping it in a
// plain Set means selection survives re-renders untouched.
let selectedDraftIds = new Set();
let tasksSortMode = 'status'; // 'status' | 'newest'

function wirePageTabs(){
  document.querySelectorAll('.page-tab').forEach(tab=>{
    tab.onclick = ()=> showPage(tab.dataset.page);
  });
  const modal = document.getElementById('taskPreviewModal');
  const closePreviewModal = ()=>{
    modal.classList.add('hidden');
    const videoEl = document.getElementById('taskPreviewVideo');
    if(videoEl) videoEl.pause();
  };
  document.getElementById('taskPreviewClose').onclick = closePreviewModal;
  modal.onclick = (e)=>{ if(e.target===modal) closePreviewModal(); };

  document.getElementById('tasksGenerateSelectedBtn').onclick = generateSelectedDraftTasks;
  document.getElementById('tasksSortSelect').onchange = (e)=>{
    tasksSortMode = e.target.value;
    renderTasksGrid();
  };
}

function showPage(page){
  document.querySelectorAll('.page-tab').forEach(t=> t.classList.toggle('active', t.dataset.page===page));
  document.getElementById('scriptPage').classList.toggle('hidden', page!=='script');
  if(page==='script' && typeof renderScriptPageIfNeeded==='function') renderScriptPageIfNeeded();
  document.getElementById('workPage').classList.toggle('hidden', page!=='work');
  document.getElementById('storyboardPage').classList.toggle('hidden', page!=='storyboard');
  if(page==='storyboard' && typeof renderStoryboardGrid==='function') renderStoryboardGrid();
  document.getElementById('tasksPage').classList.toggle('hidden', page!=='tasks');
  document.getElementById('archivePage').classList.toggle('hidden', page!=='archive');
  document.getElementById('moviePage').classList.toggle('hidden', page!=='movie');
  if(page==='archive') renderArchiveGrid();
  if(page==='movie' && typeof renderMovieGrid==='function') renderMovieGrid();
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
// so they land on their target even if the user never opens the Tasks tab at all.
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
function modelById(id){ return modelOptions.find(m=> m.id===id) || modelOptions[0] || null; }
function formatCost(usd){ return usd ? ('$' + usd.toFixed(usd < 0.01 ? 4 : 2).replace(/0+$/,'').replace(/\.$/,'')) : ''; }

async function refreshTasks(){
  if(!currentProjectId) return;
  try{
    const res = await fetch('/api/tasks?projectId=' + encodeURIComponent(currentProjectId));
    const data = await res.json();
    liveTasks = (data && data.tasks) || [];
  } catch(err){
    liveTasks = [];
  }
  // drop selections for drafts that no longer exist (sent or deleted elsewhere)
  const draftIds = new Set((state.taskQueue||[]).map(t=> t.id));
  selectedDraftIds.forEach(id=>{ if(!draftIds.has(id)) selectedDraftIds.delete(id); });

  renderTasksGrid();
  await applyFinishedTasks(liveTasks);
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

function modelSelectHtml(selectedId, extraClass, onlyReferenceCapable){
  const pool = onlyReferenceCapable ? modelOptions.filter(m=> m.supportsReferenceImage) : modelOptions;
  const opts = pool.map(m=> `<option value="${m.id}" ${m.id===selectedId?'selected':''}>${m.label}${m.supportsReferenceImage?' (ref)':''}${m.costUsd?' — '+formatCost(m.costUsd):''}</option>`).join('');
  return `<select class="${extraClass||''}">${opts || '<option>No compatible model available</option>'}</select>`;
}

// Draft display labels — shots show "Scene / Shot", asset drafts show "Kind / Name".
function draftTitleLines(t){
  if(t.kind==='shot') return [t.sceneName || 'Scene', t.shotName || 'Shot'];
  if(t.kind==='archive-derive') return ['New idea', t.assetName || ''];
  const kindLabel = t.kind==='looks' ? 'Look' : t.kind==='locations' ? 'Location' : t.kind==='props' ? 'Prop' : 'Asset';
  return [kindLabel, t.assetName || ''];
}

// Status priority for the default sort — drafts need a decision, pending is in progress,
// failed needs attention, success is already settled.
const STATUS_ORDER = { draft:0, pending:1, failed:2, success:3 };

function getSortedEntries(){
  const drafts = (state.taskQueue||[]).map(t=> ({ type:'draft', status:'draft', createdAt:t.createdAt, data:t }));
  const live = liveTasks.map(t=> ({ type:'live', status:t.status, createdAt:t.createdAt, data:t }));
  const all = drafts.concat(live);
  if(tasksSortMode==='newest'){
    all.sort((a,b)=> b.createdAt - a.createdAt);
  } else {
    all.sort((a,b)=>{
      const diff = (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9);
      return diff!==0 ? diff : b.createdAt - a.createdAt;
    });
  }
  return all;
}

function assetHasPhoto(t){
  if(t.kind==='shot'){
    const scene = state.scenes.find(s=> s.id===t.sceneId);
    const shot = scene && scene.shots.find(sh=> sh.id===t.shotId);
    if(!scene || !shot) return false;
    const sceneHasCardedCharacter = (scene.characters||[]).some(entry=>{
      const bandCat = state.categories.find(c=> c.key==='band');
      const character = bandCat && bandCat.items.find(c=> c.id===entry.characterId);
      return character && typeof characterHasCard==='function' && characterHasCard(character);
    });
    if(sceneHasCardedCharacter) return true;
    if(!shot.description) return false;
    const mentions = Array.from(new Set((shot.description.match(/@([^\s@]+)/g) || []).map(m=> m.slice(1))));
    return mentions.some(name=>{
      const character = typeof findCharacterByTagName==='function' ? findCharacterByTagName(name) : null;
      return character && typeof characterHasCard==='function' && characterHasCard(character);
    });
  }
  const cat = state.categories.find(c=> c.key===t.kind);
  const item = cat && cat.items.find(x=> x.id===t.assetId);
  const field = t.kind==='looks' ? 'previewImage' : 'photo';
  return !!(item && item[field]);
}

function renderTasksGrid(){
  const grid = document.getElementById('tasksGrid');
  if(!grid) return;
  const entries = getSortedEntries();
  if(entries.length===0){
    grid.innerHTML = `<div class="tasks-empty">No generation tasks yet. Use "Add to Tasks" on a shot, look, location, or prop to queue one — pick a model here and hit Generate whenever you're ready.</div>`;
    updateGenerateSelectedButton();
    return;
  }

  grid.innerHTML = entries.map(entry=>{
    if(entry.type==='draft'){
      const t = entry.data;
      const selected = selectedDraftIds.has(t.id);
      const [line1, line2] = draftTitleLines(t);
      const model = modelById(t.model);
      const hasPhoto = assetHasPhoto(t);
      const willUseRef = hasPhoto && model && model.supportsReferenceImage;
      const refSourceLabel = t.kind==='shot' ? 'the scene\'s assigned character (and look)' : 'the uploaded photo';
      const refHint = hasPhoto
        ? (willUseRef
            ? `<div class="gen-hint" style="margin-top:6px;color:#5fae7a;">Will use ${refSourceLabel} as a reference.</div>`
            : `<div class="gen-hint" style="margin-top:6px;">Has ${refSourceLabel} available, but this model won't use it — pick a model marked (ref) to use it.</div>`)
        : '';
      const noRefModelAvailable = t.kind==='archive-derive' && modelOptions.filter(m=> m.supportsReferenceImage).length===0;
      return `
        <div class="task-tile draft${selected ? ' selected' : ''}" data-draft-id="${t.id}">
          <div class="task-tile-thumb" title="Click to select for batch generate">
            <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"></rect><circle cx="9" cy="11" r="2"></circle><path d="M21 16l-5-4-4 3-3-2-6 5"></path></svg>
            <div class="task-tile-status draft">draft</div>
            ${selected ? '<div class="task-tile-selected-badge"><svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg></div>' : ''}
            <div class="task-tile-trash" title="Remove from queue"><svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"></path><path d="M10 11v6"></path><path d="M14 11v6"></path></svg></div>
          </div>
          <div class="task-tile-body">
            <div class="task-tile-scene">${line1}</div>
            <div class="task-tile-shot">${line2}</div>
            ${modelSelectHtml(t.model || (modelOptions[0] && modelOptions[0].id), 'task-tile-model-select', t.kind==='archive-derive')}
            ${refHint}
            ${noRefModelAvailable ? '<div class="gen-hint" style="margin-top:6px;color:var(--danger);">No connected model supports reference images yet — can\'t generate this.</div>' : ''}
            <button class="cf-btn primary task-tile-send-btn" style="width:100%;margin-top:8px;" ${noRefModelAvailable?'disabled':''}>Generate${model && model.costUsd ? ' — ' + formatCost(model.costUsd) : ''}</button>
          </div>
        </div>`;
    } else {
      const t = entry.data;
      const meta = t.meta || {};
      const thumb = t.status==='success' && t.imageUrl
        ? (t.isVideo ? `<video src="${t.imageUrl}" muted loop autoplay playsinline></video>` : `<img src="${t.imageUrl}">`)
        : t.status==='failed'
          ? `<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><circle cx="12" cy="12" r="9"></circle><line x1="9" y1="9" x2="15" y2="15"></line><line x1="15" y1="9" x2="9" y2="15"></line></svg>`
          : `<div class="task-tile-spin"></div>`;
      const line1 = meta.kind==='ai-generator' ? 'AI Generator' : meta.kind==='movie' ? (meta.sceneName || 'Scene') : meta.kind==='shot' || !meta.kind ? (meta.sceneName || 'Scene') : meta.kind==='character-card' ? 'Character card' : meta.kind==='locations-card' ? 'Location card' : meta.kind==='props-card' ? 'Prop card' : (meta.kind==='looks'?'Look':meta.kind==='locations'?'Location':meta.kind==='props'?'Prop':'Asset');
      const line2 = meta.kind==='ai-generator' ? ((t.prompt||'').slice(0,40)) : meta.kind==='movie' ? ((meta.shotName || 'Shot') + ' (animate)') : meta.kind==='shot' || !meta.kind ? (meta.shotName || 'Shot') : meta.kind==='character-card' ? ((meta.characterName||'') + ' — ' + (meta.outputKey||'')) : (meta.kind==='locations-card' || meta.kind==='props-card') ? (meta.assetName || '') : (meta.assetName || '');
      const canRegen = t.status==='success' || t.status==='failed';
      return `
        <div class="task-tile" data-task-id="${t.taskId}">
          <div class="task-tile-thumb">
            ${thumb}
            <div class="task-tile-status ${t.status}">${t.status}</div>
            <div class="task-tile-trash" title="Remove from list"><svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"></path><path d="M10 11v6"></path><path d="M14 11v6"></path></svg></div>
          </div>
          <div class="task-tile-body">
            <div class="task-tile-scene">${line1}</div>
            <div class="task-tile-shot">${line2}</div>
            <div class="task-tile-model">${t.model || ''}</div>
            ${canRegen ? `<button class="cf-btn task-tile-regen-btn" style="width:100%;margin-top:8px;">Regenerate</button>` : ''}
          </div>
        </div>`;
    }
  }).join('');

  wireDraftTiles();
  wireLiveTiles();
  updateGenerateSelectedButton();
}

function wireDraftTiles(){
  document.querySelectorAll('#tasksGrid .task-tile.draft').forEach(tile=>{
    const draftId = tile.dataset.draftId;
    const draft = (state.taskQueue||[]).find(t=> t.id===draftId);
    if(!draft) return;
    tile.querySelector('.task-tile-model-select').onchange = (e)=>{
      draft.model = e.target.value;
      if(typeof saveProjectSoon==='function') saveProjectSoon();
      renderTasksGrid();
    };
    tile.querySelector('.task-tile-thumb').onclick = (e)=>{
      if(e.target.closest('select')) return;
      if(selectedDraftIds.has(draftId)) selectedDraftIds.delete(draftId);
      else selectedDraftIds.add(draftId);
      renderTasksGrid();
    };
    tile.querySelector('.task-tile-trash').onclick = (e)=>{
      e.stopPropagation();
      state.taskQueue = (state.taskQueue||[]).filter(t=> t.id!==draftId);
      selectedDraftIds.delete(draftId);
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
  document.querySelectorAll('#tasksGrid .task-tile:not(.draft)').forEach(tile=>{
    const taskId = tile.dataset.taskId;
    tile.querySelector('.task-tile-trash').onclick = async (e)=>{
      e.stopPropagation();
      try{ await fetch('/api/tasks/' + encodeURIComponent(taskId), { method:'DELETE' }); } catch(err){}
      liveTasks = liveTasks.filter(t=> t.taskId!==taskId);
      renderTasksGrid();
      updateTasksBadge();
    };
    const regenBtn = tile.querySelector('.task-tile-regen-btn');
    if(regenBtn){
      regenBtn.onclick = (e)=>{
        e.stopPropagation();
        const t = liveTasks.find(x=> x.taskId===taskId);
        if(t) requeueFromFinishedTask(t);
      };
    }
    tile.onclick = ()=>{
      const t = liveTasks.find(x=> x.taskId===taskId);
      if(t && t.status==='success' && t.imageUrl){
        const imgEl = document.getElementById('taskPreviewImg');
        const videoEl = document.getElementById('taskPreviewVideo');
        if(t.isVideo){
          videoEl.src = t.imageUrl;
          videoEl.classList.remove('hidden');
          imgEl.classList.add('hidden');
          imgEl.src = '';
        } else {
          imgEl.src = t.imageUrl;
          imgEl.classList.remove('hidden');
          videoEl.classList.add('hidden');
          videoEl.pause();
          videoEl.src = '';
        }
        document.getElementById('taskPreviewModal').classList.remove('hidden');
      }
    };
  });
}

// "Regenerate" doesn't instantly re-charge — it puts a new draft back in the queue with
// the same source and model already selected, so a disappointing result costs a review
// step before spending again, same as any other draft.
function requeueFromFinishedTask(t){
  const meta = t.meta || {};
  if(!meta.kind || meta.kind==='shot'){
    const scene = state.scenes.find(s=> s.id===meta.sceneId);
    const shot = scene && scene.shots.find(sh=> sh.id===meta.shotId);
    if(!scene || !shot){ alert('That shot no longer exists.'); return; }
    state.taskQueue = state.taskQueue || [];
    state.taskQueue.push({
      id: 'dt' + (draftTaskSeq++), kind:'shot',
      sceneId: scene.id, shotId: shot.id, sceneName: scene.name, shotName: shot.name,
      model: t.model, createdAt: Date.now(),
    });
  } else {
    const cat = state.categories.find(c=> c.key===meta.kind);
    const item = cat && cat.items.find(x=> x.id===meta.assetId);
    if(!item){ alert('That ' + meta.kind.slice(0,-1) + ' no longer exists.'); return; }
    state.taskQueue = state.taskQueue || [];
    state.taskQueue.push({
      id: 'dt' + (draftTaskSeq++), kind: meta.kind,
      assetId: item.id, assetName: item.name,
      model: t.model, createdAt: Date.now(),
    });
  }
  if(typeof saveProjectSoon==='function') saveProjectSoon();
  renderTasksGrid();
  updateTasksBadge();
}

// Shows how many are selected AND the running total cost of everything currently checked —
// mirrors a render queue where you stack up jobs, see the bill, then commit.
function updateGenerateSelectedButton(){
  const btn = document.getElementById('tasksGenerateSelectedBtn');
  if(!btn) return;
  const selected = (state.taskQueue||[]).filter(t=> selectedDraftIds.has(t.id));
  const count = selected.length;
  const total = selected.reduce((sum, t)=>{
    const m = modelById(t.model);
    return sum + (m && m.costUsd ? m.costUsd : 0);
  }, 0);
  btn.disabled = count===0;
  btn.textContent = count ? ('Generate (' + count + ')' + (total ? ' — ' + formatCost(total) : '')) : 'Generate';
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
    selectedDraftIds.delete(draftId);
    if(typeof saveProjectSoon==='function') saveProjectSoon();
    await refreshTasks();
  } catch(err){
    if(btn){ btn.disabled = false; btn.textContent = 'Try again'; }
    alert('Could not start generation: ' + err.message);
  }
}

async function generateSelectedDraftTasks(){
  const ids = Array.from(selectedDraftIds);
  for(const id of ids){
    await sendDraftTask(id);
  }
}

// Builds the request for whichever kind of draft this is (shot, or a Look/Location/Prop
// asset) and sends it to the server — used by both the per-tile Generate button and the
// batch button.
async function sendGenerationTask(draft){
  const meta = state.projectMeta || { width:1920, height:1080 };
  let prompt, taskMeta, referenceImageUrl;

  if(draft.kind==='shot'){
    const scene = state.scenes.find(s=> s.id===draft.sceneId);
    const shot = scene && scene.shots.find(sh=> sh.id===draft.shotId);
    if(!scene || !shot) throw new Error('This shot no longer exists.');
    prompt = buildShotPrompt(shot, scene);

    const allRefs = [];
    if(typeof gatherSceneCharacterReferences==='function' && typeof resolveTagsInPrompt==='function'){
      // Scene-assigned characters (and, when set, their Look) are the reliable, "set once
      // in the scene" source — every shot in the scene gets these automatically, same as
      // the text side already worked. Manual @tags in the shot's own description (e.g. a
      // cameo not in the scene list) fill in anything beyond that, without duplicating a
      // reference for a character already covered by the scene assignment.
      const sceneRefs = await gatherSceneCharacterReferences(scene);
      for(const localUrl of sceneRefs.localUrls){
        try{
          const url = await uploadReferencePhoto(localUrl);
          if(url) allRefs.push(url);
        } catch(err){
          console.warn('[tasks] could not upload a scene character/look reference:', err);
        }
      }
      const tagResolved = await resolveTagsInPrompt(prompt, sceneRefs.seenCharacterIds);
      prompt = tagResolved.cleanText;
      allRefs.push(...tagResolved.referenceImageUrls);
    }
    if(typeof gatherSceneLocationPropReferences==='function'){
      // Same "set once in the scene, every shot inherits it" pattern, now for the
      // location and any assigned props — uses the full Object Card if one's been built,
      // otherwise falls back to whatever simple photo the location/prop already has.
      const objRefs = await gatherSceneLocationPropReferences(scene);
      for(const localUrl of objRefs){
        try{
          const url = await uploadReferencePhoto(localUrl);
          if(url) allRefs.push(url);
        } catch(err){
          console.warn('[tasks] could not upload a scene location/prop reference:', err);
        }
      }
    }
    if(allRefs.length) referenceImageUrl = allRefs.slice(0, 8); // Nano Banana Pro's own reference-image limit
    taskMeta = { projectId: currentProjectId, kind:'shot', sceneId: scene.id, sceneName: scene.name, shotId: shot.id, shotName: shot.name };
  } else if(draft.kind==='archive-derive'){
    const entry = (state.archive||[]).find(a=> a.id===draft.archiveEntryId);
    if(!entry || !entry.photo) throw new Error('The original generation this was based on is no longer available.');
    prompt = draft.promptOverride || '';
    taskMeta = { projectId: currentProjectId, kind: 'archive-derive', assetName: draft.assetName };
    referenceImageUrl = await uploadReferencePhoto(entry.photo);
  } else {
    const cat = state.categories.find(c=> c.key===draft.kind);
    const item = cat && cat.items.find(x=> x.id===draft.assetId);
    if(!item) throw new Error('This ' + draft.kind.slice(0,-1) + ' no longer exists.');
    prompt = buildAssetGenPrompt(draft.kind, item);
    taskMeta = { projectId: currentProjectId, kind: draft.kind, assetId: item.id, assetName: item.name };

    // Reference photo — a real photo of the actual location/prop, uploaded so the paid
    // model can use it as a basis instead of guessing purely from text.
    const model = modelById(draft.model);
    const photoField = draft.kind==='looks' ? 'previewImage' : 'photo';
    const livePhoto = item[photoField];
    if(model && model.supportsReferenceImage && livePhoto){
      referenceImageUrl = await uploadReferencePhoto(livePhoto);
    }
  }

  const res = await fetch('/api/generate-image/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, width: meta.width, height: meta.height, model: draft.model, meta: taskMeta, referenceImageUrl }),
  });
  const data = await res.json().catch(()=> null);
  if(!res.ok || !data || !data.taskId){
    throw new Error((data && data.message) || ('Request failed (HTTP ' + res.status + ')'));
  }
  return data.taskId;
}

// The reference photo lives as a local blob:/data: URL — KIE needs a fetchable link, so
// hand it to our own server first (see /api/upload-reference-image), which hands back a
// short-lived public URL.
async function uploadReferencePhoto(photoUrl){
  let dataUrl = photoUrl;
  if(photoUrl.indexOf('blob:')===0){
    const blob = await (await fetch(photoUrl)).blob();
    dataUrl = await new Promise((resolve, reject)=>{
      const fr = new FileReader();
      fr.onload = ()=> resolve(fr.result);
      fr.onerror = reject;
      fr.readAsDataURL(blob);
    });
  }
  const res = await fetch('/api/upload-reference-image', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ dataUrl }),
  });
  const data = await res.json().catch(()=> null);
  if(!res.ok || !data || !data.url){
    console.warn('[tasks] could not upload reference photo, generating without it:', data && data.message);
    return undefined;
  }
  return data.url;
}

// The moment a task shows success, drop its image onto whatever it was generated for
// (a shot, or a Look/Location/Prop) — works whether or not that item happens to be open.
async function applyFinishedTasks(list){
  let touchedCurrentView = false;
  let appliedAny = false;
  for(const t of list){
    if(t.status!=='success' || !t.imageUrl) continue;
    if(appliedTaskIds.has(t.taskId)) continue;
    appliedTaskIds.add(t.taskId); // mark handled up front — archiving happens exactly once regardless of what follows

    if(typeof archiveGeneration==='function') await archiveGeneration(t);
    appliedAny = true;

    const meta = t.meta || {};
    if(meta.kind==='archive-derive'){
      continue; // no live target — lands in the Archive only, applied to a shot manually via the down-arrow
    }
    if(meta.kind==='character-card'){
      const bandCat = state.categories.find(c=> c.key==='band');
      const character = bandCat && bandCat.items.find(c=> c.id===meta.characterId);
      if(character && meta.outputKey){
        if(typeof applyCharacterCardImage==='function') await applyCharacterCardImage(character, meta.outputKey, t.imageUrl);
      }
      if(typeof refreshCardBuilderIfOpen==='function') refreshCardBuilderIfOpen(meta.characterId);
      continue;
    }
    if(meta.kind==='locations-card' || meta.kind==='props-card'){
      const objCatKey = meta.kind==='locations-card' ? 'locations' : 'props';
      const cat = state.categories.find(c=> c.key===objCatKey);
      const item = cat && cat.items.find(x=> x.id===meta.assetId);
      if(item){
        if(typeof applyObjectCardSheetImage==='function') await applyObjectCardSheetImage(objCatKey, item, t.imageUrl);
      }
      if(typeof refreshObjectCardBuilderIfOpen==='function') refreshObjectCardBuilderIfOpen(objCatKey, meta.assetId);
      continue;
    }
    if(meta.kind==='movie'){
      const scene = state.scenes.find(s=> s.id===meta.sceneId);
      const shot = scene && scene.shots.find(sh=> sh.id===meta.shotId);
      if(shot){
        if(typeof persistShotVideo==='function') await persistShotVideo(shot, t.imageUrl);
        else shot.videoUrl = t.imageUrl;
        // The clip's slot on the timeline can never exceed the actual generated footage —
        // same rule DaVinci and every other NLE enforces. Clamp immediately, not just on
        // the next manual trim, so there's never a moment where the shot claims more
        // duration than the video actually has.
        shot.duration = MOVIE_CLIP_DURATION_SEC;
        shot.trimInSec = 0;
        if(focus.sceneId===meta.sceneId && focus.shotId===meta.shotId) touchedCurrentView = true;
      }
      if(typeof renderMovieGrid==='function' && !document.getElementById('moviePage').classList.contains('hidden')) renderMovieGrid();
      renderTimelineScenes();
      continue;
    }
    if(!meta.kind || meta.kind==='shot'){
      const scene = state.scenes.find(s=> s.id===meta.sceneId);
      const shot = scene && scene.shots.find(sh=> sh.id===meta.shotId);
      if(scene && shot){
        if(typeof persistShotPreviewImage==='function') await persistShotPreviewImage(shot, t.imageUrl);
        else shot.previewImage = t.imageUrl;
        if(focus.sceneId===scene.id && focus.shotId===shot.id) touchedCurrentView = true;
      }
    } else {
      const cat = state.categories.find(c=> c.key===meta.kind);
      const item = cat && cat.items.find(x=> x.id===meta.assetId);
      if(item){
        const field = meta.kind==='looks' ? 'previewImage' : 'photo';
        if(typeof persistGeneratedAssetImage==='function') await persistGeneratedAssetImage(item, meta.kind, field, t.imageUrl);
        else item[field] = t.imageUrl;
      }
    }
  }
  if(appliedAny){
    renderAssets();
    renderTimelineScenes();
    if(touchedCurrentView) refreshMainPreview();
    if(typeof renderArchiveGrid==='function') renderArchiveGrid();
    if(typeof saveProjectSoon==='function') saveProjectSoon();
  }
}

// Every successful generation gets a permanent record here — even after the shot/asset it
// was made for is deleted, or the task itself is removed from the Tasks list. Nothing ever
// removes an entry once it's archived.
async function archiveGeneration(t){
  state.archive = state.archive || [];
  // The runtime "already handled" Set resets on every page reload, but a task can still be
  // in flight (video generation especially can take minutes) across one — so the real guard
  // has to be persistent: has this exact provider task already produced an archive entry?
  if(state.archive.some(e=> e.sourceTaskId===t.taskId)) return;
  const meta = t.meta || {};
  const kind = meta.kind || 'shot';
  const sourceLabel = kind==='shot'
    ? ((meta.sceneName || 'Scene') + ' / ' + (meta.shotName || 'Shot'))
    : kind==='ai-generator'
      ? ('AI Generator / ' + (t.prompt||'').slice(0,40))
      : kind==='movie'
      ? ((meta.sceneName || 'Scene') + ' / ' + (meta.shotName || 'Shot') + ' (animated)')
      : kind==='archive-derive'
        ? 'New idea from archive'
        : kind==='character-card'
          ? ('Character card / ' + (meta.characterName || '') + ' — ' + (meta.outputKey || ''))
          : kind==='locations-card'
            ? ('Location card / ' + (meta.assetName || ''))
            : kind==='props-card'
              ? ('Prop card / ' + (meta.assetName || ''))
              : ((kind==='looks'?'Look':kind==='locations'?'Location':kind==='props'?'Prop':'Asset') + ' / ' + (meta.assetName || ''));
  const entry = {
    id: 'arc' + (archiveSeq++), sourceTaskId: t.taskId,
    kind, sourceLabel, isVideo: !!t.isVideo, duration: t.duration || null,
    model: t.model || '', prompt: t.prompt || '',
    photo: null, createdAt: Date.now(),
  };
  state.archive = state.archive || [];
  state.archive.push(entry);
  if(typeof persistGeneratedAssetImage==='function') await persistGeneratedAssetImage(entry, 'archive', 'photo', t.imageUrl);
  else entry.photo = t.imageUrl;
  if(typeof saveProjectSoon==='function') saveProjectSoon();
}

// A photo added straight from disk, not generated — same archive entry shape as a
// generation result (so it works everywhere a generated entry does: fullscreen view, "New
// idea", insert-as-shot), just with no model/prompt since nothing was actually generated.
async function archiveUploadedImage(dataUrl, label){
  state.archive = state.archive || [];
  const entry = {
    id: 'arc' + (archiveSeq++),
    kind: 'upload', sourceLabel: 'Uploaded — ' + (label || 'from disk'),
    model: '', prompt: '',
    photo: null, createdAt: Date.now(),
  };
  state.archive.push(entry);
  if(typeof persistGeneratedAssetImage==='function') await persistGeneratedAssetImage(entry, 'archive', 'photo', dataUrl);
  else entry.photo = dataUrl;
  if(typeof saveProjectSoon==='function') saveProjectSoon();
  return entry;
}

// ---------- AI Generator (Tools menu) — a standalone prompt+model generator, not tied to
// any asset. Sends straight to the shared generation pipeline, same as everything else, so
// it shows up live in TASKS and lands in ARCHIVE automatically once it succeeds. ----------
function showAiGeneratorModal(){
  const modal = document.getElementById('aiGeneratorModal');
  const select = document.getElementById('aiGenModelSelect');
  select.innerHTML = (modelOptions||[]).map(m=> `<option value="${m.id}">${m.label} — $${m.costUsd.toFixed(2)}</option>`).join('');
  document.getElementById('aiGenHint').textContent = (modelOptions && modelOptions.length) ? '' : 'No connected model available yet.';
  modal.classList.remove('hidden');
}
function wireAiGeneratorModal(){
  const modal = document.getElementById('aiGeneratorModal');
  const close = ()=> modal.classList.add('hidden');
  document.getElementById('aiGenCloseBtn').onclick = close;
  document.getElementById('aiGenCancelBtn').onclick = close;
  modal.addEventListener('click', (e)=>{ if(e.target===modal) close(); });
  document.getElementById('aiGenSendBtn').onclick = sendAiGeneratorRequest;
}
async function sendAiGeneratorRequest(){
  const promptEl = document.getElementById('aiGenPromptInput');
  const prompt = promptEl.value.trim();
  if(!prompt){ alert('Write a prompt first.'); return; }
  const modelId = document.getElementById('aiGenModelSelect').value;
  if(!modelId){ alert('No model available.'); return; }
  const btn = document.getElementById('aiGenSendBtn');
  btn.disabled = true; btn.textContent = 'Sending…';
  try{
    const meta = state.projectMeta || { width:1920, height:1080 };
    const res = await fetch('/api/generate-image/start', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt, width: meta.width, height: meta.height, model: modelId,
        meta: { projectId: currentProjectId, kind: 'ai-generator' },
      }),
    });
    const data = await res.json().catch(()=> null);
    if(!res.ok || !data || !data.taskId) throw new Error((data && data.message) || 'Could not start generation.');
    document.getElementById('aiGeneratorModal').classList.add('hidden');
    promptEl.value = '';
    if(typeof refreshTasks==='function') await refreshTasks();
  } catch(err){
    alert('Could not start generation: ' + err.message);
  } finally {
    btn.disabled = false; btn.textContent = 'Generate';
  }
}

// Adds a Look/Location/Prop to the queue — called from each asset form's "Add to Tasks"
// button. Mirrors queueShotGeneration in scenes-preview.js.
function queueAssetGeneration(catKey, item){
  state.taskQueue = state.taskQueue || [];
  state.taskQueue.push({
    id: 'dt' + (draftTaskSeq++),
    kind: catKey, // 'looks' | 'locations' | 'props'
    assetId: item.id, assetName: item.name,
    model: (modelOptions[0] && modelOptions[0].id) || null,
    createdAt: Date.now(),
  });
  if(typeof saveProjectSoon==='function') saveProjectSoon();
  refreshTasks();
}

// Generates a Look/Location/Prop image right on the current screen — same idea as the
// Character Card builder: no draft queue detour, progress shown inline, but it still goes
// through the normal /api/generate-image/start pipeline, so it also shows up live in TASKS
// and gets persisted+archived by the same background watcher as everything else.
async function runInlineAssetGeneration(catKey, item, containerEl){
  const field = catKey==='looks' ? 'previewImage' : 'photo';
  const hasPhoto = !!item[field];
  let model = null;
  if(hasPhoto && typeof pickReferenceCapableModel==='function') model = pickReferenceCapableModel();
  if(!model) model = modelOptions[0] || null;
  if(!model){ containerEl.innerHTML = `<div class="gen-hint" style="color:var(--danger);">No connected model available for generation yet.</div>`; return; }

  containerEl.innerHTML = `<button class="gen-btn" disabled><span class="gen-spin"></span>Generating…</button>`;
  const meta = state.projectMeta || { width:1920, height:1080 };
  try{
    let referenceImageUrl;
    if(hasPhoto && model.supportsReferenceImage){
      referenceImageUrl = await uploadReferencePhoto(item[field]);
    }
    const prompt = buildAssetGenPrompt(catKey, item);
    const res = await fetch('/api/generate-image/start', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt, width: meta.width, height: meta.height, model: model.id, referenceImageUrl,
        meta: { projectId: currentProjectId, kind: catKey, assetId: item.id, assetName: item.name },
      }),
    });
    const data = await res.json().catch(()=> null);
    if(!res.ok || !data || !data.taskId) throw new Error((data && data.message) || 'Could not start generation.');
    const imageUrl = await pollCardSlot(data.taskId);
    // Shown immediately for a responsive feel — the shared background watcher persists it
    // locally and archives it within a few seconds regardless, same as every other
    // generation in this app.
    item[field] = imageUrl;
    if(catKey==='looks') item.approved = false;
    containerEl.innerHTML = `<div class="gen-hint" style="color:#5fae7a;">Generated — also tracked in the TASKS tab.</div>`;
    if(typeof renderAssets==='function') renderAssets();
    if(typeof saveProjectSoon==='function') saveProjectSoon();
  } catch(err){
    containerEl.innerHTML = `<div class="gen-hint" style="color:var(--danger);">Could not generate: ${err.message}</div>
      <button class="cf-btn" id="inlineGenRetryBtn" style="width:100%;margin-top:8px;">Try again</button>`;
    const retryBtn = document.getElementById('inlineGenRetryBtn');
    if(retryBtn) retryBtn.onclick = ()=> runInlineAssetGeneration(catKey, item, containerEl);
  }
}
