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

  if(shot && shot.videoUrl){
    const trimIn = shot.trimInSec || 0;
    let seekTo = trimIn + 0.01;
    if(typeof getShotStartPx==='function' && typeof PX_PER_SEC!=='undefined' && typeof playheadX!=='undefined'){
      const shotStartPx = getShotStartPx(scene.id, shot.id);
      const offsetSec = (playheadX - shotStartPx) / PX_PER_SEC;
      seekTo = trimIn + Math.max(0.01, Math.min(shot.duration - 0.05, offsetSec));
    }
    previewEl.innerHTML = `
      <div class="timeline-frame" style="border-color:transparent;">
        <video src="${shot.videoUrl}" preload="auto" onloadedmetadata="this.currentTime=${seekTo.toFixed(2)}" ${typeof isPlaying!=='undefined' && isPlaying ? 'autoplay muted playsinline' : 'muted playsinline'}></video>
        <span class="plabel" style="position:relative;z-index:1;color:#fff;background:rgba(0,0,0,.5);padding:3px 9px;border-radius:5px;align-self:flex-end;margin:10px;">${shot.name}</span>
      </div>`;
  } else if(shot && shot.previewImage){
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
  sizePreviewFrame();
  renderInspectorPanel();
}

// The preview box's real pixel size, computed from the project's actual width/height ratio
// (horizontal vs vertical projects need genuinely different shapes here, not just a CSS
// aspect-ratio hint that silently distorts once either max-width or max-height binds).
function sizePreviewFrame(){
  const frame = previewEl.querySelector('.timeline-frame');
  if(!frame) return;
  const pad = 48; // .preview's own padding (24px each side)
  const availW = Math.max(120, previewEl.clientWidth - pad);
  const availH = Math.max(120, previewEl.clientHeight - pad);
  const meta = state.projectMeta || { width:1920, height:1080 };
  const ratio = meta.width / meta.height;
  let w = availW, h = w / ratio;
  if(h > availH){ h = availH; w = h * ratio; }
  frame.style.width = Math.round(w) + 'px';
  frame.style.height = Math.round(h) + 'px';
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
  const propCat = state.categories.find(c=>c.key==='props');
  const allProps = propCat ? propCat.items : [];
  const TIME_OF_DAY = ['Morning','Day','Evening','Night'];

  if(!scene.characters) scene.characters = [];
  if(!scene.props) scene.props = [];
  const availableChars = characters.filter(c=> !scene.characters.some(e=>e.characterId===c.id));
  const availableProps = allProps.filter(p=> !scene.props.includes(p.id));

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

  const propRowsHtml = scene.props.length===0
    ? `<div class="gen-hint" style="margin-top:0;">No props assigned to this scene yet.</div>`
    : scene.props.map((propId, idx)=>{
        const p = allProps.find(x=>x.id===propId);
        return `
          <div class="scene-char-row" data-idx="${idx}">
            <span class="scene-char-name">${p ? p.name : '(deleted)'}</span>
            <span class="scene-char-remove" data-idx="${idx}" title="Remove from scene">${trashSvg(12)}</span>
          </div>`;
      }).join('');

  const addPropRowHtml = allProps.length===0
    ? `<div class="gen-hint" style="margin-top:6px;">No props created yet — add one in Props.</div>`
    : availableProps.length===0
      ? ''
      : `<div class="scene-char-add-row">
          <select id="addPropSelect">
            ${availableProps.map(p=>`<option value="${p.id}">${p.name}</option>`).join('')}
          </select>
          <button class="cf-btn" id="addPropBtn">Add prop</button>
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
      <div class="cf-field"><label>Lighting</label>
        <input type="text" id="sceneLightInput" placeholder="e.g. low key, back light, blue rim" value="${scene.lighting||''}">
        <div class="gen-hint" style="margin-top:4px;">Set once for the whole scene — shots can override this individually if a specific moment needs different light.</div>
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

      <div class="field-group">
        <div class="field-group-title">Props in this scene</div>
        <div id="scenePropList">${propRowsHtml}</div>
        ${addPropRowHtml}
        <div class="gen-hint" style="margin-top:8px;">Not attached to a character — just present in every shot of this scene (a bar counter, a chair, a car) so it stays the same object throughout.</div>
      </div>
    </div>`;

  document.getElementById('sceneNameInput').addEventListener('input', (e)=>{
    scene.name = e.target.value;
    renderTimelineScenes();
    renderAssets();
    previewBarEl.textContent = scene.name;
    if(typeof saveProjectSoon==='function') saveProjectSoon();
  });
  document.getElementById('sceneLocInput').addEventListener('change', (e)=>{ scene.location = e.target.value; if(typeof saveProjectSoon==='function') saveProjectSoon(); });
  document.getElementById('sceneTimeInput').addEventListener('change', (e)=>{ scene.timeOfDay = e.target.value; if(typeof saveProjectSoon==='function') saveProjectSoon(); });
  document.getElementById('sceneLightInput').addEventListener('input', (e)=>{ scene.lighting = e.target.value; if(typeof saveProjectSoon==='function') saveProjectSoon(); });
  document.getElementById('sceneDescInput').addEventListener('input', (e)=>{ scene.description = e.target.value; if(typeof saveProjectSoon==='function') saveProjectSoon(); });

  const addBtn = document.getElementById('addCharacterBtn');
  if(addBtn){
    addBtn.onclick = ()=>{
      const sel = document.getElementById('addCharacterSelect');
      if(!sel || !sel.value) return;
      scene.characters.push({ characterId: sel.value, lookId: null });
      renderSceneSettingsPanel(body, scene);
      if(typeof saveProjectSoon==='function') saveProjectSoon();
    };
  }
  body.querySelectorAll('.scene-char-look').forEach(sel=>{
    sel.addEventListener('change', (e)=>{
      const idx = parseInt(e.target.dataset.idx, 10);
      scene.characters[idx].lookId = e.target.value || null;
      if(typeof saveProjectSoon==='function') saveProjectSoon();
    });
  });
  body.querySelector('#sceneCharList').querySelectorAll('.scene-char-remove').forEach(btn=>{
    btn.addEventListener('click', (e)=>{
      const idx = parseInt(e.target.closest('[data-idx]').dataset.idx, 10);
      scene.characters.splice(idx,1);
      renderSceneSettingsPanel(body, scene);
      if(typeof saveProjectSoon==='function') saveProjectSoon();
    });
  });

  const addPropBtn = document.getElementById('addPropBtn');
  if(addPropBtn){
    addPropBtn.onclick = ()=>{
      const sel = document.getElementById('addPropSelect');
      if(!sel || !sel.value) return;
      scene.props.push(sel.value);
      renderSceneSettingsPanel(body, scene);
      if(typeof saveProjectSoon==='function') saveProjectSoon();
    };
  }
  body.querySelector('#scenePropList').querySelectorAll('.scene-char-remove').forEach(btn=>{
    btn.addEventListener('click', (e)=>{
      const idx = parseInt(e.target.closest('[data-idx]').dataset.idx, 10);
      scene.props.splice(idx,1);
      renderSceneSettingsPanel(body, scene);
      if(typeof saveProjectSoon==='function') saveProjectSoon();
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
  if(!scene.props) scene.props = [];

  const bandCat = state.categories.find(c=>c.key==='band');
  const characters = bandCat ? bandCat.items : [];
  const looksCat = state.categories.find(c=>c.key==='looks');
  const allLooks = looksCat ? looksCat.items : [];
  const propCat = state.categories.find(c=>c.key==='props');
  const allProps = propCat ? propCat.items : [];

  const sceneCharHtml = scene.characters.length===0
    ? `<div class="gen-hint" style="margin-top:0;">No characters in this scene yet.</div>`
    : scene.characters.map(entry=>{
        const c = characters.find(x=>x.id===entry.characterId);
        const look = entry.lookId ? allLooks.find(l=>l.id===entry.lookId) : null;
        return `<div class="char-row checked" style="cursor:default;">${c ? c.name : '(deleted)'}${look ? ` <span style="color:var(--text-3);">— ${look.name}</span>` : ''}</div>`;
      }).join('');

  const scenePropHtml = scene.props.length===0
    ? `<div class="gen-hint" style="margin-top:0;">No props in this scene yet.</div>`
    : scene.props.map(propId=>{
        const p = allProps.find(x=>x.id===propId);
        return `<div class="char-row checked" style="cursor:default;">${p ? p.name : '(deleted)'}</div>`;
      }).join('');

  const sameAsScene = shot.lightingSameAsScene !== false; // default true — matches how a shoot actually works: light the scene, correct individual shots only when needed

  body.innerHTML = `
    <div style="padding:14px;">
      <div class="cat-count" style="font-size:11px;margin-bottom:10px;">${scene.name}</div>
      <div class="cf-field"><label>Name</label><input type="text" id="shotNameInput" value="${shot.name}"></div>
      <div class="cf-field"><label>Duration (sec)</label><input type="number" id="shotDurInput" min="0.5" ${shot.videoUrl ? `max="${MOVIE_CLIP_DURATION_SEC}"` : ''} step="0.1" value="${shot.duration}"></div>
      ${shot.videoUrl ? `<div class="gen-hint" style="margin-top:-6px;">Animated — can't exceed the clip's own ${MOVIE_CLIP_DURATION_SEC}s length.</div>` : ''}

      <div class="field-group">
        <div class="field-group-title">Characters <span style="font-weight:400;color:var(--text-3);">— inherited from scene</span></div>
        <div class="char-list">${sceneCharHtml}</div>
      </div>

      <div class="field-group">
        <div class="field-group-title">Props <span style="font-weight:400;color:var(--text-3);">— inherited from scene</span></div>
        <div class="char-list">${scenePropHtml}</div>
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
        <label class="char-row" style="margin-bottom:6px;font-size:11.5px;font-weight:400;">
          <input type="checkbox" id="shotLightSameChk" ${sameAsScene ? 'checked' : ''}> Same as scene
        </label>
        <input type="text" id="shotLightInput" placeholder="e.g. low key, back light, blue rim" value="${sameAsScene ? (scene.lighting||'') : (shot.lighting||'')}" ${sameAsScene ? 'disabled' : ''}>
      </div>
      <div class="cf-field"><label>${shot.seedanceMode ? 'First frame' : 'Description'} <span style="color:var(--text-3);font-weight:400;">— prompt for AI generation</span></label>
        <textarea id="shotDescInput" style="min-height:90px;" placeholder="Describe exactly what should happen in this shot...">${shot.description||''}</textarea>
        <button class="cf-btn ai-assist-btn" id="shotDescAssistBtn" style="width:100%;margin-top:6px;display:none;">✨ Improve with AI</button>
      </div>
      ${shot.seedanceMode ? `
      <div class="cf-field"><label>Last frame <span style="color:var(--text-3);font-weight:400;">— prompt for AI generation</span></label>
        <textarea id="shotLastFrameDescInput" style="min-height:90px;" placeholder="Describe how this shot should end...">${shot.lastFrameDescription||''}</textarea>
        <button class="cf-btn ai-assist-btn" id="shotLastFrameAssistBtn" style="width:100%;margin-top:6px;display:none;">✨ Improve with AI</button>
      </div>` : ''}
      <button class="cf-btn" id="shotSeedanceToggleBtn" style="width:100%;margin-top:4px;">${shot.seedanceMode ? 'Back to single frame' : 'Convert to Seedance 2 frame'}</button>

      <div class="gen-section" id="shotGenSection"></div>
    </div>`;

  renderShotGenSection(scene, shot);
  wireAiAssistButton('shotDescAssistBtn', 'shotDescInput',
    (buildShotFixedElementsContext(scene) ? buildShotFixedElementsContext(scene) + '\n\n' : '')
    + 'Rewrite this rough shot idea into a vivid, specific, camera-ready visual description for an AI image generator. One or two sentences, concrete imagery, no camera-move or shot-size talk (that\'s handled separately). Reply with only the rewritten description, nothing else.',
    (result)=>{ shot.description = result; });
  if(typeof wireTagAutocomplete==='function') wireTagAutocomplete('shotDescInput');
  if(shot.seedanceMode){
    wireAiAssistButton('shotLastFrameAssistBtn', 'shotLastFrameDescInput',
      (buildShotFixedElementsContext(scene) ? buildShotFixedElementsContext(scene) + '\n\n' : '')
      + 'Rewrite this rough idea into a vivid, specific, camera-ready visual description for an AI image generator, describing how this shot should look at its very END (the last frame of a first-to-last-frame video). One or two sentences, concrete imagery, no camera-move or shot-size talk. Reply with only the rewritten description, nothing else.',
      (result)=>{ shot.lastFrameDescription = result; });
    if(typeof wireTagAutocomplete==='function') wireTagAutocomplete('shotLastFrameDescInput');
    document.getElementById('shotLastFrameDescInput').addEventListener('input', (e)=>{ shot.lastFrameDescription = e.target.value; if(typeof saveProjectSoon==='function') saveProjectSoon(); });
  }
  document.getElementById('shotSeedanceToggleBtn').onclick = ()=>{
    shot.seedanceMode = !shot.seedanceMode; // toggling off just hides the last-frame field — the text itself is kept, not cleared
    renderInspectorPanel();
    renderTimelineScenes();
    if(typeof saveProjectSoon==='function') saveProjectSoon();
  };

  document.getElementById('jumpToSceneBtn').onclick = ()=> setFocus(scene.id, null);
  document.getElementById('shotNameInput').addEventListener('input', (e)=>{
    shot.name = e.target.value;
    renderTimelineScenes();
    previewBarEl.textContent = scene.name + ' — ' + shot.name;
  });
  document.getElementById('shotDurInput').addEventListener('input', (e)=>{
    let val = parseFloat(e.target.value) || shot.duration;
    if(shot.videoUrl) val = Math.min(val, MOVIE_CLIP_DURATION_SEC);
    shot.duration = val;
    renderTimelineScenes();
  });
  document.getElementById('shotSizeInput').addEventListener('change', (e)=>{ shot.shotSize = e.target.value; });
  document.getElementById('shotMoveInput').addEventListener('change', (e)=>{ shot.cameraMove = e.target.value; });
  document.getElementById('shotLightSameChk').addEventListener('change', (e)=>{
    shot.lightingSameAsScene = e.target.checked;
    renderInspectorPanel();
    if(typeof saveProjectSoon==='function') saveProjectSoon();
  });
  document.getElementById('shotLightInput').addEventListener('input', (e)=>{ shot.lighting = e.target.value; if(typeof saveProjectSoon==='function') saveProjectSoon(); });
  document.getElementById('shotDescInput').addEventListener('input', (e)=>{ shot.description = e.target.value; });
}

function renderShotGenSection(scene, shot){
  const section = document.getElementById('shotGenSection');
  if(!section) return;

  if(shot.previewImage){
    section.innerHTML = `
      <div class="shot-preview-thumb"><img src="${shot.previewImage}"></div>
      <div id="paidGenSlot"></div>`;
  } else {
    section.innerHTML = `<div id="paidGenSlot"></div>`;
  }
  renderPaidGenSlot(scene, shot);
}

async function renderPaidGenSlot(scene, shot){
  const slot = document.getElementById('paidGenSlot');
  if(!slot) return;
  const available = await checkPaidGenerationAvailable();
  // renderShotGenSection may have re-run (e.g. focus changed) while we were awaiting —
  // re-fetch the slot to make sure we're still updating the section that's on screen.
  const freshSlot = document.getElementById('paidGenSlot');
  if(!freshSlot) return;
  if(!available){
    freshSlot.innerHTML = `<div class="gen-hint" style="margin-top:10px;">Paid generation isn't connected on this deployment yet.</div>`;
    return;
  }
  freshSlot.innerHTML = `
    <button class="cf-btn primary" id="shotPaidGenBtn" style="width:100%;margin-top:10px;">${shot.previewImage ? 'Regenerate' : 'Add to Tasks'} (real AI)</button>
    <div class="gen-hint" style="margin-top:6px;">Adds this shot to the TASKS queue — pick a model and hit Generate there (one at a time, or several together).</div>`;
  document.getElementById('shotPaidGenBtn').onclick = ()=> queueShotGeneration(scene, shot);
}

// Adds a draft entry to the task queue — nothing is sent to any provider yet. The Tasks
// tab is where the model gets chosen and the send actually happens, same idea as
// DaVinci's render queue: stack up jobs, then render (one, several, or all).
function queueShotGeneration(scene, shot){
  state.taskQueue = state.taskQueue || [];
  if(shot.seedanceMode){
    // Two separate drafts — the director may like the first frame but want to reroll the
    // last one (or vice versa), so they need independent review/regeneration, not a single
    // bundled result.
    state.taskQueue.push({
      id: 'dt' + (draftTaskSeq++), kind: 'shot', field: 'first',
      sceneId: scene.id, shotId: shot.id, sceneName: scene.name, shotName: shot.name + ' (first frame)',
      model: (modelOptions[0] && modelOptions[0].id) || null, createdAt: Date.now(),
    });
    state.taskQueue.push({
      id: 'dt' + (draftTaskSeq++), kind: 'shot', field: 'last',
      sceneId: scene.id, shotId: shot.id, sceneName: scene.name, shotName: shot.name + ' (last frame)',
      model: (modelOptions[0] && modelOptions[0].id) || null, createdAt: Date.now(),
    });
  } else {
    state.taskQueue.push({
      id: 'dt' + (draftTaskSeq++),
      kind: 'shot',
      sceneId: scene.id, shotId: shot.id,
      sceneName: scene.name, shotName: shot.name,
      model: (modelOptions[0] && modelOptions[0].id) || null,
      createdAt: Date.now(),
    });
  }
  if(typeof saveProjectSoon==='function') saveProjectSoon();
  if(typeof renderTasksGrid==='function' && typeof refreshTasks==='function') refreshTasks();
  const slot = document.getElementById('paidGenSlot');
  if(slot){
    slot.innerHTML = `<div class="gen-hint" style="color:#5fae7a;">Added to the TASKS queue — open the TASKS tab to pick a model and generate.</div>`;
  }
}

