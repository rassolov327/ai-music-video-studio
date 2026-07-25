// ---------- ProjectStore: multiple projects, each with its own save/load, autosave ----------
// Two backends per project:
//  - IndexedDB (default, works in every browser) — the project lives inside the browser's
//    own storage, invisible in the OS file explorer.
//  - A real folder on disk via the File System Access API (Chrome/Edge only) — opt-in,
//    writes an actual project.json file (plus real asset files) the user can see, back up,
//    or move by hand. Each project that uses this gets its own folder.
// Everything above this file (characters, locations, looks, music, timeline...) never talks
// to either backend directly — it only mutates `state`/`focus`/etc., and this module is the
// only place that knows how those get persisted.
//
// Multi-project note: several projects can share the same browser storage, so every asset
// key and every project record is namespaced by projectId — otherwise two projects' "c1"
// character (both starting their id counter at 1) would collide in storage.

const DB_NAME = 'ai_mv_studio_db';
const DB_VERSION = 3;
const STORE_PROJECT = 'project';       // keyed by projectId -> full project JSON
const STORE_PROJECT_META = 'projectMeta'; // keyed by projectId -> lightweight listing info
const STORE_HANDLES = 'handles';       // keyed by projectId -> FileSystemDirectoryHandle
const STORE_ASSETS = 'assets';         // keyed by "<projectId>:music:<id>" etc -> raw Blob
const STORE_APP = 'app';               // small app-wide settings (e.g. last opened project)

const SUPPORTS_DISK_FOLDER = ('showDirectoryPicker' in window) && (()=>{
  try{ return window.self === window.top; } catch(err){ return false; }
})();

let currentProjectId = null;
let diskDirHandle = null;
let autosaveTimer = null;
let lastSavedJSON = null;

