// ---------- Home screen (project list) ----------
async function showHomeScreen(){
  document.getElementById('homeScreen').classList.remove('hidden');
  await renderProjectList();
}
function hideHomeScreen(){
  document.getElementById('homeScreen').classList.add('hidden');
}

function orientIconHtml(format){
  return format==='vertical'
    ? '<div class="proj-orient-icon vertical"></div>'
    : '<div class="proj-orient-icon horizontal"></div>';
}

async function renderProjectList(){
  const list = document.getElementById('homeProjectList');
  if(!list) return;
  const projects = await listProjects();
  if(projects.length===0){
    list.innerHTML = `<div class="home-empty">No projects yet — create your first one to get started.</div>`;
    return;
  }
  list.innerHTML = projects.map(p=>{
    const dims = p.width + ' × ' + p.height;
    const dateStr = p.updatedAt ? new Date(p.updatedAt).toLocaleDateString() : '';
    const storageLabel = p.storage==='disk' ? ('Disk folder “' + (p.folderName||'') + '”') : 'Browser storage';
    return `
      <div class="proj-card" data-id="${p.id}">
        <div class="proj-card-thumb">${orientIconHtml(p.format)}</div>
        <div class="proj-card-body">
          <div class="proj-card-name">${p.name}</div>
          <div class="proj-card-meta">${dims} · ${p.fps} fps · ${storageLabel}</div>
          <div class="proj-card-date">${dateStr ? 'Edited ' + dateStr : ''}</div>
        </div>
        <div class="proj-card-actions">
          <span class="proj-card-btn" data-action="rename" title="Rename">${pencilSvg(13)}</span>
          <span class="proj-card-btn" data-action="delete" title="Delete">${trashSvg(13)}</span>
        </div>
      </div>`;
  }).join('');

  list.querySelectorAll('.proj-card').forEach(card=>{
    const id = card.dataset.id;
    card.addEventListener('click', (e)=>{
      if(e.target.closest('.proj-card-btn')) return;
      openProjectFromHome(id);
    });
    card.querySelector('[data-action="rename"]').onclick = async (e)=>{
      e.stopPropagation();
      const current = card.querySelector('.proj-card-name').textContent;
      const name = prompt('Rename project:', current);
      if(name!==null){ await renameProject(id, name); renderProjectList(); }
    };
    card.querySelector('[data-action="delete"]').onclick = async (e)=>{
      e.stopPropagation();
      const current = card.querySelector('.proj-card-name').textContent;
      if(confirm('Delete "' + current + '" permanently? This cannot be undone.\n\n(If it was saved to a disk folder, the files there are left untouched — only the app\'s record of the project is removed.)')){
        if(id === currentProjectId) currentProjectId = null;
        await deleteProject(id);
        renderProjectList();
      }
    };
  });
}

async function openProjectFromHome(id){
  hideHomeScreen();
  showLoadingScreen();
  logLoadingStep('Opening project…');
  const ok = await openProject(id, true);
  logLoadingStep(ok ? 'Done.' : 'Could not fully restore this project (see above).', ok ? 'ok' : 'error');
  finishLoadingScreen(!ok);
  updateFolderButton();
  updateProjTitleDisplay();
}

function updateProjTitleDisplay(){
  const el = document.querySelector('.proj-title b');
  if(el) el.textContent = state.projectMeta.name;
}

// ---------- New Project dialog ----------
let npState = { orientation:'horizontal', width:1920, height:1080, fps:25, folderHandle:null };
let npReturnToHome = false;

function showNewProjectScreen(fromHome){
  npReturnToHome = !!fromHome;
  npState = { orientation:'horizontal', width:1920, height:1080, fps:25, folderHandle:null };
  document.getElementById('npName').value = '';
  renderNpOrientation();
  renderNpResolutions();
  renderNpFps();
  const folderRow = document.getElementById('npFolderRow');
  folderRow.style.display = SUPPORTS_DISK_FOLDER ? '' : 'none';
  document.getElementById('npFolderStatus').textContent = 'Not saving to disk — will use browser storage';
  document.getElementById('homeScreen').classList.add('hidden');
  document.getElementById('newProjectScreen').classList.remove('hidden');
}
function hideNewProjectScreen(){
  document.getElementById('newProjectScreen').classList.add('hidden');
}

