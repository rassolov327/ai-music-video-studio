// ---------- /TV persistence: single-workspace disk-folder + IndexedDB ----------
// Mirrors js/persistence.js's own two-backend idea (IndexedDB always works; a real disk
// folder via the File System Access API is an opt-in upgrade — Chrome/Edge only), but
// scoped to ONE ongoing /TV workspace instead of TAKE:ONE's multi-project system: there's
// no "New Project" picker here, just one continuously running show.
const TV_DB_NAME = 'ai_tv_studio_db';
const TV_DB_VERSION = 1;
const TV_STORE_WORKSPACE = 'tvWorkspace'; // single key 'tv' -> whole JSON snapshot
const TV_STORE_HANDLE = 'tvHandle';       // single key 'tv' -> FileSystemDirectoryHandle
const TV_STORE_ASSETS = 'tvAssets';       // keyed by asset id -> Blob

const TV_SUPPORTS_DISK_FOLDER = ('showDirectoryPicker' in window) && (()=>{
  try{ return window.self === window.top; } catch(err){ return false; }
})();

let tvDiskDirHandle = null;
let tvPendingReconnectHandle = null; // a stored handle whose permission needs a real click to re-grant
let tvAutosaveTimer = null;
let tvLastSavedJSON = null;

// ---- IndexedDB plumbing ----
function tvOpenDB(){
  return new Promise((resolve, reject)=>{
    const req = indexedDB.open(TV_DB_NAME, TV_DB_VERSION);
    req.onupgradeneeded = (e)=>{
      const db = e.target.result;
      if(!db.objectStoreNames.contains(TV_STORE_WORKSPACE)) db.createObjectStore(TV_STORE_WORKSPACE);
      if(!db.objectStoreNames.contains(TV_STORE_HANDLE)) db.createObjectStore(TV_STORE_HANDLE);
      if(!db.objectStoreNames.contains(TV_STORE_ASSETS)) db.createObjectStore(TV_STORE_ASSETS);
    };
    req.onsuccess = ()=> resolve(req.result);
    req.onerror = ()=> reject(req.error);
  });
}
async function tvIdbGet(store, key){
  const db = await tvOpenDB();
  return new Promise((resolve, reject)=>{
    const tx = db.transaction(store, 'readonly');
    const req = tx.objectStore(store).get(key);
    req.onsuccess = ()=> resolve(req.result);
    req.onerror = ()=> reject(req.error);
  });
}
async function tvIdbSet(store, key, value){
  const db = await tvOpenDB();
  return new Promise((resolve, reject)=>{
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).put(value, key);
    tx.oncomplete = ()=> resolve();
    tx.onerror = ()=> reject(tx.error);
  });
}

