// ---------- Project export / import (whole-project ZIP, for backup and moving between machines) ----------

let JSZipLib = null;
async function ensureJSZipLoaded(){
  if(JSZipLib) return JSZipLib;
  const mod = await import('https://cdn.jsdelivr.net/npm/jszip@3.10.1/+esm');
  JSZipLib = mod.default || mod;
  return JSZipLib;
}

function extFromBlobType(mime){
  const map = {
    'image/png':'.png', 'image/jpeg':'.jpg', 'image/webp':'.webp', 'image/gif':'.gif',
    'video/mp4':'.mp4', 'video/webm':'.webm', 'video/quicktime':'.mov',
    'audio/mpeg':'.mp3', 'audio/mp4':'.m4a', 'audio/wav':'.wav', 'audio/ogg':'.ogg',
  };
  return map[mime] || '';
}

// Loads an already-persisted image/video asset's raw bytes, reusing the existing
// disk-then-IndexedDB load logic rather than re-implementing asset lookup — loadImageAsset
// returns a blob: URL, which is then fetched back into an actual Blob for the zip.
async function loadAssetBlobForExport(assetKey, fileName){
  try{
    const url = await loadImageAsset(assetKey, fileName);
    if(!url) return null;
    return await (await fetch(url)).blob();
  } catch(err){
    console.warn('[export] could not load asset for export:', assetKey, err);
    return null;
  }
}

// Walks the whole live project and returns every locally-persisted asset as
// { assetKey, exportPath } — export writes each one's actual bytes into the zip at
// exportPath; import reverses this by writing each zip entry back under the same kind of
// key, scoped to the newly-created project's own id.
function collectProjectAssetRefs(){
  const refs = [];
  function fromAssetFiles(catKey, itemId, assetFilesMap){
    if(!assetFilesMap) return;
    Object.keys(assetFilesMap).forEach(fieldKey=>{
      refs.push({ assetKey: pid()+':'+catKey+':'+itemId+':'+fieldKey, fileName: assetFilesMap[fieldKey], exportPath: `assets/${catKey}/${itemId}/${fieldKey}` });
    });
  }
  function fromCardSheet(catKey, itemId, item){
    if(item.card && item.card.images && item.card.images.sheet && item.card.images.sheet.ok){
      refs.push({ assetKey: pid()+':'+catKey+':'+itemId+':cardout:sheet', fileName: item.card.images.sheet.assetFile, exportPath: `assets/${catKey}/${itemId}/cardout-sheet` });
    }
  }

  const bandCat = state.categories.find(c=>c.key==='band');
  (bandCat ? bandCat.items : []).forEach(c=>{ fromAssetFiles('band', c.id, c._assetFiles); fromCardSheet('band', c.id, c); });
  const locCat = state.categories.find(c=>c.key==='locations');
  (locCat ? locCat.items : []).forEach(l=>{ fromAssetFiles('locations', l.id, l._assetFiles); fromCardSheet('locations', l.id, l); });
  const propCat = state.categories.find(c=>c.key==='props');
  (propCat ? propCat.items : []).forEach(p=>{ fromAssetFiles('props', p.id, p._assetFiles); fromCardSheet('props', p.id, p); });
  const looksCat = state.categories.find(c=>c.key==='looks');
  (looksCat ? looksCat.items : []).forEach(lk=> fromAssetFiles('looks', lk.id, lk._assetFiles));
  (state.archive||[]).forEach(entry=> fromAssetFiles('archive', entry.id, entry._assetFiles));

  state.scenes.forEach(scene=>{
    (scene.shots||[]).forEach(shot=>{
      if(shot._assetFiles && ('preview' in shot._assetFiles)){
        refs.push({ assetKey: pid()+':shots:'+shot.id, fileName: shot._assetFiles.preview, exportPath: `assets/shots/${shot.id}/preview` });
      }
      if(shot._assetFiles && ('video' in shot._assetFiles)){
        refs.push({ assetKey: pid()+':shots:'+shot.id+':video', fileName: shot._assetFiles.video, exportPath: `assets/shots/${shot.id}/video` });
      }
    });
  });

  return refs;
}

