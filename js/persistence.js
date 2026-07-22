// ---------- ProjectStore: save/load the whole project, autosave ----------
// Two backends:
//  - IndexedDB (default, works in every browser) — the project lives inside the browser's
//    own storage, invisible in the OS file explorer.
//  - A real folder on disk via the File System Access API (Chrome/Edge only) — opt-in,
//    writes an actual project.json file the user can see, back up, or move by hand.
// Everything above this file (characters, locations, looks, music, timeline...) never talks
// to either backend directly — it only mutates `state`/`focus`/etc., and this module is the
// only place that knows how those get persisted. Swapping IndexedDB for real files later
// (Electron) means changing this one file, not the rest of the app.

const DB_NAME = 'ai_mv_studio_db';
const DB_VERSION = 1;
const STORE_PROJECT = 'project';
const STORE_HANDLES = 'handles';

const SUPPORTS_DISK_FOLDER = ('showDirectoryPicker' in window) && (()=>{
  try{ return window.self === window.top; } catch(err){ return false; }
})();

let diskDirHandle = null;
let autosaveTimer = null;

function openDB(){
  return new Promise((resolve, reject)=>{
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e)=>{
      const db = e.target.result;
      if(!db.objectStoreNames.contains(STORE_PROJECT)) db.createObjectStore(STORE_PROJECT);
      if(!db.objectStoreNames.contains(STORE_HANDLES)) db.createObjectStore(STORE_HANDLES);
    };
    req.onsuccess = ()=> resolve(req.result);
    req.onerror = ()=> reject(req.error);
  });
}
async function idbGet(store, key){
  const db = await openDB();
  return new Promise((resolve, reject)=>{
    const tx = db.transaction(store, 'readonly');
    const req = tx.objectStore(store).get(key);
    req.onsuccess = ()=> resolve(req.result);
    req.onerror = ()=> reject(req.error);
  });
}
async function idbSet(store, key, value){
  const db = await openDB();
  return new Promise((resolve, reject)=>{
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).put(value, key);
    tx.oncomplete = ()=> resolve();
    tx.onerror = ()=> reject(tx.error);
  });
}

// ---- blob: URL <-> base64 (audio needs this; it's the only asset stored as a live blob URL
// instead of an inline data: URL, and blob: URLs don't survive a reload)
function blobUrlToBase64(blobUrl){
  return fetch(blobUrl)
    .then(res => res.blob())
    .then(blob => new Promise((resolve, reject)=>{
      const fr = new FileReader();
      fr.onload = ()=> resolve(fr.result);
      fr.onerror = reject;
      fr.readAsDataURL(blob);
    }));
}
function base64ToBlobUrl(dataUrl){
  return fetch(dataUrl).then(res => res.blob()).then(blob => URL.createObjectURL(blob));
}

// ---- disk folder (File System Access API) ----
async function writeProjectToDisk(dirHandle, projectData){
  const fileHandle = await dirHandle.getFileHandle('project.json', { create:true });
  const writable = await fileHandle.createWritable();
  await writable.write(JSON.stringify(projectData));
  await writable.close();
}
async function readProjectFromDisk(dirHandle){
  try{
    const fileHandle = await dirHandle.getFileHandle('project.json');
    const file = await fileHandle.getFile();
    const text = await file.text();
    return JSON.parse(text);
  } catch(err){
    return null; // no project.json yet — fresh/empty folder
  }
}
async function chooseDiskFolder(){
  if(!SUPPORTS_DISK_FOLDER) return false;
  let handle;
  try{
    handle = await window.showDirectoryPicker({ mode:'readwrite' });
  } catch(err){
    return false; // user cancelled the picker
  }
  const existing = await readProjectFromDisk(handle);
  diskDirHandle = handle;
  await idbSet(STORE_HANDLES, 'projectDir', handle);
  if(existing){
    await applyProjectData(existing);
  } else {
    await saveProjectNow();
  }
  updateFolderButton();
  return true;
}
async function tryRestoreDiskHandle(){
  if(!SUPPORTS_DISK_FOLDER) return null;
  let handle;
  try{ handle = await idbGet(STORE_HANDLES, 'projectDir'); }
  catch(err){ return null; }
  if(!handle) return null;
  const opts = { mode:'readwrite' };
  let perm;
  try{ perm = await handle.queryPermission(opts); } catch(err){ return null; }
  if(perm === 'granted'){
    diskDirHandle = handle;
    return 'granted';
  }
  return { needsPermission: handle };
}

// ---- serialize / restore the whole app state ----
async function serializeProject(){
  const categoriesOut = [];
  for(const cat of state.categories){
    const itemsOut = [];
    for(const item of cat.items){
      const copy = JSON.parse(JSON.stringify(item));
      if(cat.key==='music' && copy.audioUrl && copy.audioUrl.indexOf('blob:')===0){
        try{ copy.audioUrl = await blobUrlToBase64(item.audioUrl); }
        catch(err){ copy.audioUrl = null; }
      }
      itemsOut.push(copy);
    }
    categoriesOut.push({ key:cat.key, name:cat.name, icon:cat.icon, addType:cat.addType, collapsed:cat.collapsed, items:itemsOut });
  }
  return {
    version: 1,
    savedAt: Date.now(),
    categories: categoriesOut,
    scenes: JSON.parse(JSON.stringify(state.scenes)),
    timelineAudio: state.timelineAudio ? JSON.parse(JSON.stringify(state.timelineAudio)) : null,
    focus: Object.assign({}, focus),
    timelineMode: timelineMode,
    playheadX: playheadX,
    seq: { sceneSeq, shotSeq, paletteSeq, charSeq, locSeq, trackSeq, lookSeq },
  };
}

