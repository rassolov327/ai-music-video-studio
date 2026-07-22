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
  // Deliberately NOT using fetch(dataUrl) here — fetching a multi-megabyte data: URL (a
  // full song, base64-encoded, easily 5-10MB+) is unreliable in real browsers even though
  // it works fine on tiny test files. atob() has no such practical size limit.
  return new Promise((resolve, reject)=>{
    try{
      const commaIdx = dataUrl.indexOf(',');
      const header = dataUrl.slice(0, commaIdx);
      const base64 = dataUrl.slice(commaIdx + 1);
      const mimeMatch = header.match(/data:(.*?);base64/);
      const mime = mimeMatch ? mimeMatch[1] : 'application/octet-stream';
      const binary = atob(base64);
      const bytes = new Uint8Array(binary.length);
      for(let i=0; i<binary.length; i++) bytes[i] = binary.charCodeAt(i);
      resolve(URL.createObjectURL(new Blob([bytes], { type: mime })));
    } catch(err){ reject(err); }
  });
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
  diskDirHandle = handle;
  await idbSet(STORE_HANDLES, 'projectDir', handle);
  // Connecting a folder always means "keep saving my current work here" — it must never
  // silently load whatever that folder already contains and clobber what's in memory.
  // (Loading an existing project.json only happens once, at genuine app startup, in
  // initProjectStore() — there's no live work to protect at that point.)
  await saveProjectNow();
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
        try{
          copy.audioUrl = await blobUrlToBase64(item.audioUrl);
          console.log('[ProjectStore] encoded audio track "' + item.name + '" for saving (' + Math.round(copy.audioUrl.length/1024) + ' KB as base64)');
        }
        catch(err){ console.warn('[ProjectStore] FAILED to encode audio track "' + item.name + '" for saving:', err); copy.audioUrl = null; }
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
    console.log('[ProjectStore] restoring', musicCat.items.length, 'music track(s)');
    for(const item of musicCat.items){
      if(item.audioUrl && item.audioUrl.indexOf('data:')===0){
        try{
          item.audioUrl = await base64ToBlobUrl(item.audioUrl);
          console.log('[ProjectStore] restored audio track "' + item.name + '" ->', item.audioUrl);
        }
        catch(err){ console.warn('[ProjectStore] FAILED to restore audio track "' + item.name + '":', err); item.audioUrl = null; }
      } else {
        console.log('[ProjectStore] audio track "' + item.name + '" had no data: URL to restore (audioUrl was:', item.audioUrl, ')');
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
  console.log('[ProjectStore] project restored. timelineAudio:', state.timelineAudio);
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
      console.log('[ProjectStore] saved to disk folder "' + diskDirHandle.name + '"');
      return;
    } catch(err){
      console.warn('[ProjectStore] Disk save failed, falling back to browser storage:', err);
    }
  }
  await idbSet(STORE_PROJECT, 'current', data);
  lastSavedJSON = JSON.stringify(data);
  console.log('[ProjectStore] saved to browser storage (IndexedDB)');
}

let lastSavedJSON = null;

// kept as a no-op hook — some render functions still call this, harmless now that
// autosave compares actual content instead of relying on every mutation site remembering
// to flag itself dirty (that approach had gaps: e.g. scene settings' location/look
// dropdowns mutate state without going through any of the hooked render functions).
function markProjectDirty(){}

// Forces an immediate save instead of waiting for the next periodic tick — used right
// after especially valuable actions (like finishing a music upload) so a quick refresh
// right afterward can't lose it.
function saveProjectSoon(){
  autosaveTick();
}

async function autosaveTick(){
  let data;
  try{ data = await serializeProject(); }
  catch(err){ console.warn('[ProjectStore] Autosave: could not serialize project:', err); return; }
  const json = JSON.stringify(data);
  if(json === lastSavedJSON){ console.log('[ProjectStore] autosave tick: nothing changed, skipping write'); return; }
  setSaveStatus('saving');
  try{
    if(diskDirHandle){
      try{ await writeProjectToDisk(diskDirHandle, data); console.log('[ProjectStore] autosaved to disk folder'); }
      catch(err){ console.warn('[ProjectStore] Disk save failed, falling back to browser storage:', err); await idbSet(STORE_PROJECT, 'current', data); }
    } else {
      await idbSet(STORE_PROJECT, 'current', data);
      console.log('[ProjectStore] autosaved to browser storage (IndexedDB)');
    }
    lastSavedJSON = json;
    setSaveStatus('saved');
  } catch(err){
    setSaveStatus('error');
    console.warn('[ProjectStore] Autosave failed:', err);
  }
}

function updateFolderButton(){
  const btn = document.getElementById('connectFolderBtn');
  if(!btn) return;
  if(!SUPPORTS_DISK_FOLDER){ btn.style.display = 'none'; return; }
  btn.style.display = '';
  const folderIcon = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>';
  if(diskDirHandle){
    btn.innerHTML = folderIcon + 'Saved to “' + diskDirHandle.name + '” · change';
    btn.title = 'Autosaving into this folder on your disk. Click to pick a different folder.';
  } else {
    btn.innerHTML = folderIcon + 'Save to disk folder';
    btn.title = 'Keep this project as real files on your disk';
  }
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
  console.log('[ProjectStore] startup: disk folder check ->', diskResult === 'granted' ? 'granted' : diskResult && diskResult.needsPermission ? 'needs permission' : 'no folder connected');
  if(diskResult === 'granted'){
    const data = await readProjectFromDisk(diskDirHandle);
    if(data){
      await applyProjectData(data);
      updateFolderButton();
      setSaveStatus('saved');
      lastSavedJSON = JSON.stringify(await serializeProject());
      autosaveTimer = setInterval(autosaveTick, 3000);
      return true;
    }
    console.log('[ProjectStore] connected folder has no project.json yet');
  } else if(diskResult && diskResult.needsPermission){
    showReconnectFolderBanner(diskResult.needsPermission);
  }

  const idbData = await idbGet(STORE_PROJECT, 'current');
  console.log('[ProjectStore] startup: browser storage (IndexedDB) ->', idbData ? 'found a saved project' : 'nothing saved yet');
  if(idbData){
    await applyProjectData(idbData);
    setSaveStatus('saved');
    lastSavedJSON = JSON.stringify(await serializeProject());
  }
  autosaveTimer = setInterval(autosaveTick, 3000);
  return !!idbData;
}
