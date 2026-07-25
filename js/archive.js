// ---------- ARCHIVE page — permanent record of every successful generation ----------
let archiveOpenEntryId = null; // which archive entry the preview/new-idea modals are currently about

function wireArchivePage(){
  document.getElementById('archivePreviewClose').onclick = ()=> document.getElementById('archivePreviewModal').classList.add('hidden');
  document.getElementById('archivePreviewModal').addEventListener('click', (e)=>{
    if(e.target.id==='archivePreviewModal') document.getElementById('archivePreviewModal').classList.add('hidden');
  });
  document.getElementById('archiveNewIdeaBtn').onclick = openNewIdeaModal;

  document.getElementById('newIdeaClose').onclick = closeNewIdeaModal;
  document.getElementById('newIdeaCancelBtn').onclick = closeNewIdeaModal;
  document.getElementById('newIdeaModal').addEventListener('click', (e)=>{
    if(e.target.id==='newIdeaModal') closeNewIdeaModal();
  });
  document.getElementById('newIdeaSendBtn').onclick = sendNewIdea;
}

function renderArchiveGrid(){
  const grid = document.getElementById('archiveGrid');
  if(!grid) return;
  const entries = (state.archive || []).slice().sort((a,b)=> b.createdAt - a.createdAt);
  if(entries.length===0){
    grid.innerHTML = `<div class="tasks-empty">Nothing generated yet. Successful generations land here permanently, for reuse later.</div>`;
    return;
  }
  grid.innerHTML = entries.map(entry=>{
    const showInsert = entry.kind==='shot' || !entry.kind; // inserting only makes sense for shot-style images
    return `
      <div class="task-tile" data-archive-id="${entry.id}">
        <div class="task-tile-thumb">
          ${entry.photo ? `<img src="${entry.photo}">` : '<div class="task-tile-spin"></div>'}
          ${showInsert ? `<div class="task-tile-insert" title="Insert as a new shot at the playhead"><svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><polyline points="19 12 12 19 5 12"></polyline></svg></div>` : ''}
        </div>
        <div class="task-tile-body">
          <div class="task-tile-scene">${entry.sourceLabel || ''}</div>
          <div class="task-tile-model">${entry.model || ''}</div>
        </div>
      </div>`;
  }).join('');

  grid.querySelectorAll('.task-tile').forEach(tile=>{
    const id = tile.dataset.archiveId;
    const insertBtn = tile.querySelector('.task-tile-insert');
    if(insertBtn){
      insertBtn.onclick = (e)=>{
        e.stopPropagation();
        insertArchiveEntryAtPlayhead(id);
      };
    }
    tile.onclick = ()=> openArchivePreview(id);
  });
}

function openArchivePreview(entryId){
  const entry = (state.archive||[]).find(a=> a.id===entryId);
  if(!entry || !entry.photo) return;
  archiveOpenEntryId = entryId;
  document.getElementById('archivePreviewImg').src = entry.photo;
  document.getElementById('archivePreviewModal').classList.remove('hidden');
}

// "New idea" — take an already-generated image as a reference and ask for a variation
// (e.g. a wide shot already exists, now generate a close-up of the same character) without
// creating a brand new shot to hold the request.
async function openNewIdeaModal(){
  const entry = (state.archive||[]).find(a=> a.id===archiveOpenEntryId);
  if(!entry) return;
  document.getElementById('archivePreviewModal').classList.add('hidden');
  document.getElementById('newIdeaRefImg').src = entry.photo;
  document.getElementById('newIdeaPromptInput').value = '';

  const select = document.getElementById('newIdeaModelSelect');
  const refModels = modelOptions.filter(m=> m.supportsReferenceImage);
  const hint = document.getElementById('newIdeaModelHint');
  if(refModels.length===0){
    select.innerHTML = `<option>No reference-capable model available</option>`;
    select.disabled = true;
    hint.textContent = 'None of the connected models currently support generating from a reference image.';
  } else {
    select.disabled = false;
    select.innerHTML = refModels.map(m=> `<option value="${m.id}">${m.label}${m.costUsd?' — '+formatCost(m.costUsd):''}</option>`).join('');
    hint.textContent = 'This always uses the image above as a reference, so only reference-capable models are offered.';
  }

  document.getElementById('newIdeaModal').classList.remove('hidden');
  wireAiAssistButton('newIdeaAssistBtn', 'newIdeaPromptInput',
    'Rewrite this rough idea into a vivid, specific instruction for an AI image editor that will use the earlier image as a reference — describe only what should change (e.g. framing, angle, action). Reply with only the rewritten instruction, nothing else.',
    ()=>{});
}

function closeNewIdeaModal(){
  document.getElementById('newIdeaModal').classList.add('hidden');
}

async function sendNewIdea(){
  const entry = (state.archive||[]).find(a=> a.id===archiveOpenEntryId);
  const select = document.getElementById('newIdeaModelSelect');
  const prompt = document.getElementById('newIdeaPromptInput').value.trim();
  if(!entry || select.disabled) return;
  if(!prompt){ alert('Describe what should be different first.'); return; }

  state.taskQueue = state.taskQueue || [];
  state.taskQueue.push({
    id: 'dt' + (draftTaskSeq++),
    kind: 'archive-derive',
    archiveEntryId: entry.id,
    assetName: 'New idea from ' + (entry.sourceLabel || 'archive'),
    promptOverride: prompt,
    model: select.value,
    createdAt: Date.now(),
  });
  if(typeof saveProjectSoon==='function') saveProjectSoon();
  closeNewIdeaModal();
  showPage('tasks');
}

// Drops an archived image straight onto the timeline as a brand-new shot, inserted right
// where the playhead currently sits in its scene.
async function insertArchiveEntryAtPlayhead(entryId){
  const entry = (state.archive||[]).find(a=> a.id===entryId);
  if(!entry || !entry.photo) return;
  if(!focus.sceneId){
    alert('Select a scene on the timeline first — the new shot needs somewhere to go.');
    return;
  }
  const scene = state.scenes.find(s=> s.id===focus.sceneId);
  if(!scene){ alert('That scene no longer exists.'); return; }
  const currentIdx = focus.shotId ? scene.shots.findIndex(sh=> sh.id===focus.shotId) : -1;
  const insertIdx = currentIdx>=0 ? currentIdx+1 : scene.shots.length;

  showPage('work');
  addShotAt(scene.id, insertIdx);
  const newShot = scene.shots.find(sh=> sh.id===focus.shotId);
  if(newShot){
    await persistShotPreviewImage(newShot, entry.photo);
    renderTimelineScenes();
    refreshMainPreview();
    if(typeof saveProjectSoon==='function') saveProjectSoon();
  }
}