// Reverses an export path back into the IndexedDB key the asset needs to live under for
// the freshly-created project — mirrors collectProjectAssetRefs()'s path scheme exactly.
function parseAssetExportPath(path){
  const rel = path.replace(/^assets\//, '');
  const parts = rel.split('/');
  if(parts.length===2 && parts[0]==='music'){
    return { kind:'music', trackId: parts[1].replace(/\.[^./]+$/, '') };
  }
  if(parts.length===3){
    const [catKey, itemId, fieldWithExt] = parts;
    const field = fieldWithExt.replace(/\.[^./]+$/, '');
    if(catKey==='shots') return { kind:'shot', itemId, field }; // 'preview' or 'video'
    if(field==='cardout-sheet') return { kind:'cardsheet', catKey, itemId };
    return { kind:'field', catKey, itemId, field };
  }
  return null;
}

async function importProjectFromZip(file){
  try{
    const JSZip = await ensureJSZipLoaded();
    const zip = await JSZip.loadAsync(file);
    const projectJsonEntry = zip.file('project.json');
    if(!projectJsonEntry) throw new Error('This doesn\'t look like an exported project file — no project.json inside.');
    const projectJson = JSON.parse(await projectJsonEntry.async('string'));
    const meta = projectJson.projectMeta || {};

    // Ask where this project should live going forward — same choice any disk-backed
    // project already has, just surfaced right at import time instead of as a separate
    // later step. Asked before the loading screen since it's an interactive prompt, not
    // loading work.
    let folderHandle = null;
    if('showDirectoryPicker' in window){
      if(confirm('Choose a folder to save this project to on your disk?\n\nCancel keeps it in browser storage instead (like a normal new project).')){
        try{ folderHandle = await window.showDirectoryPicker({ mode:'readwrite' }); }
        catch(err){ /* user cancelled the picker — fall back to browser storage */ }
      }
    }

    // Same screen sequence the normal New Project flow uses — hide the home screen, show
    // the loading overlay (with step-by-step log, since import genuinely has several
    // stages), and reveal the finished project the same way at the end. Without this the
    // import was completing correctly in the background but the home screen just stayed
    // on screen the whole time, looking like nothing had happened.
    hideHomeScreen();
    showLoadingScreen();
    logLoadingStep('Reading project file…');

    // Registers a fresh project (new id, added to the project list).
    await createProject({
      name: (meta.name || 'Imported Project') + ' (imported)',
      format: meta.format, width: meta.width, height: meta.height, fps: meta.fps,
      folderHandle,
    });
    logLoadingStep('Project created — restoring assets…');

    // Write every asset the zip contains — via persistBlobAsset, so it actually respects
    // the disk-vs-browser-storage choice just made — under keys scoped to the NEW
    // project's own id, before restoring the project data that references them. When disk
    // mode is used, the resulting filename differs from whatever was recorded in the
    // original export, so each item's own reference gets corrected to match.
    const assetPaths = Object.keys(zip.files).filter(p=> p.startsWith('assets/') && !zip.files[p].dir);
    let assetsRestored = 0;
    for(const path of assetPaths){
      const parsed = parseAssetExportPath(path);
      if(!parsed) continue;
      const blob = await zip.file(path).async('blob');
      const extMatch = path.match(/\.[^./]+$/);
      const ext = extFromBlobType(blob.type) || (extMatch ? extMatch[0] : '');

      let key = null;
      if(parsed.kind==='music') key = pid()+':music:'+parsed.trackId;
      else if(parsed.kind==='shot') key = parsed.field==='video' ? (pid()+':shots:'+parsed.itemId+':video') : (pid()+':shots:'+parsed.itemId);
      else if(parsed.kind==='cardsheet') key = pid()+':'+parsed.catKey+':'+parsed.itemId+':cardout:sheet';
      else if(parsed.kind==='field') key = pid()+':'+parsed.catKey+':'+parsed.itemId+':'+parsed.field;
      if(!key) continue;

      const fileName = await persistBlobAsset(key, blob, ext);
      assetsRestored++;

      if(parsed.kind==='music'){
        const musicCat = projectJson.categories.find(c=> c.key==='music');
        const track = musicCat && musicCat.items.find(t=> t.id===parsed.trackId);
        if(track && fileName) track.diskFileName = fileName;
      } else if(parsed.kind==='shot'){
        const scene = (projectJson.scenes||[]).find(sc=> (sc.shots||[]).some(sh=> sh.id===parsed.itemId));
        const shot = scene && scene.shots.find(sh=> sh.id===parsed.itemId);
        if(shot){
          shot._assetFiles = shot._assetFiles || {};
          shot._assetFiles[parsed.field] = fileName || true;
        }
      } else if(parsed.kind==='cardsheet'){
        const cat = projectJson.categories.find(c=> c.key===parsed.catKey);
        const item = cat && cat.items.find(x=> x.id===parsed.itemId);
        if(item && item.card && item.card.images && item.card.images.sheet){
          item.card.images.sheet.assetFile = fileName || null;
        }
      } else if(parsed.kind==='field'){
        const item = parsed.catKey==='archive'
          ? (projectJson.archive || []).find(x=> x.id===parsed.itemId)
          : (()=>{ const cat = projectJson.categories.find(c=> c.key===parsed.catKey); return cat && cat.items.find(x=> x.id===parsed.itemId); })();
        if(item){
          item._assetFiles = item._assetFiles || {};
          item._assetFiles[parsed.field] = fileName || true;
        }
      }
    }
    logLoadingStep('Restored ' + assetsRestored + ' asset(s).', 'ok');

    // Now that every asset is in place, restore the actual project content the same way
    // opening any saved project already does.
    await applyProjectData(projectJson, true);
    await saveProjectNow();
    logLoadingStep('Done.', 'ok');
    finishLoadingScreen(false);
    updateFolderButton();
    updateProjTitleDisplay();
  } catch(err){
    console.error('[import] failed:', err);
    const loadingScreen = document.getElementById('loadingScreen');
    if(loadingScreen && !loadingScreen.classList.contains('hidden')){
      logLoadingStep('Import failed: ' + err.message, 'error');
      finishLoadingScreen(true);
    } else {
      alert('Could not import that project: ' + err.message);
    }
  }
}


async function exportProjectToZip(){
  if(!currentProjectId){ alert('Open a project first.'); return; }
  try{
    await saveProjectNow(); // make sure what's exported matches what's actually on screen
    const JSZip = await ensureJSZipLoaded();
    const zip = new JSZip();

    const projectJson = serializeProject();
    zip.file('project.json', JSON.stringify(projectJson));

    // Images/video/card sheets — generic catKey/id/fieldKey assets
    const refs = collectProjectAssetRefs();
    for(const ref of refs){
      const blob = await loadAssetBlobForExport(ref.assetKey, ref.fileName);
      if(blob) zip.file(ref.exportPath + extFromBlobType(blob.type), blob);
    }

    // Music tracks — separate load path (loadAudioAsset returns the blob directly, no URL step)
    const musicCat = state.categories.find(c=>c.key==='music');
    for(const track of (musicCat ? musicCat.items : [])){
      try{
        const blob = await loadAudioAsset(track.id, track.diskFileName);
        if(blob) zip.file(`assets/music/${track.id}` + extFromBlobType(blob.type || 'audio/mpeg'), blob);
      } catch(err){
        console.warn('[export] could not load music track for export:', track.id, err);
      }
    }

    const zipBlob = await zip.generateAsync({ type:'blob', compression:'DEFLATE', compressionOptions:{ level:6 } });
    const url = URL.createObjectURL(zipBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = (state.projectMeta.name || 'project').replace(/[^a-z0-9]+/gi, '_') + '.zip';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(()=> URL.revokeObjectURL(url), 5000);
  } catch(err){
    console.error('[export] failed:', err);
    alert('Could not export the project: ' + err.message);
  }
}
