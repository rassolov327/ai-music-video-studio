// ---------- main timeline-synced preview ----------
// ---------- scene gallery (tile grid of shots, mirrors the character gallery) ----------
// ---------- scenes overview (tile grid of all scenes) ----------
function showScenesOverview(){
  pausePlayback();
  previewEl.classList.add('align-tl');
  previewEl.onclick = null;
  previewBarEl.textContent = 'Scenes';

  const tiles = state.scenes.map(scene=>{
    const col = sceneColor(scene);
    return `
      <div class="char-tile" data-scene-tile="${scene.id}">
        <div class="char-tile-photo" style="background:${col.thumb};">
          <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"></rect><circle cx="9" cy="11" r="2"></circle><path d="M21 16l-5-4-4 3-3-2-6 5"></path></svg>
          <div class="char-tile-del" data-del-scene-tile="${scene.id}" title="Remove">${trashSvg(13)}</div>
        </div>
        <div class="char-tile-name">${scene.name}</div>
        <div class="char-tile-role">${scene.shots.length} shot${scene.shots.length===1?'':'s'}</div>
      </div>`;
  }).join('');

  previewEl.innerHTML = `
    <div class="char-gallery">
      <div class="char-grid">
        ${tiles}
        <div class="char-tile char-tile-add" id="addSceneTileOverview">
          <div class="char-tile-photo">${plusSvg(26)}</div>
          <div class="char-tile-name">Add scene</div>
        </div>
      </div>
    </div>`;

  document.getElementById('addSceneTileOverview').onclick = ()=> addScene();
  previewEl.querySelectorAll('[data-del-scene-tile]').forEach(el=>{
    el.onclick = (e)=>{ e.stopPropagation(); deleteScene(el.dataset.delSceneTile); showScenesOverview(); };
  });
  previewEl.querySelectorAll('[data-scene-tile]').forEach(tile=>{
    tile.onclick = (e)=>{
      if(e.target.closest('.char-tile-del')) return;
      showSceneGallery(tile.dataset.sceneTile);
    };
  });
}

