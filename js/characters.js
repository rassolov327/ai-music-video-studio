// ---------- preview: character card (detail view) ----------
function showCharacterCard(cat, idx){
  pausePlayback();
  previewEl.classList.remove('align-tl');
  const it = cat.items[idx];
  previewBarEl.textContent = 'Character card — ' + it.name;

  const hasSheet = !!(it.card && it.card.images && it.card.images['sheet'] && it.card.images['sheet'].url);
  const cardStatusHtml = hasSheet
    ? `<div class="char-card-section-title">Character Card</div>
       <div class="char-card-angles"><div class="char-card-angle" style="width:100%;height:90px;" title="Reference sheet"><img src="${it.card.images['sheet'].url}"></div></div>`
    : `<div class="char-card-section-title">Character Card</div>
       <div class="gen-hint" style="margin-top:0;">Not built yet — every generation of this character relies on this card once it exists.</div>`;

  previewEl.innerHTML = `
    <div class="char-card" id="charCard">
      <div class="char-card-photo" id="cardPhoto">
        ${it.photo ? `<img src="${it.photo}">` : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="12" cy="8" r="4"></circle><path d="M4 21c0-4 4-6 8-6s8 2 8 6"></path></svg>'}
      </div>
      <div class="char-card-body">
        <p class="char-card-name">${it.name}</p>
        ${it.role ? `<span class="char-card-role">${it.role}</span>` : ''}
        ${it.description ? `<p class="char-card-desc">${it.description}</p>` : ''}
        ${cardStatusHtml}
        <div class="char-card-actions">
          <button class="cf-btn" id="cardBack">Back to characters</button>
          <div style="display:flex;gap:8px;">
            <button class="cf-btn" id="cardEdit">Edit</button>
            <button class="cf-btn" id="cardDelete" style="color:var(--danger);">Delete</button>
          </div>
        </div>
        <button class="cf-btn primary" id="cardBuildBtn" style="width:100%;margin-top:12px;">${hasSheet ? 'Edit Character Card' : 'Create Character Card'}</button>
      </div>
    </div>`;

  document.getElementById('cardBack').onclick = ()=> showCharacterGallery(cat);
  document.getElementById('cardEdit').onclick = ()=> showCharacterForm(cat, idx);
  document.getElementById('cardBuildBtn').onclick = ()=> showCharacterCardBuilder(cat, idx);
  document.getElementById('cardDelete').onclick = ()=>{
    if(typeof deleteCharacterImages==='function') deleteCharacterImages(it);
    cat.items.splice(idx,1);
    renderAssets();
    showCharacterGallery(cat);
    if(typeof saveProjectSoon==='function') saveProjectSoon();
  };

  // click on the surrounding empty area (not the card itself) returns to the gallery
  previewEl.onclick = (e)=>{
    if(e.target === previewEl) showCharacterGallery(cat);
  };
}

