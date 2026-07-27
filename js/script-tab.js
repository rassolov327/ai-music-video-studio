// ---------- SCRIPT tab ----------
let scriptSelectedItem = null; // { type: 'character'|'location'|'prop'|'look'|'scene'|'shot', id, sceneId? }

function wireScriptPage(){
  const textEl = document.getElementById('scriptTextInput');
  // Paste as plain text only — a contenteditable div would otherwise happily accept
  // formatted HTML from the clipboard, which we never want here.
  textEl.addEventListener('paste', (e)=>{
    e.preventDefault();
    const text = (e.clipboardData || window.clipboardData).getData('text/plain');
    document.execCommand('insertText', false, text);
  });
  textEl.addEventListener('input', ()=>{
    state.script.text = textEl.innerText;
    if(typeof saveProjectSoon==='function') saveProjectSoon();
  });

  document.getElementById('scriptAnalyzeBtn').onclick = runScriptAnalysis;
  document.getElementById('scriptExportBtn').onclick = exportScriptToProject;
  document.getElementById('scriptClearBtn').onclick = clearScriptTab;
}

function clearScriptTab(){
  if(state.script.text || state.script.proposal){
    if(!confirm('Clear the script text and the proposed breakdown? This only affects this tab — nothing already exported to the project is touched.')) return;
  }
  state.script = { text:'', proposal:null };
  scriptSelectedItem = null;
  renderScriptPageIfNeeded();
  if(typeof saveProjectSoon==='function') saveProjectSoon();
}

function renderScriptPageIfNeeded(){
  const textEl = document.getElementById('scriptTextInput');
  if(textEl && textEl.innerText !== state.script.text && document.activeElement!==textEl){
    textEl.innerText = state.script.text || '';
  }
  updateScriptStatusHint();
  renderScriptTree();
  if(!scriptSelectedItem) renderScriptInspector(null, null);
}

function updateScriptStatusHint(){
  const hint = document.getElementById('scriptStatusHint');
  const exportBtn = document.getElementById('scriptExportBtn');
  if(!hint || !exportBtn) return;
  const p = state.script.proposal;
  if(!p){ hint.textContent = ''; exportBtn.disabled = true; return; }
  const counts = [
    p.scenes.length + ' scene(s)',
    p.characters.length + ' character(s)',
    p.locations.length + ' location(s)',
    p.props.length + ' prop(s)',
    p.looks.length + ' look(s)',
  ];
  hint.textContent = counts.join(', ');
  exportBtn.disabled = false;
}

// ---------- Analyze ----------
async function runScriptAnalysis(){
  const scriptText = (document.getElementById('scriptTextInput').innerText || '').trim();
  if(!scriptText){ alert('Paste a script first.'); return; }
  const btn = document.getElementById('scriptAnalyzeBtn');
  btn.disabled = true; btn.textContent = 'Analyzing…';
  try{
    const bandCat = state.categories.find(c=> c.key==='band');
    const existingCharacterNames = bandCat ? bandCat.items.map(c=> c.name) : [];
    let songDurationSec = null;
    if(state.timelineAudio && state.timelineAudio.trackId){
      const musicCat = state.categories.find(c=> c.key==='music');
      const track = musicCat && musicCat.items.find(t=> t.id===state.timelineAudio.trackId);
      if(track && track.duration) songDurationSec = Math.round(track.duration);
    }
    const res = await fetch('/api/assist/analyze-script', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        scriptText, existingCharacterNames,
        shotSizes: typeof SHOT_SIZES!=='undefined' ? SHOT_SIZES : undefined,
        cameraMoves: typeof CAMERA_MOVES!=='undefined' ? CAMERA_MOVES : undefined,
        songDurationSec,
      }),
    });
    const data = await res.json().catch(()=> null);
    if(!res.ok || !data || !data.proposal) throw new Error((data && data.message) || 'Could not analyze the script.');
    mergeNewProposal(data.proposal);
    state.script.text = scriptText;
    renderScriptTree();
    updateScriptStatusHint();
    if(typeof saveProjectSoon==='function') saveProjectSoon();
  } catch(err){
    alert('Could not analyze the script: ' + err.message);
  } finally {
    btn.disabled = false; btn.textContent = 'Analyze';
  }
}