// ---- disk folder (File System Access API) ----
async function tvGetAssetsDirHandle(create){
  if(!tvDiskDirHandle) return null;
  return tvDiskDirHandle.getDirectoryHandle('assets', { create: !!create });
}
async function tvWriteToDisk(dirHandle, data){
  const fileHandle = await dirHandle.getFileHandle('tv-project.json', { create:true });
  const writable = await fileHandle.createWritable();
  await writable.write(JSON.stringify(data));
  await writable.close();
}
async function tvReadFromDisk(dirHandle){
  try{
    const fileHandle = await dirHandle.getFileHandle('tv-project.json');
    const file = await fileHandle.getFile();
    return JSON.parse(await file.text());
  } catch(err){
    return null; // empty/fresh folder — no tv-project.json yet
  }
}
function tvFolderSvg(){
  return '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:5px;vertical-align:-2px;"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>';
}
function tvUpdateFolderButton(){
  const btn = document.getElementById('tvConnectFolderBtn');
  if(!btn) return;
  if(!TV_SUPPORTS_DISK_FOLDER){ btn.style.display = 'none'; return; }
  btn.style.display = '';
  if(tvDiskDirHandle){
    btn.innerHTML = tvFolderSvg() + 'Сохранено в «' + tvDiskDirHandle.name + '» · сменить';
    btn.title = 'Хранится в папке "' + tvDiskDirHandle.name + '" на диске';
  } else if(tvPendingReconnectHandle){
    btn.innerHTML = tvFolderSvg() + 'Переподключить папку';
    btn.title = 'Разрешение на папку нужно подтвердить заново';
  } else {
    btn.innerHTML = tvFolderSvg() + 'Сохранить в папку на диске';
    btn.title = 'Хранить /TV как настоящие файлы на диске';
  }
}
// ---- migrate already-uploaded/generated assets into a newly connected folder ----
// Anything persisted before a folder was connected only ever reached IndexedDB's blob
// store — tvPersistBlobAsset still records a fileName for it (so tvSerialize/tvLoadBlobAsset
// behave the same either way), but no actual file exists on disk yet. Connecting a folder
// later must not silently strand that older material in browser storage — this copies every
// asset-backed field's real bytes into the folder's assets/ subfolder for real.
async function tvCopyAssetToDisk(assetKey, fileName){
  if(!fileName) return false;
  try{
    const blob = await tvIdbGet(TV_STORE_ASSETS, assetKey);
    if(!blob) return false; // nothing in IndexedDB — already disk-only, or never existed
    const assetsDir = await tvGetAssetsDirHandle(true);
    const fileHandle = await assetsDir.getFileHandle(fileName, { create:true });
    const writable = await fileHandle.createWritable();
    await writable.write(blob);
    await writable.close();
    return true;
  } catch(err){
    console.warn('[tv-persistence] could not migrate asset to disk', assetKey, err);
    return false;
  }
}
async function tvMigrateAssetsToDisk(){
  if(!tvDiskDirHandle) return;
  for(const anchor of tvState.tvAnchors){
    if(!anchor._assetFiles) continue;
    if(anchor._assetFiles.photo) await tvCopyAssetToDisk('anchor:' + anchor.id + ':photo', anchor._assetFiles.photoFile);
    if(anchor._assetFiles.sheet) await tvCopyAssetToDisk('anchor:' + anchor.id + ':sheet', anchor._assetFiles.sheetFile);
  }
  for(const studio of tvState.tvStudios){
    if(!studio._assetFiles) continue;
    for(const key of TV_STUDIO_ANGLE_KEYS){
      if(studio._assetFiles['angle_' + key]){
        await tvCopyAssetToDisk('studio:' + studio.id + ':angle:' + key, studio._assetFiles['angle_' + key + 'File']);
      }
    }
  }
  for(const newsItem of tvState.tvNewsItems){
    if(newsItem._assetFiles && newsItem._assetFiles.voice){
      await tvCopyAssetToDisk('newsitem:' + newsItem.id + ':voice', newsItem._assetFiles.voiceFile);
    }
    if(newsItem._assetFiles && Array.isArray(newsItem._assetFiles.media)){
      for(const entry of newsItem._assetFiles.media){
        await tvCopyAssetToDisk('newsitem:' + newsItem.id + ':media:' + entry.id, entry.fileName);
      }
    }
  }
  for(const block of tvState.tvGridBlocks){
    if(block._assetFiles && block._assetFiles.voice){
      await tvCopyAssetToDisk('gridblock:' + block.id + ':voice', block._assetFiles.voiceFile);
    }
  }
}

// Always just WRITES current state into the freshly chosen folder — never loads from it —
// so re-picking a folder mid-session can never silently clobber live work. Existing assets
// get migrated in (see tvMigrateAssetsToDisk above) before the project JSON is written, so
// the file names it references already exist for real by the time the write happens.
async function tvChooseDiskFolder(){
  if(!TV_SUPPORTS_DISK_FOLDER) return false;
  let handle;
  try{
    handle = await window.showDirectoryPicker({ mode:'readwrite' });
  } catch(err){
    return false; // user cancelled the picker
  }
  tvDiskDirHandle = handle;
  tvPendingReconnectHandle = null;
  await tvIdbSet(TV_STORE_HANDLE, 'tv', handle);
  await tvMigrateAssetsToDisk();
  await tvSaveNow();
  tvUpdateFolderButton();
  return true;
}
// A stored handle's permission doesn't survive a reload — browsers only grant
// requestPermission() from a real, immediate click, so this exists as its own function
// the folder button calls directly when a reconnect is pending, rather than reusing
// chooseDiskFolder's picker flow.
async function tvReconnectFolder(){
  if(!tvPendingReconnectHandle) return false;
  try{
    const perm = await tvPendingReconnectHandle.requestPermission({ mode:'readwrite' });
    if(perm!=='granted') return false;
    tvDiskDirHandle = tvPendingReconnectHandle;
    tvPendingReconnectHandle = null;
    const data = await tvReadFromDisk(tvDiskDirHandle);
    if(data) await tvApplyWorkspaceData(data);
    tvUpdateFolderButton();
    return true;
  } catch(err){
    console.warn('[tv-persistence] reconnect failed:', err);
    return false;
  }
}
// Single entry point the folder button's onclick calls — picks the right action depending
// on whether a reconnect is pending.
async function tvHandleFolderButtonClick(){
  if(tvPendingReconnectHandle) return tvReconnectFolder();
  return tvChooseDiskFolder();
}