// ---------- preview: character creation / edit form (step 1 — the lightweight card) ----------
function showCharacterForm(cat, editIdx){
  pausePlayback();
  const isEdit = typeof editIdx === 'number';
  const existing = isEdit ? cat.items[editIdx] : null;

  previewEl.classList.remove('align-tl');
  previewEl.onclick = null;
  previewBarEl.textContent = isEdit ? 'Edit character — ' + existing.name : 'Add asset — Band / Characters';

  previewEl.innerHTML = `
    <div class="char-form">
      <h3>${isEdit ? 'Edit character' : 'New character'}</h3>
      <p class="sub">${isEdit ? 'Update the saved character details.' : 'A quick entry — name, role, description, one photo. Once saved, you can build its full Character Card, which is what every generation of this character actually relies on.'}</p>

      <div class="cf-field">
        <label>Name</label>
        <input type="text" id="cfName" placeholder="e.g. James Hetfield" value="${existing ? existing.name : ''}">
      </div>
      <div class="cf-field">
        <label>Role</label>
        <input type="text" id="cfRole" placeholder="e.g. Vocals, Lead guitar, Bass" value="${existing && existing.role ? existing.role : ''}">
      </div>
      <div class="cf-field">
        <label>Description</label>
        <textarea id="cfNotes" placeholder="Appearance, wardrobe, anything worth remembering">${existing && existing.description ? existing.description : ''}</textarea>
      </div>

      <div class="cf-field">
        <label>Photo</label>
        <label class="photo-drop" id="cfPhotoDrop">
          ${existing && existing.photo ? `<img src="${existing.photo}">` : '<span class="photo-drop-plus">' + plusSvg(20) + '</span><span class="photo-drop-text">Add a photo</span>'}
          <input type="file" id="cfPhotoInput" accept="image/*,.heic,.heif,.tiff,.tif,.bmp,.svg,.avif,.webp" style="position:absolute;width:1px;height:1px;opacity:0;overflow:hidden;">
        </label>
      </div>

      <div class="cf-actions">
        <button class="cf-btn" id="cfCancel">Cancel</button>
        <button class="cf-btn primary" id="cfSave" ${existing && existing.name ? '' : 'disabled'}>${isEdit ? 'Save changes' : 'Add member'}</button>
      </div>
    </div>
  `;

  const roleInput = document.getElementById('cfRole');
  const notesInput = document.getElementById('cfNotes');
  const nameInput = document.getElementById('cfName');
  const saveBtn = document.getElementById('cfSave');
  const photoDrop = document.getElementById('cfPhotoDrop');
  let photoInput = document.getElementById('cfPhotoInput');
  let photoDataUrl = existing ? existing.photo || null : null;

  photoDrop.onclick = (e)=>{ if(!e.target.closest('input')) photoInput.click(); };
  function wirePhotoInput(){
    photoInput = document.getElementById('cfPhotoInput');
    photoInput.onchange = async ()=>{
      const file = photoInput.files[0];
      if(!file) return;
      try{
        photoDataUrl = await loadImageAsDataURL(file);
        photoDrop.innerHTML = `<img src="${photoDataUrl}"><input type="file" id="cfPhotoInput" accept="image/*" style="position:absolute;width:1px;height:1px;opacity:0;overflow:hidden;">`;
        wirePhotoInput();
      } catch(err){}
    };
  }
  wirePhotoInput();

  function refreshSaveState(){
    saveBtn.disabled = nameInput.value.trim().length===0;
  }
  nameInput.addEventListener('input', refreshSaveState);

  document.getElementById('cfCancel').onclick = ()=>{
    if(isEdit) showCharacterCard(cat, editIdx);
    else showCharacterGallery(cat);
  };
  saveBtn.onclick = async ()=>{
    if(nameInput.value.trim().length===0) return;
    const data = {
      id: existing && existing.id ? existing.id : 'c' + (charSeq++),
      name: nameInput.value.trim(),
      icon: 'ti-user',
      live: !!photoDataUrl,
      photo: photoDataUrl,
      role: roleInput.value.trim(),
      description: notesInput.value.trim(),
      angleSlots: existing ? existing.angleSlots : undefined, // legacy, kept only if it already existed
      referenceCard: existing ? existing.referenceCard : undefined,
      turnaroundSheet: existing ? existing.turnaroundSheet : undefined,
      card: existing ? existing.card : undefined, // the real Character Card, untouched by this simple form
      _assetFiles: existing ? existing._assetFiles : undefined,
    };
    if(isEdit){
      cat.items[editIdx] = data;
      renderAssets();
      showCharacterCard(cat, editIdx);
    } else {
      cat.items.push(data);
      renderAssets();
      showCharacterGallery(cat);
    }
    if(typeof persistCharacterImages==='function'){
      if(typeof setSaveStatus==='function') setSaveStatus('saving');
      await persistCharacterImages(data);
    }
    if(typeof saveProjectSoon==='function') saveProjectSoon();
  };
}

// ---------- Character Card builder — the real, generation-driving reference set ----------
let cardBuilderOpenCharacterId = null; // lets the background task watcher refresh this screen live

function pickReferenceCapableModel(){
  return (typeof modelOptions!=='undefined' ? modelOptions : []).find(m=> m.supportsReferenceImage) || null;
}

// Picks the best available reference photo for a given output angle — the exact matching
// input slot if it was uploaded, otherwise a sensible neighboring angle, and finally
// whatever photo exists at all (down to the character's own micro-card photo). This is what
// makes "build the card from whatever's available, even one photo" actually work.
// Every uploaded reference photo goes in as a separate reference image for the one sheet
// generation — richer than picking just one. Falls back to the character's micro-card
// photo if nothing else was uploaded, so a card can still be built from just that.
function gatherReferencePhotos(character){
  const photos = CARD_INPUT_SLOTS.map(s=> character.card.inputSlots[s.key]).filter(Boolean);
  if(photos.length===0 && character.photo) photos.push(character.photo);
  return photos;
}