// Merges a fresh analysis into the current draft, matched by name. An item the user hasn't
// touched since the last analysis is simply replaced with the new version; an item the user
// HAS edited is left alone and just flagged as "differs from the latest analysis" (a small
// dot in the tree) rather than silently overwritten — same spirit as the add/replace/keep
// rule agreed for the real project export, one step earlier in the process.
function mergeNewProposal(fresh){
  const old = state.script.proposal;
  function mergeList(oldList, freshList, extraFields){
    oldList = oldList || [];
    const byName = new Map(oldList.map(it=> [it.name.toLowerCase(), it]));
    return freshList.map(f=>{
      const existing = byName.get((f.name||'').toLowerCase());
      if(existing && existing.edited){
        return { ...existing, staleFromAnalysis: !shallowEqualIgnoring(existing, f, ['id','edited','staleFromAnalysis']) };
      }
      const base = { id: 'sp' + (scriptItemSeq++), edited:false, staleFromAnalysis:false, ...f };
      return base;
    });
  }
  function shallowEqualIgnoring(a, b, ignore){
    const keys = new Set([...Object.keys(a), ...Object.keys(b)].filter(k=> !ignore.includes(k)));
    for(const k of keys){ if(JSON.stringify(a[k])!==JSON.stringify(b[k])) return false; }
    return true;
  }

  const characters = mergeList(old && old.characters, fresh.characters || []);
  const locations = mergeList(old && old.locations, fresh.locations || []);
  const props = mergeList(old && old.props, fresh.props || []);
  const looks = mergeList(old && old.looks, fresh.looks || []);

  const oldScenesByName = new Map((old && old.scenes || []).map(s=> [s.name.toLowerCase(), s]));
  const scenes = (fresh.scenes || []).map(fs=>{
    const existingScene = oldScenesByName.get((fs.name||'').toLowerCase());
    const sceneEdited = existingScene && existingScene.edited;
    const oldShotsByDesc = new Map((existingScene && existingScene.shots || []).map(sh=> [sh.description, sh]));
    const shots = (fs.shots || []).map(fsh=>{
      const existingShot = oldShotsByDesc.get(fsh.description);
      if(existingShot && existingShot.edited) return existingShot;
      return { id: 'sp' + (scriptItemSeq++), edited:false, ...fsh };
    });
    if(sceneEdited){
      return { ...existingScene, shots, staleFromAnalysis: !shallowEqualIgnoring({...existingScene, shots:undefined}, {...fs, shots:undefined}, ['id','edited','staleFromAnalysis','shots']) };
    }
    return { id: 'sp' + (scriptItemSeq++), edited:false, staleFromAnalysis:false, ...fs, shots };
  });

  state.script.proposal = { scenes, characters, locations, props, looks };
}

// ---------- Tree rendering ----------
function renderScriptTree(){
  const tree = document.getElementById('scriptTree');
  if(!tree) return;
  const p = state.script.proposal;
  if(!p){
    tree.innerHTML = `<div class="gen-hint" style="padding:14px;">Paste a script on the left and click Analyze — the proposed breakdown will show up here.</div>`;
    return;
  }
  const trashSvg = `<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"></path><path d="M10 11v6"></path><path d="M14 11v6"></path></svg>`;
  function renderFlatCat(title, list, type){
    if(!list.length) return '';
    return `<div class="script-cat-title">${title}</div>` + list.map(it=> `
      <div class="script-tree-item${scriptSelectedItem && scriptSelectedItem.type===type && scriptSelectedItem.id===it.id ? ' active':''}" data-type="${type}" data-id="${it.id}">
        <span>${it.name}</span>
        <span style="display:flex;align-items:center;gap:5px;">
          ${it.staleFromAnalysis ? '<span class="dirty-dot" title="Your edit differs from the latest analysis"></span>' : ''}
          <span class="script-tree-delete" data-del-type="${type}" data-del-id="${it.id}" title="Remove from proposal">${trashSvg}</span>
        </span>
      </div>`).join('');
  }
  let html = '';
  html += renderFlatCat('Characters', p.characters, 'character');
  html += renderFlatCat('Locations', p.locations, 'location');
  html += renderFlatCat('Props', p.props, 'prop');
  html += renderFlatCat('Looks', p.looks, 'look');
  if(p.scenes.length){
    html += `<div class="script-cat-title">Scenes</div>`;
    html += p.scenes.map(scene=>{
      const isSceneSelected = scriptSelectedItem && scriptSelectedItem.type==='scene' && scriptSelectedItem.id===scene.id;
      const shotsHtml = scene.shots.map((shot, idx)=> `
        <div class="script-tree-item${scriptSelectedItem && scriptSelectedItem.type==='shot' && scriptSelectedItem.id===shot.id ? ' active':''}" data-type="shot" data-id="${shot.id}" data-scene-id="${scene.id}">
          <span>Shot ${idx+1}</span>
          <span style="display:flex;align-items:center;gap:5px;">
            ${shot.staleFromAnalysis ? '<span class="dirty-dot"></span>' : ''}
            <span class="script-tree-delete" data-del-type="shot" data-del-id="${shot.id}" data-del-scene-id="${scene.id}" title="Remove this shot">${trashSvg}</span>
          </span>
        </div>`).join('');
      return `
        <div class="script-tree-item${isSceneSelected?' active':''}" data-type="scene" data-id="${scene.id}">
          <span>${scene.name}</span>
          <span style="display:flex;align-items:center;gap:5px;">
            ${scene.staleFromAnalysis ? '<span class="dirty-dot" title="Your edit differs from the latest analysis"></span>' : ''}
            <span class="script-tree-delete" data-del-type="scene" data-del-id="${scene.id}" title="Remove this scene and its shots">${trashSvg}</span>
          </span>
        </div>
        <div class="script-tree-shots">${shotsHtml}</div>`;
    }).join('');
  }
  tree.innerHTML = html;

  tree.querySelectorAll('.script-tree-item').forEach(el=>{
    el.onclick = (e)=>{
      if(e.target.closest('.script-tree-delete')) return;
      selectScriptItem(el.dataset.type, el.dataset.id, el.dataset.sceneId);
    };
  });
  tree.querySelectorAll('.script-tree-delete').forEach(el=>{
    el.onclick = (e)=>{
      e.stopPropagation();
      deleteScriptProposalItem(el.dataset.delType, el.dataset.delId, el.dataset.delSceneId);
    };
  });
}

