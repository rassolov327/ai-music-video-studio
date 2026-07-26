// ---------- Object Card builder (Locations & Props share this) ----------
let objectCardOpenKey = null; // `${catKey}:${itemId}` of whichever card is currently open, for live refresh

function pickReferenceCapableModelForObjects(){
  return (typeof modelOptions!=='undefined' ? modelOptions : []).find(m=> m.supportsReferenceImage) || null;
}

function gatherObjectReferencePhotos(item){
  const photos = OBJECT_CARD_INPUT_SLOTS.map(s=> item.card.inputSlots[s.key]).filter(Boolean);
  if(photos.length===0 && item.photo) photos.push(item.photo);
  return photos;
}

function buildObjectCardSheetPrompt(catKey, item, basePrompt, extra){
  const kindWord = catKey==='locations' ? 'this exact location' : 'this exact object';
  return [
    basePrompt || item.description || '',
    'reference turnaround sheet for ' + kindWord + ', two rows of four panels each, identical materials, colors, and details in every panel — nothing about it changes between panels',
    'top row, panel 1: front view',
    'top row, panel 2: view turned toward the LEFT side',
    'top row, panel 3: the mirror opposite of panel 2 — view turned toward the RIGHT side instead. Panels 2 and 3 must show opposite sides, not the same side',
    'top row, panel 4: view from directly behind / the back',
    'bottom row, panel 1: close-up detail matching panel 1 above',
    'bottom row, panel 2: close-up detail matching panel 2 above (left side)',
    'bottom row, panel 3: close-up detail matching panel 3 above (right side)',
    'bottom row, panel 4: close-up detail matching panel 4 above (back)',
    extra,
    'plain neutral background, even studio lighting, photoreal, highly detailed, no text, no labels, no panel borders',
  ].filter(Boolean).join(', ');
}