async function applyProjectData(data){
  if(!data) return false;
  const musicCat = data.categories && data.categories.find(c=>c.key==='music');
  if(musicCat){
    for(const item of musicCat.items){
      if(item.audioUrl && item.audioUrl.indexOf('data:')===0){
        try{ item.audioUrl = await base64ToBlobUrl(item.audioUrl); }
        catch(err){ item.audioUrl = null; }
      }
    }
  }
  state.categories = data.categories || state.categories;
  state.scenes = data.scenes || [];
  state.timelineAudio = data.timelineAudio || null;
  focus = data.focus || { sceneId:null, shotId:null };
  timelineMode = data.timelineMode || 'assembly';
  playheadX = data.playheadX || 0;
  if(data.seq){
    sceneSeq = data.seq.sceneSeq || 1;
    shotSeq = data.seq.shotSeq || 1;
    paletteSeq = data.seq.paletteSeq || 0;
    charSeq = data.seq.charSeq || 1;
    locSeq = data.seq.locSeq || 1;
    trackSeq = data.seq.trackSeq || 1;
    lookSeq = data.seq.lookSeq || 1;
  }
  renderAssets();
  renderTimelineScenes();
  refreshMainPreview();
  return true;
}

// ---- save orchestration + autosave ----
function setSaveStatus(status){
  const el = document.getElementById('saveStatus');
  if(!el) return;
  el.classList.remove('saving','saved','error');
  if(status==='saving'){ el.textContent = 'Saving…'; el.classList.add('saving'); }
  else if(status==='saved'){ el.textContent = 'Saved'; el.classList.add('saved'); }
  else if(status==='error'){ el.textContent = 'Save failed'; el.classList.add('error'); }
  else { el.textContent = ''; }
}

async function saveProjectNow(){
  const data = await serializeProject();
  if(diskDirHandle){
    try{
      await writeProjectToDisk(diskDirHandle, data);
      lastSavedJSON = JSON.stringify(data);
      return;
    } catch(err){
      console.warn('Disk save failed, falling back to browser storage:', err);
    }
  }
  await idbSet(STORE_PROJECT, 'current', data);
  lastSavedJSON = JSON.stringify(data);
}

let lastSavedJSON = null;

// kept as a no-op hook — some render functions still call this, harmless now that
// autosave compares actual content instead of relying on every mutation site remembering
// to flag itself dirty (that approach had gaps: e.g. scene settings' location/look
// dropdowns mutate state without going through any of the hooked render functions).
function markProjectDirty(){}

async function autosaveTick(){
  let data;
  try{ data = await serializeProject(); }
  catch(err){ console.warn('Autosave: could not serialize project:', err); return; }
  const json = JSON.stringify(data);
  if(json === lastSavedJSON) return; // nothing actually changed since the last save
  setSaveStatus('saving');
  try{
    if(diskDirHandle){
      try{ await writeProjectToDisk(diskDirHandle, data); }
      catch(err){ console.warn('Disk save failed, falling back to browser storage:', err); await idbSet(STORE_PROJECT, 'current', data); }
    } else {
      await idbSet(STORE_PROJECT, 'current', data);
    }
    lastSavedJSON = json;
    setSaveStatus('saved');
  } catch(err){
    setSaveStatus('error');
    console.warn('Autosave failed:', err);
  }
}

function updateFolderButton(){
  const btn = document.getElementById('connectFolderBtn');
  if(!btn) return;
  if(!SUPPORTS_DISK_FOLDER){ btn.style.display = 'none'; return; }
  btn.style.display = '';
  btn.textContent = diskDirHandle ? '' : '';
  btn.innerHTML = diskDirHandle
    ? '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>Saving to disk folder'
    : '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>Save to disk folder';
}

function showReconnectFolderBanner(handle){
  const btn = document.getElementById('connectFolderBtn');
  if(!btn) return;
  btn.style.display = '';
  btn.innerHTML = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>Reconnect project folder';
  btn.onclick = async ()=>{
    try{
      const perm = await handle.requestPermission({ mode:'readwrite' });
      if(perm==='granted'){
        diskDirHandle = handle;
        const existing = await readProjectFromDisk(handle);
        if(existing) await applyProjectData(existing);
        updateFolderButton();
        wireFolderButton();
      }
    } catch(err){ console.warn('Could not reconnect folder:', err); }
  };
}

function wireFolderButton(){
  const btn = document.getElementById('connectFolderBtn');
  if(!btn) return;
  btn.onclick = ()=> chooseDiskFolder().then(updateFolderButton);
}

// Returns true if a saved project was found and restored.
async function initProjectStore(){
  updateFolderButton();
  wireFolderButton();

  const diskResult = await tryRestoreDiskHandle();
  if(diskResult === 'granted'){
    const data = await readProjectFromDisk(diskDirHandle);
    if(data){
      await applyProjectData(data);
      updateFolderButton();
      setSaveStatus('saved');
      lastSavedJSON = JSON.stringify(await serializeProject());
      autosaveTimer = setInterval(autosaveTick, 5000);
      return true;
    }
  } else if(diskResult && diskResult.needsPermission){
    showReconnectFolderBanner(diskResult.needsPermission);
  }

  const idbData = await idbGet(STORE_PROJECT, 'current');
  if(idbData){
    await applyProjectData(idbData);
    setSaveStatus('saved');
    lastSavedJSON = JSON.stringify(await serializeProject());
  }
  autosaveTimer = setInterval(autosaveTick, 5000);
  return !!idbData;
}