// Removes an item straight from the draft proposal — this only ever touches the in-progress
// review, never the real project (nothing is exported yet).
function deleteScriptProposalItem(type, id, sceneId){
  const p = state.script.proposal;
  if(!p) return;
  const listByType = { character:'characters', location:'locations', prop:'props', look:'looks' };
  if(listByType[type]){
    p[listByType[type]] = p[listByType[type]].filter(it=> it.id!==id);
  } else if(type==='scene'){
    p.scenes = p.scenes.filter(s=> s.id!==id);
  } else if(type==='shot'){
    const scene = p.scenes.find(s=> s.id===sceneId) || p.scenes.find(s=> s.shots.some(sh=> sh.id===id));
    if(scene) scene.shots = scene.shots.filter(sh=> sh.id!==id);
  }
  if(scriptSelectedItem && scriptSelectedItem.type===type && scriptSelectedItem.id===id){
    scriptSelectedItem = null;
    renderScriptInspector(null, null);
    highlightNameInScriptText(null);
  }
  renderScriptTree();
  updateScriptStatusHint();
  if(typeof saveProjectSoon==='function') saveProjectSoon();
}

function findScriptItem(type, id, sceneId){
  const p = state.script.proposal;
  if(!p) return null;
  if(type==='character') return p.characters.find(x=>x.id===id);
  if(type==='location') return p.locations.find(x=>x.id===id);
  if(type==='prop') return p.props.find(x=>x.id===id);
  if(type==='look') return p.looks.find(x=>x.id===id);
  if(type==='scene') return p.scenes.find(x=>x.id===id);
  if(type==='shot'){
    const scene = p.scenes.find(s=>s.id===sceneId) || p.scenes.find(s=> s.shots.some(sh=>sh.id===id));
    return scene ? scene.shots.find(sh=>sh.id===id) : null;
  }
  return null;
}

function selectScriptItem(type, id, sceneId){
  scriptSelectedItem = { type, id, sceneId };
  renderScriptTree();
  const item = findScriptItem(type, id, sceneId);
  highlightNameInScriptText(item ? (item.name || null) : null);
  renderScriptInspector(type, item);
}

// Wraps every whole-word occurrence of `name` in the script text with a highlight span.
// Deliberately searches the ORIGINAL text itself rather than trusting Gemini to report
// exact character positions (which could drift if it paraphrases anything in its reply).
function highlightNameInScriptText(name){
  const el = document.getElementById('scriptTextInput');
  if(!el) return;
  const plainText = el.innerText;
  const escapedHtml = plainText.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  if(!name){
    el.innerHTML = escapedHtml;
    return;
  }
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp('\\b' + escaped + '\\b', 'gi');
  const highlighted = escapedHtml.replace(re, (m)=> `<mark class="script-highlight">${m}</mark>`);
  el.innerHTML = highlighted;
  const firstMark = el.querySelector('mark');
  if(firstMark) firstMark.scrollIntoView({ block:'center', behavior:'smooth' });
}