function showSceneGallery(sceneId){
  pausePlayback();
  const scene = state.scenes.find(s=>s.id===sceneId);
  if(!scene) return;
  previewEl.classList.add('align-tl');
  previewEl.onclick = null;
  previewBarEl.textContent = scene.name;
  focus = { sceneId, shotId: null };
  renderTimelineScenes();
  movePlayheadToFocus();
  positionPlayhead();
  wireTimelineDrag();

  function render(){
    const tiles = scene.shots.map(shot=>`
      <div class="char-tile" data-shot="${shot.id}">
        <div class="char-tile-photo">
          ${shot.previewImage ? `<img src="${shot.previewImage}" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;">` : '<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"></rect><circle cx="9" cy="11" r="2"></circle><path d="M21 16l-5-4-4 3-3-2-6 5"></path></svg>'}
          <div class="char-tile-del" data-del-shot="${shot.id}" title="Remove">${trashSvg(13)}</div>
        </div>
        <div class="char-tile-name" data-rename-shot="${shot.id}">${shot.name}</div>
        <div class="char-tile-role">${shot.duration}s</div>
      </div>
    `).join('');

    previewEl.innerHTML = `
      <div class="char-gallery">
        <div class="char-grid">
          ${tiles}
          <div class="char-tile char-tile-add" id="addShotTileScene">
            <div class="char-tile-photo">${plusSvg(26)}</div>
            <div class="char-tile-name">Add shot</div>
          </div>
        </div>
      </div>`;

    document.getElementById('addShotTileScene').onclick = ()=>{
      const shot = { id: 'sh' + (shotSeq++), name: 'Shot ' + (scene.shots.length + 1), duration: 5 };
      scene.shots.push(shot);
      focus = { sceneId, shotId: shot.id };
      renderTimelineScenes();
      renderAssets();
      render();
    };
    previewEl.querySelectorAll('[data-del-shot]').forEach(el=>{
      el.onclick = (e)=>{
        e.stopPropagation();
        scene.shots = scene.shots.filter(sh=>sh.id!==el.dataset.delShot);
        if(focus.shotId===el.dataset.delShot) focus = { sceneId, shotId:null };
        renderTimelineScenes();
        render();
      };
    });
    previewEl.querySelectorAll('[data-rename-shot]').forEach(el=>{
      el.onclick = (e)=>{
        e.stopPropagation();
        const shotId = el.dataset.renameShot;
        const shot = scene.shots.find(sh=>sh.id===shotId);
        if(!shot) return;
        const input = document.createElement('input');
        input.type = 'text';
        input.value = shot.name;
        input.className = 'scene-rename-input';
        el.replaceWith(input);
        input.focus();
        input.select();
        function commit(){
          shot.name = input.value.trim() || shot.name;
          renderTimelineScenes();
          render();
        }
        input.addEventListener('blur', commit);
        input.addEventListener('keydown', (ev)=>{ if(ev.key==='Enter') input.blur(); });
      };
    });
    previewEl.querySelectorAll('.char-tile:not(.char-tile-add)').forEach(tile=>{
      tile.onclick = (e)=>{
        if(e.target.closest('.char-tile-del') || e.target.closest('[data-rename-shot]')) return;
        focus = { sceneId, shotId: tile.dataset.shot };
        renderTimelineScenes();
        renderInspectorPanel();
      };
    });
  }
  render();
  renderInspectorPanel();
}

function refreshMainPreview(){
  if(typeof markProjectDirty==='function') markProjectDirty();
  previewEl.classList.remove('align-tl');
  previewEl.onclick = null;

  if(!focus.sceneId){
    previewBarEl.textContent = 'Preview';
    previewEl.innerHTML = `
      <div class="empty-preview">
        <i class="ti ti-clapperboard"></i>
        <div class="t1">${state.scenes.length===0 ? 'No scenes yet' : 'No shot selected'}</div>
        <div class="t2">${state.scenes.length===0 ? 'Add your first scene from the timeline below.' : 'Click a shot on the timeline to preview it.'}</div>
      </div>`;
    renderInspectorPanel();
    return;
  }

  const scene = state.scenes.find(s=>s.id===focus.sceneId);
  if(!scene){ focus = { sceneId:null, shotId:null }; return refreshMainPreview(); }
  const shot = focus.shotId ? scene.shots.find(sh=>sh.id===focus.shotId) : null;
  const col = sceneColor(scene);

  previewBarEl.textContent = shot ? `${scene.name} — ${shot.name}` : scene.name;

  if(shot && shot.previewImage){
    previewEl.innerHTML = `
      <div class="timeline-frame" style="border-color:transparent;">
        <img src="${shot.previewImage}">
        <span class="plabel" style="position:relative;z-index:1;color:#fff;background:rgba(0,0,0,.5);padding:3px 9px;border-radius:5px;align-self:flex-end;margin:10px;">${shot.name}</span>
      </div>`;
  } else {
    previewEl.innerHTML = `
      <div class="timeline-frame" style="background:${col.thumb};border-color:transparent;">
        <svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"></rect><circle cx="9" cy="11" r="2"></circle><path d="M21 16l-5-4-4 3-3-2-6 5"></path></svg>
        <span class="plabel" style="color:rgba(255,255,255,.75);">${shot ? shot.name + ' — awaiting generation' : (scene.shots.length + ' shot(s) — click the + on the timeline to add one')}</span>
      </div>`;
  }
  renderInspectorPanel();
}

const SHOT_SIZES = ['Detail Shot','Extreme Close-Up','Close-Up','Medium Close-Up','Medium Shot','Medium Wide Shot','Wide Shot','Extreme Wide Shot'];
const CAMERA_MOVES = ['Static','Push In','Pull Out','Steadicam','Crane'];

function renderSceneSettingsPanel(body, scene){
  const locCat = state.categories.find(c=>c.key==='locations');
  const locations = locCat ? locCat.items : [];
  const bandCat = state.categories.find(c=>c.key==='band');
  const characters = bandCat ? bandCat.items : [];
  const looksCat = state.categories.find(c=>c.key==='looks');
  const allLooks = looksCat ? looksCat.items : [];
  const TIME_OF_DAY = ['Morning','Day','Evening','Night'];

  if(!scene.characters) scene.characters = [];
  const availableChars = characters.filter(c=> !scene.characters.some(e=>e.characterId===c.id));

  const charRowsHtml = scene.characters.length===0
    ? `<div class="gen-hint" style="margin-top:0;">No characters in this scene yet.</div>`
    : scene.characters.map((entry, idx)=>{
        const c = characters.find(x=>x.id===entry.characterId);
        const charLooks = allLooks.filter(l=>l.approved);
        return `
          <div class="scene-char-row" data-idx="${idx}">
            <span class="scene-char-name">${c ? c.name : '(deleted)'}</span>
            <select class="scene-char-look" data-idx="${idx}">
              <option value="">${charLooks.length===0 ? 'No approved looks' : 'No look'}</option>
              ${charLooks.map(l=>`<option value="${l.id}" ${entry.lookId===l.id?'selected':''}>${l.name}</option>`).join('')}
            </select>
            <span class="scene-char-remove" data-idx="${idx}" title="Remove from scene">${trashSvg(12)}</span>
          </div>`;
      }).join('');

  const addRowHtml = characters.length===0
    ? `<div class="gen-hint" style="margin-top:6px;">No characters created yet — add one in Band / Characters.</div>`
    : availableChars.length===0
      ? ''
      : `<div class="scene-char-add-row">
          <select id="addCharacterSelect">
            ${availableChars.map(c=>`<option value="${c.id}">${c.name}</option>`).join('')}
          </select>
          <button class="cf-btn" id="addCharacterBtn">Add character</button>
        </div>`;

  body.innerHTML = `
    <div style="padding:14px;">
      <div class="cat-count" style="font-size:11px;margin-bottom:10px;">Scene settings</div>
      <div class="cf-field"><label>Name</label><input type="text" id="sceneNameInput" value="${scene.name}"></div>
      <div class="cf-field"><label>Location</label>
        <select id="sceneLocInput">
          <option value="">${locations.length===0 ? 'No locations yet' : 'Select location'}</option>
          ${locations.map(l=>`<option ${scene.location===l.name?'selected':''}>${l.name}</option>`).join('')}
        </select>
      </div>
      <div class="cf-field"><label>Time of day</label>
        <select id="sceneTimeInput">
          <option value="">Select time of day</option>
          ${TIME_OF_DAY.map(t=>`<option ${scene.timeOfDay===t?'selected':''}>${t}</option>`).join('')}
        </select>
      </div>
      <div class="cf-field"><label>Description</label>
        <textarea id="sceneDescInput" style="min-height:80px;" placeholder="What happens in this scene...">${scene.description||''}</textarea>
      </div>

      <div class="field-group">
        <div class="field-group-title">Characters in this scene</div>
        <div id="sceneCharList">${charRowsHtml}</div>
        ${addRowHtml}
        <div class="gen-hint" style="margin-top:8px;">Every shot in this scene automatically uses these characters and looks — set once here so nothing drifts shot to shot.</div>
      </div>
    </div>`;

  document.getElementById('sceneNameInput').addEventListener('input', (e)=>{
    scene.name = e.target.value;
    renderTimelineScenes();
    renderAssets();
    previewBarEl.textContent = scene.name;
  });
  document.getElementById('sceneLocInput').addEventListener('change', (e)=>{ scene.location = e.target.value; });
  document.getElementById('sceneTimeInput').addEventListener('change', (e)=>{ scene.timeOfDay = e.target.value; });
  document.getElementById('sceneDescInput').addEventListener('input', (e)=>{ scene.description = e.target.value; });

  const addBtn = document.getElementById('addCharacterBtn');
  if(addBtn){
    addBtn.onclick = ()=>{
      const sel = document.getElementById('addCharacterSelect');
      if(!sel || !sel.value) return;
      scene.characters.push({ characterId: sel.value, lookId: null });
      renderSceneSettingsPanel(body, scene);
    };
  }
  body.querySelectorAll('.scene-char-look').forEach(sel=>{
    sel.addEventListener('change', (e)=>{
      const idx = parseInt(e.target.dataset.idx, 10);
      scene.characters[idx].lookId = e.target.value || null;
    });
  });
  body.querySelectorAll('.scene-char-remove').forEach(btn=>{
    btn.addEventListener('click', (e)=>{
      const idx = parseInt(e.target.closest('[data-idx]').dataset.idx, 10);
      scene.characters.splice(idx,1);
      renderSceneSettingsPanel(body, scene);
    });
  });
}

function renderInspectorPanel(){
  const body = document.getElementById('inspBody');
  if(!body) return;

  if(!focus.sceneId){
    body.innerHTML = `<div class="insp-empty">No shot selected.<br>Create a scene and a shot to see its parameters here.</div>`;
    return;
  }
  const scene = state.scenes.find(s=>s.id===focus.sceneId);
  if(!scene){ body.innerHTML = `<div class="insp-empty">No shot selected.</div>`; return; }

  if(!focus.shotId){
    renderSceneSettingsPanel(body, scene);
    return;
  }
  const shot = scene.shots.find(sh=>sh.id===focus.shotId);
  if(!shot){ body.innerHTML = `<div class="insp-empty">No shot selected.</div>`; return; }
  if(!scene.characters) scene.characters = [];

  const bandCat = state.categories.find(c=>c.key==='band');
  const characters = bandCat ? bandCat.items : [];
  const looksCat = state.categories.find(c=>c.key==='looks');
  const allLooks = looksCat ? looksCat.items : [];

  const sceneCharHtml = scene.characters.length===0
    ? `<div class="gen-hint" style="margin-top:0;">No characters in this scene yet.</div>`
    : scene.characters.map(entry=>{
        const c = characters.find(x=>x.id===entry.characterId);
        const look = entry.lookId ? allLooks.find(l=>l.id===entry.lookId) : null;
        return `<div class="char-row checked" style="cursor:default;">${c ? c.name : '(deleted)'}${look ? ` <span style="color:var(--text-3);">— ${look.name}</span>` : ''}</div>`;
      }).join('');

  body.innerHTML = `
    <div style="padding:14px;">
      <div class="cat-count" style="font-size:11px;margin-bottom:10px;">${scene.name}</div>
      <div class="cf-field"><label>Name</label><input type="text" id="shotNameInput" value="${shot.name}"></div>
      <div class="cf-field"><label>Duration (sec)</label><input type="number" id="shotDurInput" min="0.5" step="0.1" value="${shot.duration}"></div>

      <div class="field-group">
        <div class="field-group-title">Characters <span style="font-weight:400;color:var(--text-3);">— inherited from scene</span></div>
        <div class="char-list">${sceneCharHtml}</div>
        <button class="cf-btn" id="jumpToSceneBtn" style="margin-top:8px;width:100%;">Edit in Scene settings</button>
      </div>

      <div class="cf-field"><label>Shot size</label>
        <select id="shotSizeInput">
          <option value="">Select shot size</option>
          ${SHOT_SIZES.map(s=>`<option ${shot.shotSize===s?'selected':''}>${s}</option>`).join('')}
        </select>
      </div>
      <div class="cf-field"><label>Camera movement</label>
        <select id="shotMoveInput">
          <option value="">Select movement</option>
          ${CAMERA_MOVES.map(s=>`<option ${shot.cameraMove===s?'selected':''}>${s}</option>`).join('')}
        </select>
      </div>
      <div class="cf-field"><label>Lighting</label>
        <input type="text" id="shotLightInput" placeholder="e.g. low key, back light, blue rim" value="${shot.lighting||''}">
      </div>
      <div class="cf-field"><label>Description <span style="color:var(--text-3);font-weight:400;">— prompt for AI generation</span></label>
        <textarea id="shotDescInput" style="min-height:90px;" placeholder="Describe exactly what should happen in this shot...">${shot.description||''}</textarea>
      </div>

      <div class="gen-section" id="shotGenSection"></div>
    </div>`;

  renderShotGenSection(scene, shot);

  document.getElementById('jumpToSceneBtn').onclick = ()=> setFocus(scene.id, null);
  document.getElementById('shotNameInput').addEventListener('input', (e)=>{
    shot.name = e.target.value;
    renderTimelineScenes();
    previewBarEl.textContent = scene.name + ' — ' + shot.name;
  });
  document.getElementById('shotDurInput').addEventListener('input', (e)=>{
    shot.duration = parseFloat(e.target.value) || shot.duration;
    renderTimelineScenes();
  });
  document.getElementById('shotSizeInput').addEventListener('change', (e)=>{ shot.shotSize = e.target.value; });
  document.getElementById('shotMoveInput').addEventListener('change', (e)=>{ shot.cameraMove = e.target.value; });
  document.getElementById('shotLightInput').addEventListener('input', (e)=>{ shot.lighting = e.target.value; });
  document.getElementById('shotDescInput').addEventListener('input', (e)=>{ shot.description = e.target.value; });
}

function renderShotGenSection(scene, shot){
  const section = document.getElementById('shotGenSection');
  if(!section) return;

  if(shot.previewImage){
    section.innerHTML = `
      <div class="shot-preview-thumb"><img src="${shot.previewImage}"></div>
      <button class="cf-btn" id="shotRegenBtn" style="width:100%;">Regenerate preview <span class="gen-cost">${SHOT_GEN_COST_LABEL}</span></button>`;
    document.getElementById('shotRegenBtn').onclick = ()=> runShotGeneration(scene, shot);
  } else {
    section.innerHTML = `
      <button class="gen-btn" id="shotGenBtn">Generate preview <span class="gen-cost">${SHOT_GEN_COST_LABEL}</span></button>
      <div class="gen-hint">Generates a preview frame (via ${SHOT_GEN_MODEL_LABEL}) from this shot's parameters. Shown here, on the timeline thumbnail, and in the main preview.</div>`;
    document.getElementById('shotGenBtn').onclick = ()=> runShotGeneration(scene, shot);
  }
}

function runShotGeneration(scene, shot){
  const section = document.getElementById('shotGenSection');
  if(!section) return;
  section.innerHTML = `<button class="gen-btn" disabled><span class="gen-spin"></span>Generating…</button>`;
  const prompt = buildShotPrompt(shot, scene);
  tryLoadImage(buildPollinationsUrl(prompt, 640, 360))
    .catch(()=> generateShotPreviewImage(shot, scene))
    .then((result)=>{
      shot.previewImage = result;
      renderTimelineScenes();
      if(focus.sceneId===scene.id && focus.shotId===shot.id) refreshMainPreview();
      else renderShotGenSection(scene, shot);
    });
}