function showObjectCardBuilder(catKey, cat, idx){
  pausePlayback();
  const it = cat.items[idx];
  objectCardOpenKey = catKey + ':' + it.id;
  previewEl.classList.remove('align-tl');
  previewEl.onclick = null;
  const kindLabel = catKey==='locations' ? 'Location' : 'Prop';
  previewBarEl.textContent = kindLabel + ' Card — ' + it.name;

  if(!it.card) it.card = { inputSlots: emptyObjectCardInputSlots(), prompt: it.description || '', images: {} };
  if(!it.card.inputSlots) it.card.inputSlots = emptyObjectCardInputSlots();
  if(!it.card.images) it.card.images = {};
  if(!it.card.inputSlots.front && it.photo) it.card.inputSlots.front = it.photo;

  previewEl.innerHTML = `
    <div class="char-form card-builder">
      <h3>${kindLabel} Card — ${it.name}</h3>
      <p class="sub">Every generation that uses ${it.name} relies on this card once it exists. Add whatever reference photos you have — even one is enough to build from — then describe it and generate.</p>

      <div class="cf-field">
        <label>Reference photos <span style="color:var(--text-3);font-weight:400;">— optional, more helps</span></label>
        <div class="angle-slots-grid" id="objCardInputGrid"></div>
        <input type="file" id="objCardSlotFileInput" accept="image/*,.heic,.heif,.tiff,.tif,.bmp,.svg,.avif,.webp" style="position:absolute;width:1px;height:1px;opacity:0;overflow:hidden;">
      </div>

      <div class="cf-field">
        <label>Description <span style="color:var(--text-3);font-weight:400;">— prompt for the card</span></label>
        <textarea id="objCardPromptInput" style="min-height:80px;" placeholder="Materials, colors, distinguishing features...">${it.card.prompt || it.description || ''}</textarea>
        <button class="cf-btn ai-assist-btn" id="objCardPromptAssistBtn" style="width:100%;margin-top:6px;display:none;">✨ Improve with AI</button>
      </div>

      <button class="cf-btn primary" id="objCardCreateBtn" style="width:100%;">${(it.card.images.sheet && it.card.images.sheet.url) ? 'Regenerate ' + kindLabel + ' Card' : 'Create ' + kindLabel + ' Card'}</button>
      <div class="gen-hint" id="objCardModelHint" style="margin-top:6px;"></div>
      <button class="cf-btn" id="objCardUploadBtn" style="width:100%;margin-top:8px;">Upload an existing card image instead</button>
      <input type="file" id="objCardUploadInput" accept="image/*,.heic,.heif,.tiff,.tif,.bmp,.svg,.avif,.webp" style="position:absolute;width:1px;height:1px;opacity:0;overflow:hidden;">

      <div class="char-card-section-title" style="margin-top:16px;">Card image</div>
      <div class="card-output-grid" id="objCardOutputGrid"></div>

      <div class="cf-actions" style="margin-top:16px;">
        <button class="cf-btn" id="objCardBuilderBack">Back to ${kindLabel.toLowerCase()}</button>
      </div>
    </div>
  `;

  renderObjectCardInputGrid(catKey, it);
  renderObjectCardOutputGrid(catKey, it);

  const model = pickReferenceCapableModelForObjects();
  const modelHint = document.getElementById('objCardModelHint');
  if(!model){
    modelHint.textContent = 'No connected model currently supports reference images — Card generation needs one (e.g. Nano Banana Pro).';
    modelHint.style.color = 'var(--danger)';
    document.getElementById('objCardCreateBtn').disabled = true;
  } else {
    modelHint.textContent = 'Generates with ' + model.label + ' (uses your reference photos directly).';
  }

  wireAiAssistButton('objCardPromptAssistBtn', 'objCardPromptInput',
    'Rewrite this into a vivid, specific description for an AI reference sheet — materials, colors, wear, distinguishing features. One or two sentences. Reply with only the rewritten description, nothing else.',
    ()=>{ it.card.prompt = document.getElementById('objCardPromptInput').value; if(typeof saveProjectSoon==='function') saveProjectSoon(); });

  document.getElementById('objCardPromptInput').addEventListener('input', (e)=>{
    it.card.prompt = e.target.value;
    if(typeof saveProjectSoon==='function') saveProjectSoon();
  });

  document.getElementById('objCardCreateBtn').onclick = ()=> runCreateObjectCard(catKey, cat, idx);

  document.getElementById('objCardUploadBtn').onclick = ()=> document.getElementById('objCardUploadInput').click();
  document.getElementById('objCardUploadInput').onchange = async ()=>{
    const fileInput = document.getElementById('objCardUploadInput');
    const file = fileInput.files[0];
    if(!file) return;
    try{
      const dataUrl = await loadImageAsDataURL(file);
      if(typeof applyObjectCardSheetImage==='function') await applyObjectCardSheetImage(catKey, it, dataUrl);
      else it.card.images.sheet = { url: dataUrl, ok: false };
      renderObjectCardOutputGrid(catKey, it);
      renderAssets();
      const createBtn = document.getElementById('objCardCreateBtn');
      if(createBtn) createBtn.textContent = 'Regenerate ' + kindLabel + ' Card';
      if(typeof saveProjectSoon==='function') saveProjectSoon();
    } catch(err){
      alert('Could not use that file: ' + err.message);
    }
    fileInput.value = '';
  };

  document.getElementById('objCardBuilderBack').onclick = ()=>{
    objectCardOpenKey = null;
    if(catKey==='locations') showLocationCard(cat, idx);
    else showPropCard(cat, idx);
  };
}