// ---- blob assets (anchor photos, generated Character Card sheets, ...) ----
function tvExtFromMime(mime){
  if(!mime) return '.png';
  if(mime.indexOf('jpeg')>=0) return '.jpg';
  if(mime.indexOf('png')>=0) return '.png';
  if(mime.indexOf('webp')>=0) return '.webp';
  if(mime.indexOf('gif')>=0) return '.gif';
  if(mime.indexOf('wav')>=0) return '.wav';
  if(mime.indexOf('mpeg')>=0 || mime.indexOf('mp3')>=0) return '.mp3';
  return '.png';
}
async function tvPersistBlobAsset(assetKey, blob, ext){
  if(tvDiskDirHandle){
    try{
      const assetsDir = await tvGetAssetsDirHandle(true);
      const fileName = assetKey.replace(/[:]/g,'_') + ext;
      const fileHandle = await assetsDir.getFileHandle(fileName, { create:true });
      const writable = await fileHandle.createWritable();
      await writable.write(blob);
      await writable.close();
      return fileName;
    } catch(err){ console.warn('[tv-persistence] could not write asset to disk:', err); }
  }
  await tvIdbSet(TV_STORE_ASSETS, assetKey, blob);
  return null;
}
async function tvLoadBlobAsset(assetKey, fileName){
  if(tvDiskDirHandle && fileName){
    try{
      const assetsDir = await tvGetAssetsDirHandle(false);
      const fileHandle = await assetsDir.getFileHandle(fileName);
      const file = await fileHandle.getFile();
      return URL.createObjectURL(file);
    } catch(err){ /* fall through to IndexedDB */ }
  }
  try{
    const blob = await tvIdbGet(TV_STORE_ASSETS, assetKey);
    if(blob) return URL.createObjectURL(blob);
  } catch(err){}
  return null;
}
// Downloads a KIE-hosted (temporary) URL once and keeps a durable local copy — same
// reasoning TAKE:ONE applies to every remote generation, since provider URLs expire.
async function tvPersistRemoteImageAsset(assetKey, remoteUrl){
  try{
    const res = await fetch('/api/proxy-image?url=' + encodeURIComponent(remoteUrl));
    if(!res.ok) return null;
    const blob = await res.blob();
    const ext = tvExtFromMime(blob.type);
    const fileName = (await tvPersistBlobAsset(assetKey, blob, ext)) || (assetKey.replace(/[:]/g,'_') + ext);
    return { url: URL.createObjectURL(blob), fileName };
  } catch(err){
    console.warn('[tv-persistence] could not persist remote image', assetKey, err);
    return null;
  }
}
// When the caller already has a real Blob in hand (e.g. straight from a fetch() response,
// like /api/tv/generate-voice's audio bytes) — skips the fetch(dataOrBlobUrl) round trip
// tvPersistLocalImageAsset needs, so there's no data:-URL CSP concern here at all.
async function tvPersistBlobAssetDirect(assetKey, blob, ext){
  try{
    const fileName = (await tvPersistBlobAsset(assetKey, blob, ext || tvExtFromMime(blob.type))) || (assetKey.replace(/[:]/g,'_') + (ext || tvExtFromMime(blob.type)));
    return { url: URL.createObjectURL(blob), fileName };
  } catch(err){
    console.warn('[tv-persistence] could not persist blob asset', assetKey, err);
    return null;
  }
}
// A locally-uploaded photo (data:/blob: URL from a <input type=file>) — same treatment.
async function tvPersistLocalImageAsset(assetKey, dataOrBlobUrl){
  try{
    const blob = await (await fetch(dataOrBlobUrl)).blob();
    const ext = tvExtFromMime(blob.type);
    const fileName = (await tvPersistBlobAsset(assetKey, blob, ext)) || (assetKey.replace(/[:]/g,'_') + ext);
    return { url: URL.createObjectURL(blob), fileName };
  } catch(err){
    console.warn('[tv-persistence] could not persist local image', assetKey, err);
    return null;
  }
}