function renderNpOrientation(){
  document.querySelectorAll('.np-orient-tile').forEach(t=>{
    t.classList.toggle('active', t.dataset.orient===npState.orientation);
  });
}
function renderNpResolutions(){
  const row = document.getElementById('npResolutionRow');
  const options = RESOLUTION_OPTIONS[npState.orientation];
  if(!options.find(o=>o.width===npState.width && o.height===npState.height)){
    const mid = options[1];
    npState.width = mid.width; npState.height = mid.height;
  }
  row.innerHTML = options.map(o=>`
    <div class="np-chip${o.width===npState.width && o.height===npState.height ? ' active' : ''}" data-w="${o.width}" data-h="${o.height}">${o.label}</div>
  `).join('');
  row.querySelectorAll('.np-chip').forEach(chip=>{
    chip.onclick = ()=>{
      npState.width = parseInt(chip.dataset.w, 10);
      npState.height = parseInt(chip.dataset.h, 10);
      renderNpResolutions();
    };
  });
}
function renderNpFps(){
  const row = document.getElementById('npFpsRow');
  row.innerHTML = FPS_OPTIONS.map(f=>`
    <div class="np-chip${f===npState.fps ? ' active' : ''}" data-fps="${f}">${f} fps</div>
  `).join('');
  row.querySelectorAll('.np-chip').forEach(chip=>{
    chip.onclick = ()=>{
      npState.fps = parseInt(chip.dataset.fps, 10);
      renderNpFps();
    };
  });
}

// ---------- Project Settings modal (change format/fps on an existing project) ----------
let psState = { orientation:'horizontal', width:1920, height:1080, fps:25 };

function showProjectSettingsModal(){
  psState = {
    orientation: state.projectMeta.format || 'horizontal',
    width: state.projectMeta.width,
    height: state.projectMeta.height,
    fps: state.projectMeta.fps,
  };
  renderPsOrientation();
  renderPsResolutions();
  renderPsFps();
  document.getElementById('projectSettingsModal').classList.remove('hidden');
}
function renderPsOrientation(){
  document.querySelectorAll('#psOrientationRow .np-orient-tile').forEach(t=>{
    t.classList.toggle('active', t.dataset.orient===psState.orientation);
  });
}
function renderPsResolutions(){
  const row = document.getElementById('psResolutionRow');
  const options = RESOLUTION_OPTIONS[psState.orientation];
  if(!options.find(o=> o.width===psState.width && o.height===psState.height)){
    const mid = options[1];
    psState.width = mid.width; psState.height = mid.height;
  }
  row.innerHTML = options.map(o=> `
    <div class="np-chip${o.width===psState.width && o.height===psState.height ? ' active' : ''}" data-w="${o.width}" data-h="${o.height}">${o.label}</div>
  `).join('');
  row.querySelectorAll('.np-chip').forEach(chip=>{
    chip.onclick = ()=>{
      psState.width = parseInt(chip.dataset.w, 10);
      psState.height = parseInt(chip.dataset.h, 10);
      renderPsResolutions();
    };
  });
}
function renderPsFps(){
  const row = document.getElementById('psFpsRow');
  row.innerHTML = FPS_OPTIONS.map(f=> `
    <div class="np-chip${f===psState.fps ? ' active' : ''}" data-fps="${f}">${f} fps</div>
  `).join('');
  row.querySelectorAll('.np-chip').forEach(chip=>{
    chip.onclick = ()=>{
      psState.fps = parseInt(chip.dataset.fps, 10);
      renderPsFps();
    };
  });
}
function wireProjectSettingsModal(){
  const modal = document.getElementById('projectSettingsModal');
  const close = ()=> modal.classList.add('hidden');
  document.getElementById('psCloseBtn').onclick = close;
  document.getElementById('psCancelBtn').onclick = close;
  modal.addEventListener('click', (e)=>{ if(e.target===modal) close(); });
  document.querySelectorAll('#psOrientationRow .np-orient-tile').forEach(tile=>{
    tile.onclick = ()=>{
      psState.orientation = tile.dataset.orient;
      renderPsOrientation();
      renderPsResolutions();
    };
  });
  document.getElementById('psSaveBtn').onclick = ()=>{
    state.projectMeta.format = psState.orientation;
    state.projectMeta.width = psState.width;
    state.projectMeta.height = psState.height;
    state.projectMeta.fps = psState.fps;
    PROJECT_FPS = psState.fps;
    if(typeof applyProjectFrame==='function') applyProjectFrame();
    if(typeof saveProjectSoon==='function') saveProjectSoon();
    close();
  };
}