function buildCardSheetPrompt(character, basePrompt, extra){
  return [
    basePrompt || character.description || '',
    'character reference turnaround sheet, two rows of four panels each, the exact same person with identical face, hair, build, and outfit in every panel',
    'top row left to right: full-body front view, full-body three-quarter view turned left, full-body three-quarter view turned right, full-body back view',
    'bottom row left to right: close-up portrait front view, close-up three-quarter view turned left, close-up three-quarter view turned right, close-up back-of-head view — each directly below its matching angle above',
    extra,
    'plain neutral background, even studio lighting, photoreal, highly detailed, no text, no labels, no panel borders',
  ].filter(Boolean).join(', ');
}

function showCharacterCardBuilder(cat, idx){
  pausePlayback();
  cardBuilderOpenCharacterId = cat.items[idx] && cat.items[idx].id;
  previewEl.classList.remove('align-tl');
  previewEl.onclick = null;
  const it = cat.items[idx];
  previewBarEl.textContent = 'Character Card — ' + it.name;

  if(!it.card) it.card = { inputSlots: emptyCardInputSlots(), prompt: it.description || '', images: {} };
  if(!it.card.inputSlots) it.card.inputSlots = emptyCardInputSlots();
  if(!it.card.images) it.card.images = {};
  // seed the front slot from the micro-card photo the first time, if nothing better exists yet
  if(!it.card.inputSlots.front && it.photo) it.card.inputSlots.front = it.photo;

  previewEl.innerHTML = `
    <div class="char-form card-builder">
      <h3>Character Card — ${it.name}</h3>
      <p class="sub">Every generation of ${it.name} from here on relies on this card. Add whatever reference photos you have — even one is enough to build from — then describe the character and generate the full set.</p>

      <div class="cf-field">
        <label>Reference photos <span style="color:var(--text-3);font-weight:400;">— optional, more helps</span></label>
        <div class="angle-slots-grid" id="cardInputGrid"></div>
        <input type="file" id="cardSlotFileInput" accept="image/*,.heic,.heif,.tiff,.tif,.bmp,.svg,.avif,.webp" style="position:absolute;width:1px;height:1px;opacity:0;overflow:hidden;">
      </div>

      <div class="cf-field">
        <label>Description <span style="color:var(--text-3);font-weight:400;">— prompt for the card</span></label>
        <textarea id="cardPromptInput" style="min-height:80px;" placeholder="Appearance, wardrobe, distinguishing features...">${it.card.prompt || it.description || ''}</textarea>
        <button class="cf-btn ai-assist-btn" id="cardPromptAssistBtn" style="width:100%;margin-top:6px;display:none;">✨ Improve with AI</button>
      </div>

      <button class="cf-btn primary" id="cardCreateBtn" style="width:100%;">${(it.card.images['sheet'] && it.card.images['sheet'].url) ? 'Regenerate Character Card' : 'Create Character Card'}</button>
      <div class="gen-hint" id="cardModelHint" style="margin-top:6px;"></div>

      <div class="char-card-section-title" style="margin-top:16px;">Card images</div>
      <div class="card-output-grid" id="cardOutputGrid"></div>

      <div class="cf-actions" style="margin-top:16px;">
        <button class="cf-btn" id="cardBuilderBack">Back to character</button>
      </div>
    </div>
  `;

  renderCardInputGrid(it);
  renderCardOutputGrid(it);

  const model = pickReferenceCapableModel();
  const modelHint = document.getElementById('cardModelHint');
  if(!model){
    modelHint.textContent = 'No connected model currently supports reference images — Character Card generation needs one (e.g. Nano Banana Pro).';
    modelHint.style.color = 'var(--danger)';
    document.getElementById('cardCreateBtn').disabled = true;
  } else {
    modelHint.textContent = 'Generates with ' + model.label + ' (uses your reference photos directly).';
  }

  wireAiAssistButton('cardPromptAssistBtn', 'cardPromptInput',
    'Rewrite this into a vivid, specific physical description for an AI character reference sheet — face, build, hair, wardrobe, distinguishing features. Two or three sentences. Reply with only the rewritten description, nothing else.',
    ()=>{ it.card.prompt = document.getElementById('cardPromptInput').value; if(typeof saveProjectSoon==='function') saveProjectSoon(); });

  document.getElementById('cardPromptInput').addEventListener('input', (e)=>{
    it.card.prompt = e.target.value;
    if(typeof saveProjectSoon==='function') saveProjectSoon();
  });

  document.getElementById('cardCreateBtn').onclick = ()=> runCreateCard(cat, idx);

  document.getElementById('cardBuilderBack').onclick = ()=>{
    cardBuilderOpenCharacterId = null;
    showCharacterCard(cat, idx);
  };
}