// ---- save status pill ----
function tvSetSaveStatus(status){
  const el = document.getElementById('tvSaveStatus');
  if(!el) return;
  el.classList.remove('saving','saved','error');
  if(status==='saving'){ el.textContent = 'Сохранение…'; el.classList.add('saving'); }
  else if(status==='saved'){ el.textContent = 'Сохранено'; el.classList.add('saved'); }
  else if(status==='error'){ el.textContent = 'Ошибка сохранения'; el.classList.add('error'); }
  else { el.textContent = ''; }
}

// ---- serialize / save ----
// Same idea as serializeProject() in persistence.js: binary/blob-backed fields never go
// into the JSON snapshot directly (they're already written as separate assets via
// tvPersistBlobAsset at the moment they're captured/generated) — `_assetFiles` marks which
// fields are file-backed so tvApplyWorkspaceData() knows what to re-hydrate on load.
function tvSerialize(){
  const anchors = tvState.tvAnchors.map(a=>{
    const copy = JSON.parse(JSON.stringify(a));
    if(copy._assetFiles && copy._assetFiles.photo) copy.photo = null;
    if(copy._assetFiles && copy._assetFiles.sheet && copy.card && copy.card.images && copy.card.images.sheet){
      copy.card.images.sheet.url = null;
    }
    delete copy._pending;
    if(copy.card) delete copy.card._pending;
    return copy;
  });
  const studios = tvState.tvStudios.map(s=>{
    const copy = JSON.parse(JSON.stringify(s));
    if(copy.angles){
      Object.keys(copy.angles).forEach(k=>{
        if(copy._assetFiles && copy._assetFiles['angle_' + k]) copy.angles[k] = null;
      });
    }
    return copy;
  });
  const newsItems = tvState.tvNewsItems.map(n=>{
    const hasVoiceAsset = n._assetFiles && n._assetFiles.voice;
    const hasMediaAssets = n._assetFiles && Array.isArray(n._assetFiles.media) && n._assetFiles.media.length;
    if(!hasVoiceAsset && !hasMediaAssets) return n;
    const copy = JSON.parse(JSON.stringify(n));
    if(hasVoiceAsset) copy.voiceUrl = null;
    if(hasMediaAssets){
      const localIds = new Set(n._assetFiles.media.map(m=> m.id));
      copy.media = (copy.media||[]).map(m=> localIds.has(m.id) ? Object.assign({}, m, { url:null }) : m);
    }
    return copy;
  });
  const gridBlocks = tvState.tvGridBlocks.map(b=>{
    if(!b._assetFiles || !b._assetFiles.voice) return b;
    const copy = JSON.parse(JSON.stringify(b));
    copy.voiceUrl = null;
    return copy;
  });
  return {
    version: 1,
    savedAt: Date.now(),
    tvAnchors: anchors,
    tvStudios: studios,
    tvNewsItems: newsItems,
    tvGridBlocks: gridBlocks,
    tvTaskQueue: tvState.tvTaskQueue,
    tvArchive: tvState.tvArchive,
    tvAnniversaryEvents: tvState.tvAnniversaryEvents,
    tvEpisode: tvState.tvEpisode,
    approvals: tvState.approvals,
    tvNewsSourceSelection: tvState.tvNewsSourceSelection,
    tvOwedToUsers: tvState.tvOwedToUsers,
    seq: { tvAnchorSeq, tvStudioSeq, tvNewsItemSeq, tvGridBlockSeq, tvTaskSeq, tvArchiveSeq },
  };
}
async function tvSaveNow(){
  const data = tvSerialize();
  if(tvDiskDirHandle){
    try{
      await tvWriteToDisk(tvDiskDirHandle, data);
      tvLastSavedJSON = JSON.stringify(data);
      tvSetSaveStatus('saved');
      return;
    } catch(err){
      console.warn('[tv-persistence] disk save failed, falling back to IndexedDB:', err);
    }
  }
  await tvIdbSet(TV_STORE_WORKSPACE, 'tv', data);
  tvLastSavedJSON = JSON.stringify(data);
  tvSetSaveStatus('saved');
}
// Diff-before-write, like autosaveTick() — avoids a "Saving…" flicker when nothing
// actually changed since the last tick.
async function tvAutosaveTick(){
  let data;
  try{ data = tvSerialize(); } catch(err){ console.warn('[tv-persistence] could not serialize workspace:', err); return; }
  const json = JSON.stringify(data);
  if(json===tvLastSavedJSON) return;
  tvSetSaveStatus('saving');
  try{
    if(tvDiskDirHandle){
      try{ await tvWriteToDisk(tvDiskDirHandle, data); }
      catch(err){ console.warn('[tv-persistence] disk save failed, falling back to IndexedDB:', err); await tvIdbSet(TV_STORE_WORKSPACE, 'tv', data); }
    } else {
      await tvIdbSet(TV_STORE_WORKSPACE, 'tv', data);
    }
    tvLastSavedJSON = json;
    tvSetSaveStatus('saved');
  } catch(err){
    tvSetSaveStatus('error');
    console.warn('[tv-persistence] autosave failed:', err);
  }
}
// Forces an immediate save instead of waiting for the next periodic tick — call after
// especially meaningful actions (saving an anchor, a card finishing generation...).
function tvSaveSoon(){ tvAutosaveTick(); }
function tvStartAutosave(){
  if(tvAutosaveTimer) clearInterval(tvAutosaveTimer);
  tvAutosaveTimer = setInterval(tvAutosaveTick, 3000);
  window.addEventListener('visibilitychange', ()=>{ if(document.visibilityState==='hidden') tvSaveNow(); });
  window.addEventListener('pagehide', ()=> tvSaveNow());
}