function wireNewProjectScreen(){
  document.querySelectorAll('.np-orient-tile').forEach(tile=>{
    tile.onclick = ()=>{
      npState.orientation = tile.dataset.orient;
      renderNpOrientation();
      renderNpResolutions();
    };
  });
  document.getElementById('npFolderBtn').onclick = async ()=>{
    if(!SUPPORTS_DISK_FOLDER) return;
    try{
      const handle = await window.showDirectoryPicker({ mode:'readwrite' });
      npState.folderHandle = handle;
      document.getElementById('npFolderStatus').textContent = 'Will save to “' + handle.name + '”';
    } catch(err){ /* user cancelled the picker */ }
  };
  document.getElementById('npCancelBtn').onclick = ()=>{
    hideNewProjectScreen();
    if(npReturnToHome || !currentProjectId) showHomeScreen();
  };
  document.getElementById('npCloseBtn').onclick = ()=> document.getElementById('npCancelBtn').click();
  document.getElementById('homeNewProjectBtn').onclick = ()=> showNewProjectScreen(true);
  const importBtn = document.getElementById('homeImportBtn');
  const importInput = document.getElementById('homeImportInput');
  const importBtnLabel = document.getElementById('homeImportBtnLabel');
  if(importBtn && importInput){
    importBtn.onclick = ()=> importInput.click();
    importInput.onchange = async ()=>{
      const file = importInput.files[0];
      importInput.value = '';
      if(!file) return;
      importBtn.disabled = true;
      if(importBtnLabel) importBtnLabel.textContent = 'Importing…';
      try{
        if(typeof importProjectFromZip==='function') await importProjectFromZip(file);
      } finally {
        importBtn.disabled = false;
        if(importBtnLabel) importBtnLabel.textContent = 'Import';
      }
    };
  }
  document.getElementById('npCreateBtn').onclick = async ()=>{
    const name = document.getElementById('npName').value.trim();
    hideNewProjectScreen();
    showLoadingScreen();
    logLoadingStep('Creating project…');
    await createProject({
      name, format: npState.orientation, width: npState.width, height: npState.height, fps: npState.fps,
      folderHandle: npState.folderHandle,
    });
    logLoadingStep('Done.', 'ok');
    finishLoadingScreen(false);
    updateFolderButton();
    updateProjTitleDisplay();
  };
}

// ---------- Project menu (topbar) ----------
// Shared by every top-menu dropdown (File/Project/Tools) — opening one now always closes
// any other that might be open, instead of each dropdown only knowing about itself.
function closeAllMenuDropdowns(except){
  document.querySelectorAll('.menu-dropdown.open').forEach(d=>{
    if(d !== except) d.classList.remove('open');
  });
}
function wireMenuDropdown(btnId, dropdownId, onAction){
  const btn = document.getElementById(btnId);
  const dropdown = document.getElementById(dropdownId);
  if(!btn || !dropdown) return;
  btn.addEventListener('click', (e)=>{
    e.stopPropagation();
    const willOpen = !dropdown.classList.contains('open');
    closeAllMenuDropdowns();
    if(willOpen) dropdown.classList.add('open');
  });
  document.addEventListener('click', ()=> dropdown.classList.remove('open'));
  dropdown.querySelectorAll('[data-action]').forEach(item=>{
    item.onclick = async (e)=>{
      e.stopPropagation();
      dropdown.classList.remove('open');
      await onAction(item.dataset.action);
    };
  });
}

function wireFileMenu(){
  wireMenuDropdown('menuFileBtn', 'menuFileDropdown', async (action)=>{
    if(action==='save'){
      if(currentProjectId) await saveProjectNow();
    } else if(action==='export'){
      if(typeof exportProjectToZip==='function') await exportProjectToZip();
    } else if(action==='close'){
      if(currentProjectId) await saveProjectNow();
      pausePlayback();
      showHomeScreen();
    }
  });
}

function wireProjectMenu(){
  wireMenuDropdown('menuProjectBtn', 'menuProjectDropdown', async (action)=>{
    if(action==='new') showNewProjectScreen();
    else if(action==='all'){ if(currentProjectId) await saveProjectNow(); showHomeScreen(); }
    else if(action==='rename'){
      const name = prompt('Project name:', state.projectMeta.name);
      if(name!==null && currentProjectId){
        await renameProject(currentProjectId, name);
        updateProjTitleDisplay();
      }
    } else if(action==='settings'){
      showProjectSettingsModal();
    }
  });
}

function wireToolsMenu(){
  wireMenuDropdown('menuToolsBtn', 'menuToolsDropdown', async (action)=>{
    if(action==='check') showCheckReport();
    else if(action==='ai-generator') showAiGeneratorModal();
  });
}