// ---------- Inspector ----------
function renderScriptInspector(type, item){
  const insp = document.getElementById('scriptInspector');
  if(!insp) return;
  if(!item){
    insp.innerHTML = `<div class="insp-tabs"><div class="insp-tab" style="cursor:default;">Inspector</div></div><div class="gen-hint" style="padding:14px;">Click a scene, shot, or asset on the left to see and edit its details here.</div>`;
    return;
  }
  const markEdited = ()=>{ item.edited = true; item.staleFromAnalysis = false; };

  if(type==='character' || type==='location' || type==='prop'){
    insp.innerHTML = `
      <div class="insp-tabs"><div class="insp-tab" style="cursor:default;">Inspector</div></div>
      <div style="padding:14px;">
        <div class="cf-field"><label>Name</label><input type="text" id="spName" value="${item.name}"></div>
        <div class="cf-field"><label>Description</label><textarea id="spDesc" style="min-height:100px;">${item.description||''}</textarea></div>
        ${type==='character' ? `<div class="cf-field"><label>Role</label><input type="text" id="spRole" value="${item.role||''}"></div>` : ''}
      </div>`;
    document.getElementById('spName').addEventListener('input', (e)=>{ item.name = e.target.value; markEdited(); renderScriptTree(); });
    document.getElementById('spDesc').addEventListener('input', (e)=>{ item.description = e.target.value; markEdited(); });
    const roleEl = document.getElementById('spRole');
    if(roleEl) roleEl.addEventListener('input', (e)=>{ item.role = e.target.value; markEdited(); });
  } else if(type==='look'){
    insp.innerHTML = `
      <div class="insp-tabs"><div class="insp-tab" style="cursor:default;">Inspector</div></div>
      <div style="padding:14px;">
        <div class="cf-field"><label>Name</label><input type="text" id="spName" value="${item.name}"></div>
        <div class="cf-field"><label>Character</label><input type="text" id="spChar" value="${item.characterName||''}"></div>
        <div class="cf-field"><label>Description</label><textarea id="spDesc" style="min-height:100px;">${item.description||''}</textarea></div>
      </div>`;
    document.getElementById('spName').addEventListener('input', (e)=>{ item.name = e.target.value; markEdited(); renderScriptTree(); });
    document.getElementById('spChar').addEventListener('input', (e)=>{ item.characterName = e.target.value; markEdited(); });
    document.getElementById('spDesc').addEventListener('input', (e)=>{ item.description = e.target.value; markEdited(); });
  } else if(type==='scene'){
    insp.innerHTML = `
      <div class="insp-tabs"><div class="insp-tab" style="cursor:default;">Inspector</div></div>
      <div style="padding:14px;">
        <div class="cf-field"><label>Scene name</label><input type="text" id="spName" value="${item.name}"></div>
        <div class="cf-field"><label>Location</label><input type="text" id="spLoc" value="${item.location||''}"></div>
        <div class="cf-field"><label>Time of day</label><input type="text" id="spTod" value="${item.timeOfDay||''}"></div>
        <div class="gen-hint">${item.shots.length} shot(s) proposed — click one on the left to edit it.</div>
      </div>`;
    document.getElementById('spName').addEventListener('input', (e)=>{ item.name = e.target.value; markEdited(); renderScriptTree(); });
    document.getElementById('spLoc').addEventListener('input', (e)=>{ item.location = e.target.value; markEdited(); });
    document.getElementById('spTod').addEventListener('input', (e)=>{ item.timeOfDay = e.target.value; markEdited(); });
  } else if(type==='shot'){
    const sizesOpts = (typeof SHOT_SIZES!=='undefined'?SHOT_SIZES:[]).map(s=> `<option ${item.shotSize===s?'selected':''}>${s}</option>`).join('');
    const movesOpts = (typeof CAMERA_MOVES!=='undefined'?CAMERA_MOVES:[]).map(s=> `<option ${item.cameraMove===s?'selected':''}>${s}</option>`).join('');
    insp.innerHTML = `
      <div class="insp-tabs"><div class="insp-tab" style="cursor:default;">Inspector</div></div>
      <div style="padding:14px;">
        <div class="cf-field"><label>Description</label><textarea id="spDesc" style="min-height:90px;">${item.description||''}</textarea></div>
        <div class="cf-field"><label>Shot size</label><select id="spSize">${sizesOpts}</select></div>
        <div class="cf-field"><label>Camera move</label><select id="spMove">${movesOpts}</select></div>
      </div>`;
    document.getElementById('spDesc').addEventListener('input', (e)=>{ item.description = e.target.value; markEdited(); });
    document.getElementById('spSize').addEventListener('change', (e)=>{ item.shotSize = e.target.value; markEdited(); });
    document.getElementById('spMove').addEventListener('change', (e)=>{ item.cameraMove = e.target.value; markEdited(); });
  }
}