function renderObjectCardInputGrid(catKey, item){
  const grid = document.getElementById('objCardInputGrid');
  if(!grid) return;
  const slotFileInput = document.getElementById('objCardSlotFileInput');
  let activeSlotKey = null;
  grid.innerHTML = OBJECT_CARD_INPUT_SLOTS.map(s=>{
    const src = item.card.inputSlots[s.key];
    return `
      <div class="angle-slot${src?' filled':' optional'}" data-slot="${s.key}" title="${s.hint}">
        ${src ? `<img src="${src}"><div class="slot-remove" data-remove="${s.key}"><svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg></div>` : `<span class="slot-plus">${plusSvg(15)}</span>`}
        <span class="slot-label">${s.label}</span>
      </div>`;
  }).join('');
  grid.querySelectorAll('.angle-slot').forEach(el=>{
    el.onclick = (e)=>{
      if(e.target.closest('.slot-remove')) return;
      activeSlotKey = el.dataset.slot;
      slotFileInput.click();
    };
  });
  grid.querySelectorAll('.slot-remove').forEach(btn=>{
    btn.onclick = (e)=>{
      e.stopPropagation();
      item.card.inputSlots[btn.dataset.remove] = null;
      renderObjectCardInputGrid(catKey, item);
      if(typeof saveProjectSoon==='function') saveProjectSoon();
    };
  });
  slotFileInput.onchange = async ()=>{
    const file = slotFileInput.files[0];
    if(!file || !activeSlotKey) return;
    try{
      const dataUrl = await loadImageAsDataURL(file);
      item.card.inputSlots[activeSlotKey] = dataUrl;
      renderObjectCardInputGrid(catKey, item);
      if(typeof saveProjectSoon==='function') saveProjectSoon();
    } catch(err){}
    slotFileInput.value = '';
  };
}

function renderObjectCardOutputGrid(catKey, item){
  const grid = document.getElementById('objCardOutputGrid');
  if(!grid) return;
  const entry = item.card.images.sheet;
  const pending = item.card._pending && item.card._pending.sheet;
  let inner;
  if(entry && entry.url) inner = `<img src="${entry.url}">`;
  else if(pending) inner = `<div class="task-tile-spin"></div>`;
  else inner = `<span class="card-output-empty">Not generated yet</span>`;
  grid.innerHTML = `<div class="card-sheet-tile" id="objCardSheetTile">${inner}</div>`;
  const tile = document.getElementById('objCardSheetTile');
  if(entry && entry.url) tile.onclick = ()=> openObjectCardImageModal(catKey, item);
}

function renderObjectCardOutputGridIfOpen(catKey, item){
  if(objectCardOpenKey===catKey+':'+item.id) renderObjectCardOutputGrid(catKey, item);
}
function refreshObjectCardBuilderIfOpen(catKey, itemId){
  if(objectCardOpenKey!==catKey+':'+itemId) return;
  const cat = state.categories.find(c=> c.key===catKey);
  const item = cat && cat.items.find(x=> x.id===itemId);
  if(item) renderObjectCardOutputGrid(catKey, item);
}

async function runCreateObjectCard(catKey, cat, idx){
  const item = cat.items[idx];
  const model = pickReferenceCapableModelForObjects();
  if(!model) return;
  const kindLabel = catKey==='locations' ? 'Location' : 'Prop';
  const btn = document.getElementById('objCardCreateBtn');
  if(btn){ btn.disabled = true; btn.textContent = 'Generating…'; }
  const promptText = document.getElementById('objCardPromptInput').value.trim();
  item.card.prompt = promptText;
  item.card._pending = item.card._pending || {};
  item.card._pending.sheet = true;
  renderObjectCardOutputGrid(catKey, item);
  const meta = state.projectMeta || { width:1920, height:1080 };

  try{
    const photos = gatherObjectReferencePhotos(item);
    const referenceImageUrls = [];
    for(const p of photos){
      const url = await uploadReferencePhoto(p);
      if(url) referenceImageUrls.push(url);
    }
    const prompt = buildObjectCardSheetPrompt(catKey, item, promptText);
    const res = await fetch('/api/generate-image/start', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt, width: CARD_SHEET_WIDTH, height: CARD_SHEET_HEIGHT, model: model.id,
        referenceImageUrl: referenceImageUrls,
        meta: { projectId: currentProjectId, kind: catKey + '-card', assetId: item.id, assetName: item.name },
      }),
    });
    const data = await res.json().catch(()=> null);
    if(!res.ok || !data || !data.taskId) throw new Error((data && data.message) || 'Could not start generation.');
    const imageUrl = await pollCardSlot(data.taskId);
    item.card.images.sheet = item.card.images.sheet || {};
    item.card.images.sheet.url = imageUrl;
  } catch(err){
    console.warn('[ObjectCard] failed to generate the sheet:', err);
    alert('Could not generate the ' + kindLabel + ' Card: ' + err.message);
  } finally {
    delete item.card._pending.sheet;
    renderObjectCardOutputGridIfOpen(catKey, item);
  }

  if(btn){ btn.disabled = false; btn.textContent = (item.card.images.sheet && item.card.images.sheet.url) ? 'Regenerate ' + kindLabel + ' Card' : 'Create ' + kindLabel + ' Card'; }
  renderAssets();
  if(typeof saveProjectSoon==='function') saveProjectSoon();
}