function openDB(){
  return new Promise((resolve, reject)=>{
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e)=>{
      const db = e.target.result;
      if(!db.objectStoreNames.contains(STORE_PROJECT)) db.createObjectStore(STORE_PROJECT);
      if(!db.objectStoreNames.contains(STORE_PROJECT_META)) db.createObjectStore(STORE_PROJECT_META);
      if(!db.objectStoreNames.contains(STORE_HANDLES)) db.createObjectStore(STORE_HANDLES);
      if(!db.objectStoreNames.contains(STORE_ASSETS)) db.createObjectStore(STORE_ASSETS);
      if(!db.objectStoreNames.contains(STORE_APP)) db.createObjectStore(STORE_APP);
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
async function idbGetAll(store){
  const db = await openDB();
  return new Promise((resolve, reject)=>{
    const tx = db.transaction(store, 'readonly');
    const os = tx.objectStore(store);
    const keysReq = os.getAllKeys();
    const valsReq = os.getAll();
    let keys, vals;
    keysReq.onsuccess = ()=>{ keys = keysReq.result; if(vals) resolve(keys.map((k,i)=>({key:k, value:vals[i]}))); };
    valsReq.onsuccess = ()=>{ vals = valsReq.result; if(keys) resolve(keys.map((k,i)=>({key:k, value:vals[i]}))); };
    tx.onerror = ()=> reject(tx.error);
  });
}

// ---- project id namespacing for shared stores ----
function pid(){ return currentProjectId || 'default'; }

// ============================================================
// Project list management (home screen)
// ============================================================
async function listProjects(){
  try{
    const rows = await idbGetAll(STORE_PROJECT_META);
    return rows.map(r=>r.value).filter(Boolean).sort((a,b)=> (b.updatedAt||0) - (a.updatedAt||0));
  } catch(err){ return []; }
}
async function saveProjectMeta(meta){
  await idbSet(STORE_PROJECT_META, meta.id, meta);
}
function genProjectId(){
  return 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2,7);
}
async function getLastActiveProjectId(){
  try{ return await idbGet(STORE_APP, 'lastActiveProjectId'); } catch(err){ return null; }
}
async function setLastActiveProjectId(id){
  try{ await idbSet(STORE_APP, 'lastActiveProjectId', id); } catch(err){}
}

// Creates a brand new, empty project with the given settings and makes it the active one.
// `folderHandle` is optional — pass it when the user picked a disk folder in the New
// Project dialog.
async function createProject({ name, format, width, height, fps, folderHandle }){
  if(currentProjectId){
    stopAutosave();
    try{ await saveProjectNow(); } catch(err){ console.warn('[ProjectStore] could not save previous project before switching:', err); }
  }
  const id = genProjectId();
  currentProjectId = id;
  diskDirHandle = folderHandle || null;

  const now = Date.now();
  const meta = {
    id, name: (name || 'Untitled Project').trim() || 'Untitled Project',
    format: format || 'horizontal', width: width || 1920, height: height || 1080, fps: fps || 25,
    storage: diskDirHandle ? 'disk' : 'idb',
    folderName: diskDirHandle ? diskDirHandle.name : null,
    createdAt: now, updatedAt: now,
  };

  // reset in-memory state to a fresh empty project
  state.categories.forEach(cat=>{ cat.items = []; });
  state.scenes = [];
  state.timelineAudio = null;
  state.projectMeta = { id, name: meta.name, format: meta.format, width: meta.width, height: meta.height, fps: meta.fps, createdAt: now, updatedAt: now };
  focus = { sceneId:null, shotId:null };
  timelineMode = 'assembly';
  playheadX = 0;
  sceneSeq = 1; shotSeq = 1; paletteSeq = 0; charSeq = 1; locSeq = 1; trackSeq = 1; lookSeq = 1; propSeq = 1; draftTaskSeq = 1;
  state.taskQueue = [];
  PROJECT_FPS = meta.fps;
  applyProjectFrame();
  renderAssets();
  renderTimelineScenes();

  await saveProjectMeta(meta);
  if(diskDirHandle){
    try{ await idbSet(STORE_HANDLES, id, diskDirHandle); } catch(err){}
  }
  lastSavedJSON = null;
  await saveProjectNow();
  await setLastActiveProjectId(id);
  startAutosave();
  return id;
}

// Opens an existing project by id (from the home screen list) and makes it active.
async function openProject(id, verbose){
  if(currentProjectId && currentProjectId !== id){
    stopAutosave();
    try{ await saveProjectNow(); } catch(err){ console.warn('[ProjectStore] could not save previous project before switching:', err); }
  }
  currentProjectId = id;
  diskDirHandle = null;
  const meta = await idbGet(STORE_PROJECT_META, id);
  let data = null;

  if(meta && meta.storage === 'disk'){
    let handle;
    try{ handle = await idbGet(STORE_HANDLES, id); } catch(err){ handle = null; }
    if(handle){
      try{
        const perm = await handle.queryPermission({ mode:'readwrite' });
        if(perm === 'granted'){
          diskDirHandle = handle;
        } else {
          if(verbose) logLoadingStep('Project folder needs permission again.', 'error');
          const granted = await requestFolderPermissionInteractive(handle);
          if(granted) diskDirHandle = handle;
        }
      } catch(err){}
    }
    if(diskDirHandle){
      data = await readProjectFromDisk(diskDirHandle);
    }
  }
  if(!data){
    data = await idbGet(STORE_PROJECT, id);
  }

  if(!data){
    if(verbose) logLoadingStep('Could not find this project\'s data.', 'error');
    return false;
  }
  const hadErrors = await applyProjectData(data, verbose);
  lastSavedJSON = JSON.stringify(serializeProject());
  await setLastActiveProjectId(id);
  if(meta){ meta.updatedAt = Date.now(); await saveProjectMeta(meta); }
  startAutosave();
  updateFolderButton();
  return !hadErrors;
}

// Some browsers only grant/re-grant folder permission from a direct user gesture, so this
// is called from a click handler on the home screen ("this project needs permission") —
// it cannot happen silently in the background.
async function requestFolderPermissionInteractive(handle){
  try{
    const perm = await handle.requestPermission({ mode:'readwrite' });
    return perm === 'granted';
  } catch(err){ return false; }
}

async function deleteProject(id){
  try{ await idbDelete(STORE_PROJECT_META, id); } catch(err){}
  try{ await idbDelete(STORE_PROJECT, id); } catch(err){}
  try{ await idbDelete(STORE_HANDLES, id); } catch(err){}
  // best-effort: also clear that project's assets out of browser storage (disk files, if
  // any, are left alone — they belong to the user's folder, not to us)
  try{
    const db = await openDB();
    const tx = db.transaction(STORE_ASSETS, 'readwrite');
    const os = tx.objectStore(STORE_ASSETS);
    const keysReq = os.getAllKeys();
    keysReq.onsuccess = ()=>{
      keysReq.result.forEach(k=>{ if(typeof k==='string' && k.indexOf(id+':')===0) os.delete(k); });
    };
    await new Promise((resolve)=>{ tx.oncomplete = resolve; tx.onerror = resolve; });
  } catch(err){}
}
async function renameProject(id, name){
  const meta = await idbGet(STORE_PROJECT_META, id);
  if(!meta) return;
  meta.name = (name || 'Untitled Project').trim() || 'Untitled Project';
  meta.updatedAt = Date.now();
  await saveProjectMeta(meta);
  if(id === currentProjectId){
    state.projectMeta.name = meta.name;
    saveProjectSoon();
  }
}

// Applies the current project's format to the parts of the app that actually depend on it
// (preview aspect ratio right now; generation calls read state.projectMeta directly).
function applyProjectFrame(){
  const root = document.documentElement;
  if(root) root.style.setProperty('--project-aspect', state.projectMeta.width + ' / ' + state.projectMeta.height);
  if(typeof updateProjTitleDisplay==='function') updateProjTitleDisplay();
  if(typeof refreshMainPreview==='function') refreshMainPreview();
}

function startAutosave(){
  if(autosaveTimer) clearInterval(autosaveTimer);
  autosaveTimer = setInterval(autosaveTick, 3000);
  wireExitSave();
}
function stopAutosave(){
  if(autosaveTimer){ clearInterval(autosaveTimer); autosaveTimer = null; }
}

// ============================================================
// Big binary assets (music files, character/location images) — written once, not on every
// autosave tick. Every key is namespaced by project id.
// ============================================================
function assetKeyForTrack(trackId){ return pid() + ':music:' + trackId; }

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
  if(musicCat){
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
  const bandCat = state.categories.find(c=>c.key==='band');
  if(bandCat) for(const item of bandCat.items) await migrateImageFieldsToDisk(item, 'band');
  const locCat = state.categories.find(c=>c.key==='locations');
  if(locCat) for(const item of locCat.items) await migrateImageFieldsToDisk(item, 'locations');
  const propCat = state.categories.find(c=>c.key==='props');
  if(propCat) for(const item of propCat.items) await migrateImageFieldsToDisk(item, 'props');
  for(const scene of state.scenes){
    for(const shot of (scene.shots||[])){
      if(!shot._assetFiles || shot._assetFiles.preview) continue; // nothing saved, or already a disk file
      try{
        const assetKey = pid() + ':shots:' + shot.id;
        const blob = await idbGet(STORE_ASSETS, assetKey);
        if(blob){
          const assetsDir = await getAssetsDirHandle(true);
          const fileName = assetKey.replace(/[:]/g,'_') + '.png';
          const fileHandle = await assetsDir.getFileHandle(fileName, { create:true });
          const writable = await fileHandle.createWritable();
          await writable.write(blob);
          await writable.close();
          shot._assetFiles.preview = fileName;
        }
      } catch(err){ console.warn('[ProjectStore] could not migrate shot preview:', err); }
    }
  }
}
async function migrateImageFieldsToDisk(item, catKey){
  if(!item._assetFiles) return;
  for(const fieldKey of Object.keys(item._assetFiles)){
    if(item._assetFiles[fieldKey]) continue; // already a disk file
    try{
      const assetKey = pid() + ':' + catKey + ':' + item.id + ':' + fieldKey;
      const blob = await idbGet(STORE_ASSETS, assetKey);
      if(blob){
        const assetsDir = await getAssetsDirHandle(true);
        const fileName = assetKey.replace(/[:]/g,'_') + '.png';
        const fileHandle = await assetsDir.getFileHandle(fileName, { create:true });
        const writable = await fileHandle.createWritable();
        await writable.write(blob);
        await writable.close();
        item._assetFiles[fieldKey] = fileName;
      }
    } catch(err){ console.warn('[ProjectStore] could not migrate image asset:', err); }
  }
}

// ---- generic image assets (character angle photos, turnaround sheets, location photos) —
// same "written once, referenced by key" pattern as audio.
function dataUrlToBlobSync(dataUrl){
  const commaIdx = dataUrl.indexOf(',');
  const header = dataUrl.slice(0, commaIdx);
  const base64 = dataUrl.slice(commaIdx + 1);
  const mimeMatch = header.match(/data:(.*?);base64/);
  const mime = mimeMatch ? mimeMatch[1] : 'application/octet-stream';
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for(let i=0; i<binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}
function extFromDataUrl(dataUrl){
  const m = dataUrl.match(/^data:image\/([a-zA-Z0-9+.-]+);base64/);
  if(!m) return '.png';
  const map = { jpeg:'jpg', 'svg+xml':'svg' };
  return '.' + (map[m[1]] || m[1]);
}
function extFromMimeType(mime){
  const map = { 'image/png':'.png', 'image/jpeg':'.jpg', 'image/webp':'.webp', 'image/gif':'.gif' };
  return (mime && map[mime]) || '.png';
}
// Shared by both persistImageAsset (local uploads, already a data: URL) and
// persistRemoteImageAsset (downloaded generations) — writes a Blob to disk or IndexedDB.
async function persistBlobAsset(assetKey, blob, ext, assetsDirHandle){
  if(diskDirHandle){
    try{
      const assetsDir = assetsDirHandle || await getAssetsDirHandle(true);
      const fileName = assetKey.replace(/[:]/g,'_') + ext;
      const fileHandle = await assetsDir.getFileHandle(fileName, { create:true });
      const writable = await fileHandle.createWritable();
      await writable.write(blob);
      await writable.close();
      return fileName;
    } catch(err){ console.warn('[ProjectStore] could not write asset to disk:', err); }
  }
  await idbSet(STORE_ASSETS, assetKey, blob);
  return null;
}
async function persistImageAsset(assetKey, dataUrl, assetsDirHandle){
  if(!dataUrl || dataUrl.indexOf('data:')!==0) return undefined;
  const blob = dataUrlToBlobSync(dataUrl);
  return persistBlobAsset(assetKey, blob, extFromDataUrl(dataUrl), assetsDirHandle);
}
// Downloads a generated image (KIE's temp hosting, Pollinations, etc.) through our own
// server (see /api/proxy-image — a direct browser fetch of a cross-origin image can be
// silently blocked by that host's CORS policy, which we don't control) and saves it the
// same way as any other local asset. This is what stops a paid generation from becoming a
// dead link once the provider's own retention window expires (KIE's is 14 days).
async function persistRemoteImageAsset(assetKey, remoteUrl, assetsDirHandle){
  const res = await fetch('/api/proxy-image?url=' + encodeURIComponent(remoteUrl));
  if(!res.ok){
    const data = await res.json().catch(()=> null);
    throw new Error((data && data.message) || ('Could not download the generated image (HTTP ' + res.status + ')'));
  }
  const blob = await res.blob();
  const fileName = await persistBlobAsset(assetKey, blob, extFromMimeType(blob.type), assetsDirHandle);
  return { fileName, blob };
}
async function loadImageAsset(assetKey, fileName, assetsDirHandle){
  if(diskDirHandle){
    try{
      const assetsDir = assetsDirHandle || await getAssetsDirHandle(false);
      const lookupName = fileName || assetKey.replace(/[:]/g,'_');
      const fileHandle = await assetsDir.getFileHandle(lookupName);
      const file = await fileHandle.getFile();
      return URL.createObjectURL(file);
    } catch(err){ console.warn('[ProjectStore] image asset "' + fileName + '" not found on disk, trying browser storage:', err); }
  }
  try{
    const blob = await idbGet(STORE_ASSETS, assetKey);
    return blob ? URL.createObjectURL(blob) : null;
  } catch(err){ return null; }
}

// Called once, right after a character is saved — never on a periodic autosave tick.
async function persistCharacterImages(character){
  if(!character.id) return;
  character._assetFiles = character._assetFiles || {};
  const assetsDir = diskDirHandle ? await getAssetsDirHandle(true) : null;
  const jobs = [];
  if(character.angleSlots){
    for(const slotKey of Object.keys(character.angleSlots)){
      const val = character.angleSlots[slotKey];
      const fieldKey = 'angle-' + slotKey;
      if(val && val.indexOf('data:')===0){
        jobs.push(
          persistImageAsset(pid() + ':band:' + character.id + ':' + fieldKey, val, assetsDir)
            .then(fileName=>{ character._assetFiles[fieldKey] = fileName; })
        );
      }
    }
  }
  if(character.turnaroundSheet && character.turnaroundSheet.indexOf('data:')===0){
    jobs.push(
      persistImageAsset(pid() + ':band:' + character.id + ':turnaround', character.turnaroundSheet, assetsDir)
        .then(fileName=>{ character._assetFiles['turnaround'] = fileName; })
    );
  }
  await Promise.all(jobs);
  console.log('[ProjectStore] persisted ' + jobs.length + ' image(s) for character "' + character.name + '"', character._assetFiles);
}
async function restoreCharacterImages(character){
  if(!character._assetFiles) return { found:0, total:0, missing:[] };
  if(!character.angleSlots) character.angleSlots = typeof emptyAngleSlots==='function' ? emptyAngleSlots() : {};
  const assetsDir = diskDirHandle ? await getAssetsDirHandle(false).catch(()=>null) : null;
  const missing = [];
  let found = 0;
  const fieldKeys = Object.keys(character._assetFiles);
  const jobs = fieldKeys.map(async (fieldKey)=>{
    const fileName = character._assetFiles[fieldKey];
    const assetKey = pid() + ':band:' + character.id + ':' + fieldKey;
    const url = await loadImageAsset(assetKey, fileName, assetsDir);
    if(fieldKey === 'turnaround') character.turnaroundSheet = url;
    else if(fieldKey.indexOf('angle-')===0) character.angleSlots[fieldKey.slice(6)] = url;
    if(url) found++;
    else missing.push(fieldKey + ' (expected "' + fileName + '")');
  });
  await Promise.all(jobs);
  character.photo = character.angleSlots.front || null;
  return { found, total: fieldKeys.length, missing };
}
async function deleteCharacterImages(character){
  if(!character._assetFiles) return;
  for(const fieldKey of Object.keys(character._assetFiles)){
    const assetKey = pid() + ':band:' + character.id + ':' + fieldKey;
    try{ await idbDelete(STORE_ASSETS, assetKey); } catch(err){}
  }
  if(diskDirHandle){
    try{
      const assetsDir = await getAssetsDirHandle(false);
      for await (const name of assetsDir.keys()){
        if(name.indexOf('band_' + character.id + '_')===0 || name.indexOf(pid()+'_band_'+character.id+'_')===0) await assetsDir.removeEntry(name);
      }
    } catch(err){}
  }
}

// Called once, right after a location is saved.
async function persistLocationImages(location){
  if(!location.id) return;
  location._assetFiles = location._assetFiles || {};
  const assetsDir = diskDirHandle ? await getAssetsDirHandle(true) : null;
  const jobs = [];
  if(location.photo && location.photo.indexOf('data:')===0){
    jobs.push(
      persistImageAsset(pid() + ':locations:' + location.id + ':photo', location.photo, assetsDir)
        .then(fileName=>{ location._assetFiles['photo'] = fileName; })
    );
  }
  if(location.angles){
    for(let i=0; i<location.angles.length; i++){
      const val = location.angles[i];
      const fieldKey = 'angle-' + i;
      if(val && val.indexOf('data:')===0){
        jobs.push(
          persistImageAsset(pid() + ':locations:' + location.id + ':' + fieldKey, val, assetsDir)
            .then(fileName=>{ location._assetFiles[fieldKey] = fileName; })
        );
      }
    }
  }
  await Promise.all(jobs);
  console.log('[ProjectStore] persisted ' + jobs.length + ' image(s) for location "' + location.name + '"', location._assetFiles);
}
async function restoreLocationImages(location){
  if(!location._assetFiles) return { found:0, total:0, missing:[] };
  const assetsDir = diskDirHandle ? await getAssetsDirHandle(false).catch(()=>null) : null;
  const missing = [];
  let found = 0;
  const fieldKeys = Object.keys(location._assetFiles);
  const jobs = fieldKeys.map(async (fieldKey)=>{
    const fileName = location._assetFiles[fieldKey];
    const assetKey = pid() + ':locations:' + location.id + ':' + fieldKey;
    const url = await loadImageAsset(assetKey, fileName, assetsDir);
    if(fieldKey==='photo') location.photo = url;
    else if(fieldKey.indexOf('angle-')===0){
      const idx = parseInt(fieldKey.slice(6), 10);
      if(!location.angles) location.angles = [];
      location.angles[idx] = url;
    }
    if(url) found++;
    else missing.push(fieldKey + ' (expected "' + fileName + '")');
  });
  await Promise.all(jobs);
  return { found, total: fieldKeys.length, missing };
}
async function deleteLocationImages(location){
  if(!location._assetFiles) return;
  for(const fieldKey of Object.keys(location._assetFiles)){
    const assetKey = pid() + ':locations:' + location.id + ':' + fieldKey;
    try{ await idbDelete(STORE_ASSETS, assetKey); } catch(err){}
  }
  if(diskDirHandle){
    try{
      const assetsDir = await getAssetsDirHandle(false);
      for await (const name of assetsDir.keys()){
        if(name.indexOf('locations_' + location.id + '_')===0 || name.indexOf(pid()+'_locations_'+location.id+'_')===0) await assetsDir.removeEntry(name);
      }
    } catch(err){}
  }
}

// Called once, right after a prop is saved.
async function persistPropImages(prop){
  if(!prop.id) return;
  prop._assetFiles = prop._assetFiles || {};
  const assetsDir = diskDirHandle ? await getAssetsDirHandle(true) : null;
  const jobs = [];
  if(prop.photo && prop.photo.indexOf('data:')===0){
    jobs.push(
      persistImageAsset(pid() + ':props:' + prop.id + ':photo', prop.photo, assetsDir)
        .then(fileName=>{ prop._assetFiles['photo'] = fileName; })
    );
  }
  if(prop.angles){
    for(let i=0; i<prop.angles.length; i++){
      const val = prop.angles[i];
      const fieldKey = 'angle-' + i;
      if(val && val.indexOf('data:')===0){
        jobs.push(
          persistImageAsset(pid() + ':props:' + prop.id + ':' + fieldKey, val, assetsDir)
            .then(fileName=>{ prop._assetFiles[fieldKey] = fileName; })
        );
      }
    }
  }
  await Promise.all(jobs);
  console.log('[ProjectStore] persisted ' + jobs.length + ' image(s) for prop "' + prop.name + '"', prop._assetFiles);
}
async function restorePropImages(prop){
  if(!prop._assetFiles) return { found:0, total:0, missing:[] };
  const assetsDir = diskDirHandle ? await getAssetsDirHandle(false).catch(()=>null) : null;
  const missing = [];
  let found = 0;
  const fieldKeys = Object.keys(prop._assetFiles);
  const jobs = fieldKeys.map(async (fieldKey)=>{
    const fileName = prop._assetFiles[fieldKey];
    const assetKey = pid() + ':props:' + prop.id + ':' + fieldKey;
    const url = await loadImageAsset(assetKey, fileName, assetsDir);
    if(fieldKey==='photo') prop.photo = url;
    else if(fieldKey.indexOf('angle-')===0){
      const idx = parseInt(fieldKey.slice(6), 10);
      if(!prop.angles) prop.angles = [];
      prop.angles[idx] = url;
    }
    if(url) found++;
    else missing.push(fieldKey + ' (expected "' + fileName + '")');
  });
  await Promise.all(jobs);
  return { found, total: fieldKeys.length, missing };
}
async function deletePropImages(prop){
  if(!prop._assetFiles) return;
  for(const fieldKey of Object.keys(prop._assetFiles)){
    const assetKey = pid() + ':props:' + prop.id + ':' + fieldKey;
    try{ await idbDelete(STORE_ASSETS, assetKey); } catch(err){}
  }
  if(diskDirHandle){
    try{
      const assetsDir = await getAssetsDirHandle(false);
      for await (const name of assetsDir.keys()){
        if(name.indexOf('props_' + prop.id + '_')===0 || name.indexOf(pid()+'_props_'+prop.id+'_')===0) await assetsDir.removeEntry(name);
      }
    } catch(err){}
  }
}

// Called once, right after a shot generation (free or paid) finishes — downloads the
// result and saves it as a real local asset instead of just keeping the provider's link,
// which is what protects against KIE's 14-day media retention (or any host eventually
// taking the file down) silently breaking an already-paid-for generation.
async function persistShotPreviewImage(shot, resultUrl){
  if(!shot || !shot.id || !resultUrl) return;
  try{
    const assetKey = pid() + ':shots:' + shot.id;
    let fileName, blob;
    if(resultUrl.indexOf('data:')===0){
      // offline canvas fallback — already local, no download needed
      blob = dataUrlToBlobSync(resultUrl);
      fileName = await persistBlobAsset(assetKey, blob, extFromDataUrl(resultUrl));
    } else {
      const result = await persistRemoteImageAsset(assetKey, resultUrl);
      fileName = result.fileName;
      blob = result.blob;
    }
    shot.previewImage = URL.createObjectURL(blob);
    shot._assetFiles = shot._assetFiles || {};
    shot._assetFiles.preview = fileName;
    console.log('[ProjectStore] saved shot preview locally for "' + shot.name + '"');
  } catch(err){
    console.warn('[ProjectStore] could not save shot preview locally, keeping the provider link only (it may expire later):', err);
    shot.previewImage = resultUrl;
  }
  if(typeof saveProjectSoon==='function') saveProjectSoon();
}
async function restoreShotPreviewImage(shot, assetsDirHandle){
  if(!shot._assetFiles || !('preview' in shot._assetFiles)) return true; // nothing saved locally for this shot
  const assetKey = pid() + ':shots:' + shot.id;
  const url = await loadImageAsset(assetKey, shot._assetFiles.preview, assetsDirHandle);
  if(url){ shot.previewImage = url; return true; }
  return false;
}
async function deleteShotPreviewImage(shot){
  if(!shot._assetFiles || !('preview' in shot._assetFiles)) return;
  const assetKey = pid() + ':shots:' + shot.id;
  try{ await idbDelete(STORE_ASSETS, assetKey); } catch(err){}
  if(diskDirHandle){
    try{
      const assetsDir = await getAssetsDirHandle(false);
      for await (const name of assetsDir.keys()){
        if(name.indexOf('shots_' + shot.id + '_')===0 || name.indexOf(pid()+'_shots_'+shot.id)===0) await assetsDir.removeEntry(name);
      }
    } catch(err){}
  }
}

// Generic version of the above, for a generated Look/Location/Prop image (not a shot) —
// same protection against a provider's temp-hosting link expiring later.
async function persistGeneratedAssetImage(item, catKey, fieldKey, resultUrl){
  if(!item || !item.id || !resultUrl) return;
  try{
    const assetKey = pid() + ':' + catKey + ':' + item.id + ':' + fieldKey;
    let fileName, blob;
    if(resultUrl.indexOf('data:')===0){
      blob = dataUrlToBlobSync(resultUrl);
      fileName = await persistBlobAsset(assetKey, blob, extFromDataUrl(resultUrl));
    } else {
      const result = await persistRemoteImageAsset(assetKey, resultUrl);
      fileName = result.fileName;
      blob = result.blob;
    }
    const url = URL.createObjectURL(blob);
    item[fieldKey] = url;
    item._assetFiles = item._assetFiles || {};
    item._assetFiles[fieldKey] = fileName;
    console.log('[ProjectStore] saved generated ' + fieldKey + ' locally for "' + item.name + '" (' + catKey + ')');
  } catch(err){
    console.warn('[ProjectStore] could not save generated image locally, keeping the provider link only (it may expire later):', err);
    item[fieldKey] = resultUrl;
  }
  if(typeof saveProjectSoon==='function') saveProjectSoon();
}
async function restoreGeneratedAssetImage(item, catKey, fieldKey, assetsDirHandle){
  if(!item._assetFiles || !(fieldKey in item._assetFiles)) return true; // nothing saved locally
  const assetKey = pid() + ':' + catKey + ':' + item.id + ':' + fieldKey;
  const url = await loadImageAsset(assetKey, item._assetFiles[fieldKey], assetsDirHandle);
  if(url){ item[fieldKey] = url; return true; }
  return false;
}
async function deleteGeneratedAssetImage(item, catKey, fieldKey){
  if(!item._assetFiles || !(fieldKey in item._assetFiles)) return;
  const assetKey = pid() + ':' + catKey + ':' + item.id + ':' + fieldKey;
  try{ await idbDelete(STORE_ASSETS, assetKey); } catch(err){}
  if(diskDirHandle){
    try{
      const assetsDir = await getAssetsDirHandle(false);
      for await (const name of assetsDir.keys()){
        if(name.indexOf(catKey + '_' + item.id + '_')===0 || name.indexOf(pid()+'_'+catKey+'_'+item.id)===0) await assetsDir.removeEntry(name);
      }
    } catch(err){}
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

// Lets the user pick a folder for the CURRENT project (used both from the New Project
// dialog and from the "Save to disk folder" button while already working on a project).
// Always just WRITES current state into the chosen folder — never loads from it — so
// re-picking a folder mid-session can never silently clobber live work.
async function chooseDiskFolder(){
  if(!SUPPORTS_DISK_FOLDER) return false;
  let handle;
  try{
    handle = await window.showDirectoryPicker({ mode:'readwrite' });
  } catch(err){
    return false; // user cancelled the picker
  }
  diskDirHandle = handle;
  await idbSet(STORE_HANDLES, pid(), handle);
  await migrateAssetsToDisk();
  await saveProjectNow();
  const meta = await idbGet(STORE_PROJECT_META, pid());
  if(meta){ meta.storage = 'disk'; meta.folderName = handle.name; await saveProjectMeta(meta); }
  updateFolderButton();
  return true;
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
function wireFolderButton(){
  const btn = document.getElementById('connectFolderBtn');
  if(!btn) return;
  btn.onclick = ()=> chooseDiskFolder().then(updateFolderButton);
}

// ============================================================
// Serialize / restore the whole app state for the CURRENT project.
// Fast and cheap on purpose: no binary data ever passes through here, just plain JSON.
// ============================================================
function serializeProject(){
  const categoriesOut = state.categories.map(cat=>({
    key: cat.key, name: cat.name, icon: cat.icon, addType: cat.addType, collapsed: cat.collapsed,
    items: cat.items.map(item=>{
      const copy = JSON.parse(JSON.stringify(item));
      if(cat.key==='music') delete copy.audioUrl; // never persisted inline — see persistAudioAsset
      if(cat.key==='band'){
        if(copy.angleSlots) Object.keys(copy.angleSlots).forEach(k=>{ copy.angleSlots[k] = null; });
        copy.turnaroundSheet = null;
        copy.photo = null; // reconstructed from angleSlots.front on restore
      }
      if(cat.key==='locations'){
        if(copy._assetFiles && ('photo' in copy._assetFiles)) copy.photo = null;
        else if(copy.photo && copy.photo.indexOf('data:')===0) copy.photo = null;
        if(copy.angles) copy.angles = copy.angles.map(a => (a && a.indexOf('data:')===0) ? null : a);
      }
      if(cat.key==='props'){
        if(copy._assetFiles && ('photo' in copy._assetFiles)) copy.photo = null;
        else if(copy.photo && copy.photo.indexOf('data:')===0) copy.photo = null;
        if(copy.angles) copy.angles = copy.angles.map(a => (a && a.indexOf('data:')===0) ? null : a);
      }
      if(cat.key==='looks'){
        if(copy._assetFiles && ('previewImage' in copy._assetFiles)) copy.previewImage = null;
      }
      return copy;
    }),
  }));
  const scenesOut = JSON.parse(JSON.stringify(state.scenes)).map((scene)=>{
    const liveScene = state.scenes.find(s=> s.id===scene.id);
    scene.shots = (scene.shots||[]).map((shot)=>{
      const liveShot = liveScene && liveScene.shots.find(sh=> sh.id===shot.id);
      if(liveShot && liveShot._assetFiles && ('preview' in liveShot._assetFiles)) shot.previewImage = null;
      return shot;
    });
    return scene;
  });
  return {
    version: 3,
    savedAt: Date.now(),
    projectMeta: JSON.parse(JSON.stringify(state.projectMeta)),
    categories: categoriesOut,
    scenes: scenesOut,
    timelineAudio: state.timelineAudio ? JSON.parse(JSON.stringify(state.timelineAudio)) : null,
    focus: Object.assign({}, focus),
    timelineMode: timelineMode,
    playheadX: playheadX,
    taskQueue: JSON.parse(JSON.stringify(state.taskQueue || [])),
    seq: { sceneSeq, shotSeq, paletteSeq, charSeq, locSeq, trackSeq, lookSeq, propSeq, draftTaskSeq },
  };
}

async function applyProjectData(data, verbose){
  if(!data) return false;
  let hadErrors = false;
  const musicCat = data.categories && data.categories.find(c=>c.key==='music');
  if(musicCat && musicCat.items.length){
    if(verbose) logLoadingStep('Restoring ' + musicCat.items.length + ' music track(s)…');
    for(const item of musicCat.items){
      try{
        const blob = await loadAudioAsset(item.id, item.diskFileName);
        item.audioUrl = blob ? URL.createObjectURL(blob) : null;
        if(!blob) hadErrors = true;
        if(verbose) logLoadingStep('Music "' + item.name + '"' + (blob ? ' — audio found' : ' — AUDIO FILE NOT FOUND'), blob ? 'ok' : 'error');
      } catch(err){
        item.audioUrl = null;
        hadErrors = true;
        if(verbose) logLoadingStep('Music "' + item.name + '" — error: ' + err.message, 'error');
      }
    }
  }
  const bandCat = data.categories && data.categories.find(c=>c.key==='band');
  if(bandCat && bandCat.items.length){
    if(verbose) logLoadingStep('Restoring ' + bandCat.items.length + ' character(s)…');
    for(const item of bandCat.items){
      try{
        const result = await restoreCharacterImages(item);
        if(result.missing.length) hadErrors = true;
        if(verbose){
          const label = 'Character "' + item.name + '" — ' + result.found + '/' + result.total + ' image(s) restored';
          logLoadingStep(label, result.missing.length ? 'error' : 'ok');
          if(result.missing.length) logLoadingStep('   missing: ' + result.missing.join(', '), 'error');
        }
      } catch(err){
        hadErrors = true;
        if(verbose) logLoadingStep('Character "' + item.name + '" — error: ' + err.message, 'error');
      }
    }
  }
  const locCat = data.categories && data.categories.find(c=>c.key==='locations');
  if(locCat && locCat.items.length){
    if(verbose) logLoadingStep('Restoring ' + locCat.items.length + ' location(s)…');
    for(const item of locCat.items){
      try{
        const result = await restoreLocationImages(item);
        if(result.missing.length) hadErrors = true;
        if(verbose){
          const label = 'Location "' + item.name + '" — ' + result.found + '/' + result.total + ' image(s) restored';
          logLoadingStep(label, result.missing.length ? 'error' : 'ok');
          if(result.missing.length) logLoadingStep('   missing: ' + result.missing.join(', '), 'error');
        }
      } catch(err){
        hadErrors = true;
        if(verbose) logLoadingStep('Location "' + item.name + '" — error: ' + err.message, 'error');
      }
    }
  }
  const propCat = data.categories && data.categories.find(c=>c.key==='props');
  if(propCat && propCat.items.length){
    if(verbose) logLoadingStep('Restoring ' + propCat.items.length + ' prop(s)…');
    for(const item of propCat.items){
      try{
        const result = await restorePropImages(item);
        if(result.missing.length) hadErrors = true;
        if(verbose){
          const label = 'Prop "' + item.name + '" — ' + result.found + '/' + result.total + ' image(s) restored';
          logLoadingStep(label, result.missing.length ? 'error' : 'ok');
          if(result.missing.length) logLoadingStep('   missing: ' + result.missing.join(', '), 'error');
        }
      } catch(err){
        hadErrors = true;
        if(verbose) logLoadingStep('Prop "' + item.name + '" — error: ' + err.message, 'error');
      }
    }
  }
  const looksCatData = data.categories && data.categories.find(c=>c.key==='looks');
  if(looksCatData){
    for(const item of looksCatData.items){
      if(item._assetFiles && ('previewImage' in item._assetFiles)){
        try{ await restoreGeneratedAssetImage(item, 'looks', 'previewImage'); }
        catch(err){ hadErrors = true; }
      }
    }
  }
  state.categories = data.categories || state.categories;
  state.scenes = data.scenes || [];
  state.timelineAudio = data.timelineAudio || null;
  state.projectMeta = data.projectMeta || state.projectMeta;
  state.taskQueue = data.taskQueue || [];

  let shotPreviewCount = 0, shotPreviewRestored = 0;
  for(const scene of state.scenes){
    for(const shot of (scene.shots||[])){
      if(shot._assetFiles && ('preview' in shot._assetFiles)){
        shotPreviewCount++;
        try{
          const ok = await restoreShotPreviewImage(shot);
          if(ok) shotPreviewRestored++; else hadErrors = true;
        } catch(err){ hadErrors = true; }
      }
    }
  }
  if(shotPreviewCount && verbose){
    logLoadingStep('Restored ' + shotPreviewRestored + '/' + shotPreviewCount + ' saved shot preview(s)', shotPreviewRestored===shotPreviewCount ? 'ok' : 'error');
  }

  focus = data.focus || { sceneId:null, shotId:null };
  timelineMode = data.timelineMode || 'assembly';
  playheadX = data.playheadX || 0;
  PROJECT_FPS = (state.projectMeta && state.projectMeta.fps) || 25;
  if(data.seq){
    sceneSeq = data.seq.sceneSeq || 1;
    shotSeq = data.seq.shotSeq || 1;
    paletteSeq = data.seq.paletteSeq || 0;
    charSeq = data.seq.charSeq || 1;
    locSeq = data.seq.locSeq || 1;
    trackSeq = data.seq.trackSeq || 1;
    propSeq = data.seq.propSeq || 1;
    lookSeq = data.seq.lookSeq || 1;
    draftTaskSeq = data.seq.draftTaskSeq || 1;
  }
  applyProjectFrame();
  renderAssets();
  renderTimelineScenes();
  refreshMainPreview();
  return hadErrors;
}

// ============================================================
// Save orchestration + autosave (JSON only — assets are handled separately)
// ============================================================
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
  if(!currentProjectId) return;
  state.projectMeta.updatedAt = Date.now();
  const data = serializeProject();
  if(diskDirHandle){
    try{
      await writeProjectToDisk(diskDirHandle, data);
      lastSavedJSON = JSON.stringify(data);
      await touchProjectMeta();
      console.log('[ProjectStore] saved to disk folder "' + diskDirHandle.name + '"');
      return;
    } catch(err){
      console.warn('[ProjectStore] Disk save failed, falling back to browser storage:', err);
    }
  }
  await idbSet(STORE_PROJECT, currentProjectId, data);
  lastSavedJSON = JSON.stringify(data);
  await touchProjectMeta();
  console.log('[ProjectStore] saved to browser storage (IndexedDB)');
}
async function touchProjectMeta(){
  try{
    const meta = await idbGet(STORE_PROJECT_META, currentProjectId);
    if(meta){
      meta.updatedAt = Date.now();
      meta.name = state.projectMeta.name;
      await saveProjectMeta(meta);
    }
  } catch(err){}
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
  if(!currentProjectId) return;
  let data;
  try{ data = serializeProject(); }
  catch(err){ console.warn('[ProjectStore] Autosave: could not serialize project:', err); return; }
  const json = JSON.stringify(data);
  if(json === lastSavedJSON) return; // nothing actually changed since the last save
  setSaveStatus('saving');
  try{
    if(diskDirHandle){
      try{ await writeProjectToDisk(diskDirHandle, data); }
      catch(err){ console.warn('[ProjectStore] Disk save failed, falling back to browser storage:', err); await idbSet(STORE_PROJECT, currentProjectId, data); }
    } else {
      await idbSet(STORE_PROJECT, currentProjectId, data);
    }
    lastSavedJSON = json;
    await touchProjectMeta();
    setSaveStatus('saved');
  } catch(err){
    setSaveStatus('error');
    console.warn('[ProjectStore] Autosave failed:', err);
  }
}

// Final safety net: save (cheap now — JSON only) when the tab is hidden/closed.
let exitSaveWired = false;
function wireExitSave(){
  if(exitSaveWired) return;
  exitSaveWired = true;
  document.addEventListener('visibilitychange', ()=>{
    if(document.visibilityState === 'hidden') saveProjectNow();
  });
  window.addEventListener('pagehide', ()=> saveProjectNow());
}

// ============================================================
// Visible loading/diagnostic screen — replaces silent console.warn with something the
// user can actually read and screenshot without opening DevTools.
// ============================================================
function logLoadingStep(text, status){
  console.log('[ProjectStore] ' + text);
  const log = document.getElementById('loadingLog');
  if(!log) return;
  const line = document.createElement('div');
  line.className = 'loading-line ' + (status || 'info');
  const dotChar = status==='ok' ? '✓' : status==='error' ? '✗' : '·';
  line.innerHTML = '<span class="dot3">' + dotChar + '</span><span class="msg"></span>';
  line.querySelector('.msg').textContent = text;
  log.appendChild(line);
  log.scrollTop = log.scrollHeight;
}
function showLoadingScreen(){
  const screen = document.getElementById('loadingScreen');
  if(screen){ screen.classList.remove('hidden'); }
  const log = document.getElementById('loadingLog');
  if(log) log.innerHTML = '';
  const btn = document.getElementById('loadingContinueBtn');
  if(btn) btn.style.display = 'none';
}
function finishLoadingScreen(hadErrors){
  const btn = document.getElementById('loadingContinueBtn');
  const screen = document.getElementById('loadingScreen');
  if(btn) btn.style.display = '';
  if(btn) btn.onclick = ()=>{ if(screen) screen.classList.add('hidden'); };
  if(!hadErrors && screen){
    setTimeout(()=> screen.classList.add('hidden'), 900);
  }
}

// ============================================================
// Startup: resume the last active project directly if there is one, otherwise show the
// home screen (project list). Returns true if a project was opened.
// ============================================================
async function initProjectStore(){
  const lastId = await getLastActiveProjectId();
  if(!lastId){
    return false;
  }
  showLoadingScreen();
  logLoadingStep('Opening your last project…');
  const ok = await openProject(lastId, true);
  logLoadingStep(ok ? 'Done.' : 'Could not fully restore this project (see above).', ok ? 'ok' : 'error');
  finishLoadingScreen(!ok);
  return ok;
}