function renderCardInputGrid(character){
  const grid = document.getElementById('cardInputGrid');
  if(!grid) return;
  const slotFileInput = document.getElementById('cardSlotFileInput');
  let activeSlotKey = null;
  grid.innerHTML = CARD_INPUT_SLOTS.map(s=>{
    const src = character.card.inputSlots[s.key];
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
      character.card.inputSlots[btn.dataset.remove] = null;
      renderCardInputGrid(character);
      if(typeof saveProjectSoon==='function') saveProjectSoon();
    };
  });
  slotFileInput.onchange = async ()=>{
    const file = slotFileInput.files[0];
    if(!file || !activeSlotKey) return;
    try{
      const dataUrl = await loadImageAsDataURL(file);
      character.card.inputSlots[activeSlotKey] = dataUrl;
      renderCardInputGrid(character);
      if(typeof saveProjectSoon==='function') saveProjectSoon();
    } catch(err){}
    slotFileInput.value = '';
  };
}

function renderCardOutputGrid(character){
  const grid = document.getElementById('cardOutputGrid');
  if(!grid) return;
  const entry = character.card.images['sheet'];
  const pending = character.card._pending && character.card._pending['sheet'];
  let inner;
  if(entry && entry.url) inner = `<img src="${entry.url}">`;
  else if(pending) inner = `<div class="task-tile-spin"></div>`;
  else inner = `<span class="card-output-empty">Not generated yet</span>`;
  grid.innerHTML = `<div class="card-sheet-tile" id="cardSheetTile">${inner}</div>`;
  const tile = document.getElementById('cardSheetTile');
  if(entry && entry.url){
    tile.onclick = ()=> openCardImageModal(character, 'sheet');
  }
}

// One generation call, using every uploaded reference photo (not just one) so the model has
// as much to work with as possible for the whole sheet. The actual persisting and archiving
// happens through the normal shared task pipeline (applyFinishedTasks in tasks.js) — this
// function only drives the on-screen progress.
async function runCreateCard(cat, idx){
  const character = cat.items[idx];
  const model = pickReferenceCapableModel();
  if(!model) return;
  const btn = document.getElementById('cardCreateBtn');
  if(btn){ btn.disabled = true; btn.textContent = 'Generating…'; }
  const promptText = document.getElementById('cardPromptInput').value.trim();
  character.card.prompt = promptText;
  character.card._pending = character.card._pending || {};
  character.card._pending['sheet'] = true;
  renderCardOutputGrid(character);
  const meta = state.projectMeta || { width:1920, height:1080 };

  try{
    const photos = gatherReferencePhotos(character);
    const referenceImageUrls = [];
    for(const p of photos){
      const url = await uploadReferencePhoto(p);
      if(url) referenceImageUrls.push(url);
    }
    const prompt = buildCardSheetPrompt(character, promptText);
    const res = await fetch('/api/generate-image/start', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt, width: meta.width, height: meta.height, model: model.id,
        referenceImageUrl: referenceImageUrls,
        meta: { projectId: currentProjectId, kind: 'character-card', characterId: character.id, characterName: character.name, outputKey: 'sheet' },
      }),
    });
    const data = await res.json().catch(()=> null);
    if(!res.ok || !data || !data.taskId) throw new Error((data && data.message) || 'Could not start generation.');
    const imageUrl = await pollCardSlot(data.taskId);
    // Show the result immediately for a responsive feel — the background task watcher
    // will persist it locally and archive it within a few seconds regardless.
    character.card.images['sheet'] = character.card.images['sheet'] || {};
    character.card.images['sheet'].url = imageUrl;
  } catch(err){
    console.warn('[CharacterCard] failed to generate the sheet:', err);
    alert('Could not generate the Character Card: ' + err.message);
  } finally {
    delete character.card._pending['sheet'];
    renderCardOutputGridIfOpen(character);
  }

  if(btn){ btn.disabled = false; btn.textContent = (character.card.images['sheet'] && character.card.images['sheet'].url) ? 'Regenerate Character Card' : 'Create Character Card'; }
  renderAssets();
  if(typeof saveProjectSoon==='function') saveProjectSoon();
}

