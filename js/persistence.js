// ---------- ProjectStore: save/load the whole project, autosave ----------
// Two backends:
//  - IndexedDB (default, works in every browser) — the project lives inside the browser's
//    own storage, invisible in the OS file explorer.
//  - A real folder on disk via the File System Access API (Chrome/Edge only) — opt-in,
//    writes an actual project.json file (plus real asset files) the user can see, back up,
//    or move by hand.
// Everything above this file (characters, locations, looks, music, timeline...) never talks
// to either backend directly — it only mutates `state`/`focus`/etc., and this module is the
// only place that knows how those get persisted. Swapping IndexedDB for real files later
// (Electron) means changing this one file, not the rest of the app.
//
// Important design point: the project JSON (scenes, characters, looks, timings...) is small
// and saves on a cheap timer. Big binary assets — right now just the music file — are NOT
// re-packed into that JSON on every tick. Each one is written ONCE, at the moment it's
// added or replaced, as either a raw Blob in its own IndexedDB store or a real file in the
// project folder's assets/ subfolder. The project JSON only ever holds a small reference
// (the track's id) pointing at that asset.

const DB_NAME = 'ai_mv_studio_db';
const DB_VERSION = 2;
const STORE_PROJECT = 'project';
const STORE_HANDLES = 'handles';
const STORE_ASSETS = 'assets'; // raw Blobs (e.g. music files), keyed by asset id

const SUPPORTS_DISK_FOLDER = ('showDirectoryPicker' in window) && (()=>{
  try{ return window.self === window.top; } catch(err){ return false; }
})();

let diskDirHandle = null;
let autosaveTimer = null;
let lastSavedJSON = null;