// ---- load ----
async function tvRestoreAnchorAssets(anchor){
  if(anchor._assetFiles && anchor._assetFiles.photo){
    const url = await tvLoadBlobAsset('anchor:' + anchor.id + ':photo', anchor._assetFiles.photoFile);
    if(url) anchor.photo = url;
  }
  if(anchor._assetFiles && anchor._assetFiles.sheet && anchor.card && anchor.card.images && anchor.card.images.sheet){
    const url = await tvLoadBlobAsset('anchor:' + anchor.id + ':sheet', anchor._assetFiles.sheetFile);
    if(url) anchor.card.images.sheet.url = url;
  }
}
async function tvRestoreStudioAssets(studio){
  if(!studio.angles) return;
  for(const key of TV_STUDIO_ANGLE_KEYS){
    if(studio._assetFiles && studio._assetFiles['angle_' + key]){
      const url = await tvLoadBlobAsset('studio:' + studio.id + ':angle:' + key, studio._assetFiles['angle_' + key + 'File']);
      if(url) studio.angles[key] = url;
    }
  }
}
async function tvRestoreNewsItemVoiceAsset(newsItem){
  if(newsItem._assetFiles && newsItem._assetFiles.voice){
    const url = await tvLoadBlobAsset('newsitem:' + newsItem.id + ':voice', newsItem._assetFiles.voiceFile);
    if(url) newsItem.voiceUrl = url;
  }
}
// Manually-uploaded photos on a hand-added news item (see tvOpenManualNewsForm, js/tv-app.js)
// — same asset-backed treatment as the voice recording, keyed per-photo since a news item
// can carry any number of them.
async function tvRestoreNewsItemMediaAssets(newsItem){
  if(!newsItem._assetFiles || !Array.isArray(newsItem._assetFiles.media) || !Array.isArray(newsItem.media)) return;
  for(const entry of newsItem._assetFiles.media){
    const m = newsItem.media.find(x=> x.id===entry.id);
    if(!m) continue;
    const url = await tvLoadBlobAsset('newsitem:' + newsItem.id + ':media:' + entry.id, entry.fileName);
    if(url) m.url = url;
  }
}
async function tvRestoreGridBlockVoiceAsset(block){
  if(block._assetFiles && block._assetFiles.voice){
    const url = await tvLoadBlobAsset('gridblock:' + block.id + ':voice', block._assetFiles.voiceFile);
    if(url) block.voiceUrl = url;
  }
}
async function tvApplyWorkspaceData(data){
  if(Array.isArray(data.tvAnchors)) tvState.tvAnchors = data.tvAnchors;
  if(Array.isArray(data.tvStudios)) tvState.tvStudios = data.tvStudios;
  if(Array.isArray(data.tvNewsItems)) tvState.tvNewsItems = data.tvNewsItems;
  if(Array.isArray(data.tvGridBlocks)) tvState.tvGridBlocks = data.tvGridBlocks;
  if(Array.isArray(data.tvTaskQueue)) tvState.tvTaskQueue = data.tvTaskQueue;
  if(Array.isArray(data.tvArchive)) tvState.tvArchive = data.tvArchive;
  if(Array.isArray(data.tvAnniversaryEvents)) tvState.tvAnniversaryEvents = data.tvAnniversaryEvents;
  if(data.tvEpisode) tvState.tvEpisode = data.tvEpisode;
  if(data.approvals) Object.assign(tvState.approvals, data.approvals);
  if(data.tvNewsSourceSelection) Object.assign(tvState.tvNewsSourceSelection, data.tvNewsSourceSelection);
  if(typeof data.tvOwedToUsers === 'number') tvState.tvOwedToUsers = data.tvOwedToUsers;
  if(data.seq){
    tvAnchorSeq = Math.max(tvAnchorSeq, data.seq.tvAnchorSeq || 1);
    tvStudioSeq = Math.max(tvStudioSeq, data.seq.tvStudioSeq || 1);
    tvNewsItemSeq = Math.max(tvNewsItemSeq, data.seq.tvNewsItemSeq || 1);
    tvGridBlockSeq = Math.max(tvGridBlockSeq, data.seq.tvGridBlockSeq || 1);
    tvTaskSeq = Math.max(tvTaskSeq, data.seq.tvTaskSeq || 1);
    tvArchiveSeq = Math.max(tvArchiveSeq, data.seq.tvArchiveSeq || 1);
  }
  for(const anchor of tvState.tvAnchors) await tvRestoreAnchorAssets(anchor);
  for(const studio of tvState.tvStudios) await tvRestoreStudioAssets(studio);
  for(const newsItem of tvState.tvNewsItems){ await tvRestoreNewsItemVoiceAsset(newsItem); await tvRestoreNewsItemMediaAssets(newsItem); }
  for(const block of tvState.tvGridBlocks) await tvRestoreGridBlockVoiceAsset(block);
  if(typeof renderTvAnchors==='function') renderTvAnchors();
  if(typeof renderTvStudios==='function') renderTvStudios();
  if(typeof renderTvNewsPickers==='function') renderTvNewsPickers();
  if(typeof renderTvRedaktsiya==='function') renderTvRedaktsiya();
  if(typeof renderTvMic==='function') renderTvMic();
  if(typeof renderTvTasks==='function') renderTvTasks();
  if(typeof renderTvGrid==='function') renderTvGrid();
  if(typeof tvSyncOwedInput==='function') tvSyncOwedInput();
  if(typeof tvRenderCreditsIndicator==='function') tvRenderCreditsIndicator();
}
async function tvLoadWorkspace(){
  if(TV_SUPPORTS_DISK_FOLDER){
    try{
      const handle = await tvIdbGet(TV_STORE_HANDLE, 'tv');
      if(handle){
        const perm = await handle.queryPermission({ mode:'readwrite' });
        if(perm==='granted') tvDiskDirHandle = handle;
        else tvPendingReconnectHandle = handle;
      }
    } catch(err){ console.warn('[tv-persistence] could not check folder handle:', err); }
  }

  let data = null;
  if(tvDiskDirHandle) data = await tvReadFromDisk(tvDiskDirHandle);
  if(!data) data = await tvIdbGet(TV_STORE_WORKSPACE, 'tv');
  if(data) await tvApplyWorkspaceData(data);

  tvLastSavedJSON = JSON.stringify(tvSerialize());
  tvUpdateFolderButton();
}