// ---------- Export ----------
// Characters/Locations/Props/Looks are treated as a shared library: a name that already
// exists in the project is left completely untouched (never silently overwritten) — only
// genuinely new names get added. Scenes/shots are always appended as new timeline content,
// since a scene is a one-off piece of the story, not a reusable library entry.
async function exportScriptToProject(){
  const p = state.script.proposal;
  if(!p) return;
  if(!confirm('Export this breakdown into the project?\n\nExisting characters/locations/props/looks with matching names will be left untouched — only new ones are added. All proposed scenes will be appended to the timeline.')) return;

  const results = { charactersAdded:0, charactersSkipped:0, locationsAdded:0, locationsSkipped:0, propsAdded:0, propsSkipped:0, looksAdded:0, looksSkipped:0, scenesAdded:0, shotsAdded:0 };

  const bandCat = state.categories.find(c=>c.key==='band');
  for(const c of p.characters){
    if(bandCat.items.some(x=> x.name.toLowerCase()===c.name.toLowerCase())){ results.charactersSkipped++; continue; }
    bandCat.items.push({ id:'c'+(charSeq++), name:c.name, icon:'ti-user', role:c.role||'', description:c.description||'', photo:null });
    results.charactersAdded++;
  }
  const locCat = state.categories.find(c=>c.key==='locations');
  for(const l of p.locations){
    if(locCat.items.some(x=> x.name.toLowerCase()===l.name.toLowerCase())){ results.locationsSkipped++; continue; }
    locCat.items.push({ id:'l'+(locSeq++), name:l.name, icon:'ti-map-pin', live:false, photo:null, description:l.description||'', angles:[] });
    results.locationsAdded++;
  }
  const propCat = state.categories.find(c=>c.key==='props');
  for(const pr of p.props){
    if(propCat.items.some(x=> x.name.toLowerCase()===pr.name.toLowerCase())){ results.propsSkipped++; continue; }
    propCat.items.push({ id:'pr'+(propSeq++), name:pr.name, icon:'ti-package', live:false, photo:null, description:pr.description||'', angles:[] });
    results.propsAdded++;
  }
  const looksCat = state.categories.find(c=>c.key==='looks');
  for(const lk of p.looks){
    if(looksCat.items.some(x=> x.name.toLowerCase()===lk.name.toLowerCase())){ results.looksSkipped++; continue; }
    looksCat.items.push({ id:'lk'+(lookSeq++), name:lk.name, description:lk.description||'', previewImage:null, approved:false });
    results.looksAdded++;
  }

  for(const sc of p.scenes){
    const scene = { id:'s'+(sceneSeq++), name: sc.name, colorIdx: paletteSeq++, location: sc.location||'', timeOfDay: sc.timeOfDay||'', characters: [], props: [], lighting:'', shots: [] };
    for(const charName of (sc.characters||[])){
      const found = bandCat.items.find(x=> x.name.toLowerCase()===charName.toLowerCase());
      if(found) scene.characters.push({ characterId: found.id, lookId: null });
    }
    for(const propName of (sc.props||[])){
      const found = propCat.items.find(x=> x.name.toLowerCase()===propName.toLowerCase());
      if(found) scene.props.push(found.id);
    }
    for(const sh of (sc.shots||[])){
      scene.shots.push({ id:'sh'+(shotSeq++), name:'Shot '+(scene.shots.length+1), duration:5, description: sh.description||'', shotSize: sh.shotSize||'', cameraMove: sh.cameraMove||'' });
      results.shotsAdded++;
    }
    state.scenes.push(scene);
    results.scenesAdded++;
  }

  renderAssets();
  renderTimelineScenes();
  if(typeof saveProjectSoon==='function') saveProjectSoon();

  alert(
    'Exported:\n' +
    results.charactersAdded + ' character(s) added' + (results.charactersSkipped ? ', ' + results.charactersSkipped + ' already existed (kept as-is)' : '') + '\n' +
    results.locationsAdded + ' location(s) added' + (results.locationsSkipped ? ', ' + results.locationsSkipped + ' already existed' : '') + '\n' +
    results.propsAdded + ' prop(s) added' + (results.propsSkipped ? ', ' + results.propsSkipped + ' already existed' : '') + '\n' +
    results.looksAdded + ' look(s) added' + (results.looksSkipped ? ', ' + results.looksSkipped + ' already existed' : '') + '\n' +
    results.scenesAdded + ' scene(s) and ' + results.shotsAdded + ' shot(s) added to the timeline'
  );
}