function openDB(){
  return new Promise((resolve, reject)=>{
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e)=>{
      const db = e.target.result;
      if(!db.objectStoreNames.contains(STORE_PROJECT)) db.createObjectStore(STORE_PROJECT);
      if(!db.objectStoreNames.contains(STORE_HANDLES)) db.createObjectStore(STORE_HANDLES);
      if(!db.objectStoreNames.contains(STORE_ASSETS)) db.createObjectStore(STORE_ASSETS);
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
async function idbDelete(store, key){
  const db = await openDB();
  return new Promise((resolve, reject)=>{
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).delete(key);
    tx.oncomplete = ()=> resolve();
    tx.onerror = ()=> reject(tx.error);
  });
}

// ---- big binary assets (music files) — written once, not on every autosave tick ----
function assetKeyForTrack(trackId){ return 'music:' + trackId; }

function safeAssetFileName(trackId, originalName){
  const dot = originalName.lastIndexOf('.');
  const ext = dot>=0 ? originalName.slice(dot) : '';
  return trackId + ext;
}

async function getAssetsDirHandle(create){
  if(!diskDirHandle) return null;
  return diskDirHandle.getDirectoryHandle('assets', { create: !!create });
}

// Called exactly once, right when a track is added or replaced — never on a periodic tick.
async function persistAudioAsset(trackId, file){
  if(diskDirHandle){
    try{
      const assetsDir = await getAssetsDirHandle(true);
      const fileName = safeAssetFileName(trackId, file.name || 'track.mp3');
      const fileHandle = await assetsDir.getFileHandle(fileName, { create:true });
      const writable = await fileHandle.createWritable();
      await writable.write(file);
      await writable.close();
      console.log('[ProjectStore] wrote audio asset to disk: assets/' + fileName);
      return { location:'disk', fileName };
    } catch(err){
      console.warn('[ProjectStore] could not write audio asset to disk, falling back to browser storage:', err);
    }
  }
  await idbSet(STORE_ASSETS, assetKeyForTrack(trackId), file);
  console.log('[ProjectStore] stored audio asset in browser storage for track', trackId);
  return { location:'idb' };
}

async function loadAudioAsset(trackId, diskFileName){
  if(diskDirHandle){
    try{
      const assetsDir = await getAssetsDirHandle(false);
      const fileName = diskFileName || safeAssetFileName(trackId, '.mp3');
      const fileHandle = await assetsDir.getFileHandle(fileName);
      const file = await fileHandle.getFile();
      console.log('[ProjectStore] loaded audio asset from disk: assets/' + fileName);
      return file;
    } catch(err){
      console.warn('[ProjectStore] audio asset not found on disk for track ' + trackId + ', trying browser storage:', err);
    }
  }
  try{
    const blob = await idbGet(STORE_ASSETS, assetKeyForTrack(trackId));
    if(blob) console.log('[ProjectStore] loaded audio asset from browser storage for track', trackId);
    return blob || null;
  } catch(err){
    console.warn('[ProjectStore] could not load audio asset for track ' + trackId + ':', err);
    return null;
  }
}

async function deleteAudioAsset(trackId){
  try{ await idbDelete(STORE_ASSETS, assetKeyForTrack(trackId)); } catch(err){}
  if(diskDirHandle){
    try{
      const assetsDir = await getAssetsDirHandle(false);
      for await (const name of assetsDir.keys()){
        if(name.indexOf(trackId)===0) await assetsDir.removeEntry(name);
      }
    } catch(err){}
  }
}

// Copies any assets currently sitting in browser storage onto a newly-connected disk
// folder, so switching to "save to disk" mid-project doesn't strand existing audio.
async function migrateAssetsToDisk(){
  const musicCat = state.categories.find(c=>c.key==='music');
  if(!musicCat) return;
  for(const item of musicCat.items){
    if(!item.id) continue;
    try{
      const blob = await idbGet(STORE_ASSETS, assetKeyForTrack(item.id));
      if(blob){
        const assetsDir = await getAssetsDirHandle(true);
        const fileName = safeAssetFileName(item.id, item.name || 'track.mp3');
        const fileHandle = await assetsDir.getFileHandle(fileName, { create:true });
        const writable = await fileHandle.createWritable();
        await writable.write(blob);
        await writable.close();
        item.diskFileName = fileName;
        console.log('[ProjectStore] migrated audio asset for "' + item.name + '" onto disk');
      }
    } catch(err){ console.warn('[ProjectStore] could not migrate asset for "' + item.name + '":', err); }
  }
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
  await migrateAssetsToDisk();
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
// Fast and cheap on purpose: no binary data ever passes through here, just plain JSON.
function serializeProject(){
  const categoriesOut = state.categories.map(cat=>({
    key: cat.key, name: cat.name, icon: cat.icon, addType: cat.addType, collapsed: cat.collapsed,
    items: cat.items.map(item=>{
      const copy = JSON.parse(JSON.stringify(item));
      if(cat.key==='music') delete copy.audioUrl; // never persisted inline — see persistAudioAsset
      return copy;
    }),
  }));
  return {
    version: 2,
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
      try{
        const blob = await loadAudioAsset(item.id, item.diskFileName);
        item.audioUrl = blob ? URL.createObjectURL(blob) : null;
        console.log('[ProjectStore] track "' + item.name + '" audio ' + (blob ? 'restored' : 'NOT FOUND'));
      } catch(err){
        console.warn('[ProjectStore] failed to restore audio for "' + item.name + '":', err);
        item.audioUrl = null;
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

// ---- save orchestration + autosave (JSON only — assets are handled separately) ----
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
  const data = serializeProject();
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

// kept as a no-op hook — some render functions still call this; harmless leftover now that
// autosave compares actual content instead of needing every mutation site to flag itself.
function markProjectDirty(){}

// Forces an immediate JSON save instead of waiting for the next periodic tick — used right
// after especially meaningful actions (attaching a track, adding a scene...). Cheap now
// that it never touches binary data.
function saveProjectSoon(){
  autosaveTick();
}

async function autosaveTick(){
  let data;
  try{ data = serializeProject(); }
  catch(err){ console.warn('[ProjectStore] Autosave: could not serialize project:', err); return; }
  const json = JSON.stringify(data);
  if(json === lastSavedJSON) return; // nothing actually changed since the last save
  setSaveStatus('saving');
  try{
    if(diskDirHandle){
      try{ await writeProjectToDisk(diskDirHandle, data); }
      catch(err){ console.warn('[ProjectStore] Disk save failed, falling back to browser storage:', err); await idbSet(STORE_PROJECT, 'current', data); }
    } else {
      await idbSet(STORE_PROJECT, 'current', data);
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
    btn.title = 'Autosaving into this folder on your disk (project.json + assets/). Click to pick a different folder.';
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
      lastSavedJSON = JSON.stringify(serializeProject());
      autosaveTimer = setInterval(autosaveTick, 3000);
      wireExitSave();
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
    lastSavedJSON = JSON.stringify(serializeProject());
  }
  autosaveTimer = setInterval(autosaveTick, 3000);
  wireExitSave();
  return !!idbData;
}

// Final safety net: save (cheap now — JSON only) when the tab is hidden/closed.
function wireExitSave(){
  document.addEventListener('visibilitychange', ()=>{
    if(document.visibilityState === 'hidden') saveProjectNow();
  });
  window.addEventListener('pagehide', ()=> saveProjectNow());
}