function openObjectCardImageModal(catKey, item){
  const entry = item.card.images.sheet;
  if(!entry || !entry.url) return;
  const modal = document.getElementById('cardImageModal');
  document.getElementById('cardImageModalImg').src = entry.url;
  document.getElementById('cardImageExtraPrompt').value = '';
  modal.dataset.objCatKey = catKey;
  modal.dataset.objItemId = item.id;
  delete modal.dataset.characterId;
  delete modal.dataset.outputKey;
  modal.classList.remove('hidden');
}

// Called by wireCardImageModal (characters.js) when the shared fullscreen modal's
// "Regenerate" is clicked while an Object Card (not a Character Card) is open.
async function regenerateObjectCardFromModal(modal){
  const catKey = modal.dataset.objCatKey;
  const cat = state.categories.find(c=> c.key===catKey);
  const item = cat && cat.items.find(x=> x.id===modal.dataset.objItemId);
  if(!item) return;
  const model = pickReferenceCapableModelForObjects();
  if(!model) return;
  const btn = document.getElementById('cardImageRegenBtn');
  btn.disabled = true; btn.textContent = 'Generating…';
  const extra = document.getElementById('cardImageExtraPrompt').value.trim();
  try{
    const photos = gatherObjectReferencePhotos(item);
    const referenceImageUrls = [];
    for(const p of photos){
      const url = await uploadReferencePhoto(p);
      if(url) referenceImageUrls.push(url);
    }
    const prompt = buildObjectCardSheetPrompt(catKey, item, item.card.prompt || '', extra);
    const res = await fetch('/api/generate-image/start', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt, width: CARD_SHEET_WIDTH, height: CARD_SHEET_HEIGHT, model: model.id,
        referenceImageUrl: referenceImageUrls,
        meta: { projectId: currentProjectId, kind: catKey + '-card', assetId: item.id, assetName: item.name },
      }),
    });
    const data = await res.json().catch(()=> null);
    if(!res.ok || !data || !data.taskId) throw new Error((data && data.message) || 'Could not start generation.');
    const imageUrl = await pollCardSlot(data.taskId);
    item.card.images.sheet = item.card.images.sheet || {};
    item.card.images.sheet.url = imageUrl;
    document.getElementById('cardImageModalImg').src = imageUrl;
    renderObjectCardOutputGridIfOpen(catKey, item);
    renderAssets();
    if(typeof saveProjectSoon==='function') saveProjectSoon();
  } catch(err){
    alert('Could not regenerate: ' + err.message);
  } finally {
    btn.disabled = false; btn.textContent = 'Regenerate';
  }
}

// ---------- feeding Object Cards into actual shot generation ----------
// The piece that was missing before: a scene's location and assigned props now contribute
// an actual reference image to shot generation, not just text. Uses the full Object Card
// sheet if one's been built; falls back to whatever simple photo the item already has
// (uploaded or freely generated) so there's still SOME visual grounding even before anyone
// builds a full card.
async function gatherSceneLocationPropReferences(scene){
  const localUrls = [];
  if(!scene) return localUrls;
  if(scene.location){
    const locCat = state.categories.find(c=> c.key==='locations');
    const loc = locCat && locCat.items.find(l=> l.name===scene.location);
    if(loc){
      const img = (loc.card && loc.card.images && loc.card.images.sheet && loc.card.images.sheet.url) || loc.photo;
      if(img) localUrls.push(img);
    }
  }
  if(scene.props && scene.props.length){
    const propCat = state.categories.find(c=> c.key==='props');
    const props = propCat ? propCat.items : [];
    for(const propId of scene.props){
      const p = props.find(x=> x.id===propId);
      if(!p) continue;
      const img = (p.card && p.card.images && p.card.images.sheet && p.card.images.sheet.url) || p.photo;
      if(img) localUrls.push(img);
    }
  }
  return localUrls;
}