function renderCardOutputGridIfOpen(character){
  if(cardBuilderOpenCharacterId===character.id) renderCardOutputGrid(character);
}
// Called by the shared background task watcher (tasks.js) once it has actually persisted
// a character-card image locally — swaps the tile from the raw provider link to the
// now-permanent local copy, if this exact character's builder screen is still open.
function refreshCardBuilderIfOpen(characterId){
  if(cardBuilderOpenCharacterId!==characterId) return;
  const bandCat = state.categories.find(c=>c.key==='band');
  const character = bandCat && bandCat.items.find(c=>c.id===characterId);
  if(character) renderCardOutputGrid(character);
}

async function pollCardSlot(taskId){
  const deadline = Date.now() + 5 * 60 * 1000;
  while(Date.now() < deadline){
    await new Promise(r=> setTimeout(r, 3000));
    const res = await fetch('/api/generate-image/status?taskId=' + encodeURIComponent(taskId));
    const data = await res.json().catch(()=> null);
    if(!res.ok || !data) throw new Error('Lost contact with the server.');
    if(data.status==='success' && data.imageUrl) return data.imageUrl;
    if(data.status==='failed') throw new Error(data.message || 'Generation failed.');
  }
  throw new Error('Timed out — check the TASKS tab, it may still finish.');
}

// ---------- fullscreen view + regenerate-this-one ----------
function openCardImageModal(character, outputKey){
  const entry = character.card.images[outputKey];
  if(!entry || !entry.url) return;
  const modal = document.getElementById('cardImageModal');
  document.getElementById('cardImageModalImg').src = entry.url;
  document.getElementById('cardImageExtraPrompt').value = '';
  modal.dataset.characterId = character.id;
  modal.dataset.outputKey = outputKey;
  modal.classList.remove('hidden');
}
function wireCardImageModal(){
  const modal = document.getElementById('cardImageModal');
  if(!modal) return;
  document.getElementById('cardImageModalClose').onclick = ()=> modal.classList.add('hidden');
  modal.addEventListener('click', (e)=>{ if(e.target===modal) modal.classList.add('hidden'); });
  document.getElementById('cardImageRegenBtn').onclick = async ()=>{
    const bandCat = state.categories.find(c=>c.key==='band');
    const character = bandCat && bandCat.items.find(c=>c.id===modal.dataset.characterId);
    const outputKey = modal.dataset.outputKey;
    if(!character) return;
    const model = pickReferenceCapableModel();
    if(!model) return;
    const btn = document.getElementById('cardImageRegenBtn');
    btn.disabled = true; btn.textContent = 'Generating…';
    const extra = document.getElementById('cardImageExtraPrompt').value.trim();
    const meta = state.projectMeta || { width:1920, height:1080 };
    try{
      const photos = gatherReferencePhotos(character);
      const referenceImageUrls = [];
      for(const p of photos){
        const url = await uploadReferencePhoto(p);
        if(url) referenceImageUrls.push(url);
      }
      const prompt = buildCardSheetPrompt(character, character.card.prompt || '', extra);
      const res = await fetch('/api/generate-image/start', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt, width: meta.width, height: meta.height, model: model.id,
          referenceImageUrl: referenceImageUrls,
          meta: { projectId: currentProjectId, kind: 'character-card', characterId: character.id, characterName: character.name, outputKey },
        }),
      });
      const data = await res.json().catch(()=> null);
      if(!res.ok || !data || !data.taskId) throw new Error((data && data.message) || 'Could not start generation.');
      const imageUrl = await pollCardSlot(data.taskId);
      character.card.images[outputKey] = character.card.images[outputKey] || {};
      character.card.images[outputKey].url = imageUrl;
      document.getElementById('cardImageModalImg').src = imageUrl;
      renderCardOutputGridIfOpen(character);
      renderAssets();
      if(typeof saveProjectSoon==='function') saveProjectSoon();
    } catch(err){
      alert('Could not regenerate: ' + err.message);
    } finally {
      btn.disabled = false; btn.textContent = 'Regenerate';
    }
  };
}
