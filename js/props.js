// ---------- preview: props gallery (tile grid) ----------
function showPropGallery(cat){
  pausePlayback();
  previewEl.classList.add('align-tl');
  previewEl.onclick = null;
  previewBarEl.textContent = 'Props';

  const tiles = cat.items.map((it,idx)=>`
    <div class="char-tile" data-idx="${idx}">
      <div class="char-tile-photo">
        ${it.photo ? `<img src="${it.photo}">` : propSvg(26)}
        <div class="char-tile-status status-${propStatus(it)}" title="${propStatus(it)==='green'?'AI reference generated':propStatus(it)==='yellow'?'Prop complete, reference not generated':'Missing required fields'}"></div>
        <div class="char-tile-del" title="Remove"><svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"></path><path d="M10 11v6"></path><path d="M14 11v6"></path></svg></div>
      </div>
      <div class="char-tile-name">${it.name}</div>
    </div>
  `).join('');

  previewEl.innerHTML = `
    <div class="char-gallery">
      <div class="char-grid">
        ${tiles}
        <div class="char-tile char-tile-add" id="addPropTile">
          <div class="char-tile-photo">${plusSvg(26)}</div>
          <div class="char-tile-name">Add prop</div>
        </div>
      </div>
    </div>`;

  previewEl.querySelectorAll('.char-tile-del').forEach(btn=>{
    btn.onclick = (e)=>{
      e.stopPropagation();
      const idx = parseInt(e.target.closest('.char-tile').dataset.idx, 10);
      if(typeof deletePropImages==='function') deletePropImages(cat.items[idx]);
      cat.items.splice(idx,1);
      renderAssets();
      showPropGallery(cat);
      if(typeof saveProjectSoon==='function') saveProjectSoon();
    };
  });
  previewEl.querySelectorAll('.char-tile:not(.char-tile-add)').forEach(tile=>{
    tile.onclick = (e)=>{
      if(e.target.closest('.char-tile-del')) return;
      showPropCard(cat, parseInt(tile.dataset.idx, 10));
    };
  });
  document.getElementById('addPropTile').onclick = ()=> showPropForm(cat);
}

// ---------- preview: prop card (detail view) ----------
function showPropCard(cat, idx){
  pausePlayback();
  previewEl.classList.remove('align-tl');
  const it = cat.items[idx];
  previewBarEl.textContent = 'Prop card — ' + it.name;

  const anglesHtml = (it.angles && it.angles.length)
    ? `<div class="char-card-section-title">Additional views</div>
       <div class="char-card-angles">${it.angles.map(a=>`<div class="char-card-angle"><img src="${a}"></div>`).join('')}</div>`
    : '';

  const hasObjCard = !!(it.card && it.card.images && it.card.images.sheet && it.card.images.sheet.url);
  const objCardStatusHtml = hasObjCard
    ? `<div class="char-card-section-title">Prop Card</div>
       <div class="char-card-angles"><div class="char-card-angle" style="width:100%;height:90px;" title="Reference sheet"><img src="${it.card.images.sheet.url}"></div></div>`
    : `<div class="char-card-section-title">Prop Card</div>
       <div class="gen-hint" style="margin-top:0;">Not built yet — generations of this prop rely on this card once it exists.</div>`;

  previewEl.innerHTML = `
    <div class="char-card" id="propCard">
      <div class="char-card-photo" id="propCardPhoto">
        ${it.photo ? `<img src="${it.photo}">` : propSvg(40)}
      </div>
      <div class="char-card-body">
        <p class="char-card-name">${it.name}</p>
        ${it.description ? `<p class="char-card-desc">${it.description}</p>` : ''}
        ${anglesHtml}
        ${objCardStatusHtml}
        <div class="char-card-actions">
          <button class="cf-btn" id="propCardBack">Back to props</button>
          <div style="display:flex;gap:8px;">
            <button class="cf-btn" id="propCardEdit">Edit</button>
            <button class="cf-btn" id="propCardDelete" style="color:var(--danger);">Delete</button>
          </div>
        </div>
        <button class="cf-btn primary" id="propCardBuildBtn" style="width:100%;margin-top:12px;">${hasObjCard ? 'Edit Prop Card' : 'Create Prop Card'}</button>
        <div class="gen-section" id="propGenSection"></div>
        <div id="propTaskSlot"></div>
      </div>
    </div>`;

  renderPropGenSection(cat, idx);
  renderPropTaskSlot(it);

  document.getElementById('propCardBack').onclick = ()=> showPropGallery(cat);
  document.getElementById('propCardEdit').onclick = ()=> showPropForm(cat, idx);
  document.getElementById('propCardBuildBtn').onclick = ()=> showObjectCardBuilder('props', cat, idx);
  document.getElementById('propCardDelete').onclick = ()=>{
    if(typeof deletePropImages==='function') deletePropImages(it);
    if(typeof deleteObjectCardAssets==='function') deleteObjectCardAssets('props', it);
    cat.items.splice(idx,1);
    renderAssets();
    showPropGallery(cat);
    if(typeof saveProjectSoon==='function') saveProjectSoon();
  };
  previewEl.onclick = (e)=>{
    if(e.target === previewEl) showPropGallery(cat);
  };
}

async function renderPropTaskSlot(it){
  const slot = document.getElementById('propTaskSlot');
  if(!slot || !it.id) return;
  const available = await checkPaidGenerationAvailable();
  const freshSlot = document.getElementById('propTaskSlot');
  if(!freshSlot) return;
  if(!available) return;
  const hasPhoto = !!it.photo;
  freshSlot.innerHTML = `
    <button class="cf-btn primary" id="propAddToTasksBtn" style="width:100%;margin-top:8px;">Generate (real AI)</button>
    ${hasPhoto ? '<div class="gen-hint" style="margin-top:6px;">Has a photo — will use it as a reference if the chosen model supports it, like a real object you photographed yourself.</div>' : ''}`;
  document.getElementById('propAddToTasksBtn').onclick = ()=> runInlineAssetGeneration('props', it, freshSlot);
}

function renderPropGenSection(cat, idx){
  const it = cat.items[idx];
  renderGenBlock(document.getElementById('propGenSection'), it, it.referenceCard, (text)=>{
    it.referenceCard = text;
    renderAssets();
    renderPropGenSection(cat, idx);
  }, { kind:'prop', requireRole:false });
}

// ---------- preview: prop creation / edit form ----------
function showPropForm(cat, editIdx){
  pausePlayback();
  let isEdit = typeof editIdx === 'number';
  let existing = isEdit ? cat.items[editIdx] : null;

  previewEl.classList.remove('align-tl');
  previewEl.onclick = null;
  previewBarEl.textContent = isEdit ? 'Edit prop — ' + existing.name : 'Add asset — Props';
  previewEl.innerHTML = `
    <div class="char-form">
      <h3>${isEdit ? 'Edit prop' : 'New prop'}</h3>
      <p class="sub">${isEdit ? 'Update this prop.' : 'Add an object that needs to stay visually consistent — a bar counter, a guitar, a car.'}</p>

      <div class="cf-field">
        <label>Name</label>
        <input type="text" id="pfName" placeholder="e.g. Vintage Bar Counter" value="${existing ? existing.name : ''}">
      </div>

      <div class="form-tabs">
        <div class="form-tab active" data-tab="details">Details</div>
        <div class="form-tab" data-tab="ai">AI Generator</div>
      </div>

      <div class="form-tab-panel" id="tabDetails">
        <label class="photo-drop${existing && existing.photo ? ' has-photo' : ''}" id="propPhotoDrop" for="propPhotoInput">
          ${existing && existing.photo ? `<img id="propPhotoDropImg" src="${existing.photo}">` : ''}
          <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"></path><circle cx="12" cy="13" r="3.5"></circle></svg>
          <span>Add photo</span>
          <div class="photo-remove" id="propPhotoRemove"><svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg></div>
        </label>
        <input type="file" id="propPhotoInput" accept="image/*,.heic,.heif,.tiff,.tif,.bmp,.svg,.avif,.webp" style="position:absolute;width:1px;height:1px;opacity:0;overflow:hidden;">

        <div class="cf-field">
          <label>Description</label>
          <textarea id="pfNotes" placeholder="Material, color, wear, size, anything worth remembering">${existing && existing.description ? existing.description : ''}</textarea>
          <button class="cf-btn ai-assist-btn" id="pfNotesAssistBtn" style="width:100%;margin-top:6px;display:none;">✨ Improve with AI</button>
        </div>
        <div class="cf-field">
          <label>Additional views</label>
          <div class="angles-row" id="propAnglesRow"></div>
          <input type="file" id="propAngleInput" accept="image/*,.heic,.heif,.tiff,.tif,.bmp,.svg,.avif,.webp" style="position:absolute;width:1px;height:1px;opacity:0;overflow:hidden;">
        </div>

        <div class="gen-section" id="propGenSectionForm"></div>
      </div>

      <div class="form-tab-panel" id="tabAI" style="display:none;">
        <div class="cf-field">
          <label>Prompt</label>
          <textarea id="aiPromptInput" style="min-height:70px;" placeholder="Describe the prop — e.g. a worn leather-top wooden bar counter with brass rail">${existing && existing.description ? existing.description : ''}</textarea>
          <button class="cf-btn ai-assist-btn" id="aiPromptAssistBtn" style="width:100%;margin-top:6px;display:none;">✨ Improve with AI</button>
        </div>
        <button class="gen-btn" id="aiGenBtn">Generate free preview <span class="gen-cost">Free</span></button>
        <div class="gen-hint">Uses Pollinations.ai — no key, no cost, rough quality. Good for blocking out the look before a real generation pass later.</div>
        <div id="aiResultWrap"></div>
        <div id="aiPaidGenSlot"></div>
      </div>

      <div class="cf-actions">
        <button class="cf-btn" id="pfCancel">Cancel</button>
        <button class="cf-btn primary" id="pfSave" ${existing && existing.name ? '' : 'disabled'}>${isEdit ? 'Save changes' : 'Add prop'}</button>
      </div>
    </div>
  `;

  previewEl.querySelectorAll('.form-tab').forEach(tabEl=>{
    tabEl.onclick = ()=>{
      previewEl.querySelectorAll('.form-tab').forEach(t=>t.classList.remove('active'));
      tabEl.classList.add('active');
      document.getElementById('tabDetails').style.display = tabEl.dataset.tab==='details' ? '' : 'none';
      document.getElementById('tabAI').style.display = tabEl.dataset.tab==='ai' ? '' : 'none';
    };
  });

  const anglePhotos = (existing && existing.angles) ? existing.angles.slice() : [];
  const anglesRow = document.getElementById('propAnglesRow');
  const angleInput = document.getElementById('propAngleInput');
  const notesInput = document.getElementById('pfNotes');
  let formRefText = existing ? existing.referenceCard || null : null;

  function refreshFormGen(){
    const data = {
      name: nameInput.value.trim(),
      description: notesInput.value.trim(),
      photo: photoDataUrl,
      angles: anglePhotos,
    };
    renderGenBlock(document.getElementById('propGenSectionForm'), data, formRefText, (text)=>{
      formRefText = text;
      refreshFormGen();
    }, { kind:'prop', requireRole:false });
  }

  function renderAngles(){
    anglesRow.innerHTML = anglePhotos.map((src,idx)=>`
      <div class="angle-tile" data-idx="${idx}">
        <img src="${src}">
        <div class="angle-tile-del" title="Remove"><svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg></div>
      </div>
    `).join('') + `
      <label class="angle-tile-add" for="propAngleInput" title="Add view"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg></label>
    `;
    anglesRow.querySelectorAll('.angle-tile-del').forEach(btn=>{
      btn.onclick = (e)=>{
        e.preventDefault();
        e.stopPropagation();
        const idx = parseInt(e.target.closest('.angle-tile').dataset.idx, 10);
        anglePhotos.splice(idx,1);
        renderAngles();
        refreshFormGen();
      };
    });
  }
  angleInput.onchange = async ()=>{
    const file = angleInput.files[0];
    if(!file) return;
    try{
      const dataUrl = await loadImageAsDataURL(file);
      anglePhotos.push(dataUrl);
      renderAngles();
      refreshFormGen();
    } catch(err){}
    angleInput.value='';
  };
  renderAngles();

  const photoDrop = document.getElementById('propPhotoDrop');
  const photoInput = document.getElementById('propPhotoInput');
  const photoRemove = document.getElementById('propPhotoRemove');
  const nameInput = document.getElementById('pfName');
  const saveBtn = document.getElementById('pfSave');
  let photoDataUrl = existing ? existing.photo || null : null;
  if(photoDataUrl) applyNaturalAspect(photoDrop, photoDataUrl);

  function setPhotoDropImage(url){
    let img = document.getElementById('propPhotoDropImg');
    if(!img){
      img = document.createElement('img');
      img.id = 'propPhotoDropImg';
      photoDrop.prepend(img);
    }
    img.src = url;
  }

  photoInput.onchange = async ()=>{
    const file = photoInput.files[0];
    if(!file) return;
    try{
      photoDataUrl = await loadImageAsDataURL(file);
      photoDrop.classList.add('has-photo');
      setPhotoDropImage(photoDataUrl);
      applyNaturalAspect(photoDrop, photoDataUrl);
      refreshFormGen();
    } catch(err){}
  };
  photoRemove.onclick = (e)=>{
    e.preventDefault();
    e.stopPropagation();
    photoDataUrl = null;
    photoDrop.classList.remove('has-photo');
    const img = document.getElementById('propPhotoDropImg');
    if(img) img.remove();
    photoDrop.style.aspectRatio='';
    photoInput.value='';
    refreshFormGen();
  };

  const aiGenBtn = document.getElementById('aiGenBtn');
  const aiPromptInput = document.getElementById('aiPromptInput');
  const aiResultWrap = document.getElementById('aiResultWrap');
  wireAiAssistButton('aiPromptAssistBtn', 'aiPromptInput',
    (typeof buildAssetContextSummary==='function' ? buildAssetContextSummary() + '\n\n' : '')
    + 'Rewrite this rough prop idea into a vivid, specific object description for an AI image generator — material, color, wear, size. One or two sentences. Reply with only the rewritten description, nothing else.',
    ()=>{});
  if(typeof wireTagAutocomplete==='function') wireTagAutocomplete('aiPromptInput');

  async function renderAiPaidGenSlot(){
    const slot = document.getElementById('aiPaidGenSlot');
    if(!slot) return;
    const available = await checkPaidGenerationAvailable();
    const freshSlot = document.getElementById('aiPaidGenSlot');
    if(!freshSlot) return;
    if(!available) return;
    freshSlot.innerHTML = `<button class="cf-btn primary" id="aiPaidGenBtn" style="width:100%;margin-top:10px;">Generate (real AI)</button>`;
    document.getElementById('aiPaidGenBtn').onclick = async ()=>{
      const prompt = aiPromptInput.value.trim();
      if(!prompt){ alert('Write a prompt first.'); return; }
      const btn = document.getElementById('aiPaidGenBtn');
      btn.disabled = true; btn.textContent = 'Saving…';
      if(!notesInput.value.trim()) notesInput.value = prompt;
      const saved = await doSave(true);
      if(!saved){ btn.disabled = false; btn.textContent = 'Generate (real AI)'; return; }
      await runInlineAssetGeneration('props', saved, freshSlot);
    };
  }
  renderAiPaidGenSlot();

  aiGenBtn.onclick = ()=>{
    const prompt = aiPromptInput.value.trim();
    if(!prompt) return;
    aiGenBtn.disabled = true;
    aiGenBtn.innerHTML = `<span class="gen-spin"></span>Generating…`;
    aiResultWrap.innerHTML = '';
    tryLoadImage(buildPollinationsUrl(prompt + ', product reference photo, plain neutral background, studio lighting', 640, 480))
      .catch(()=> null)
      .then((url)=>{
        aiGenBtn.disabled = false;
        aiGenBtn.innerHTML = `Generate free preview <span class="gen-cost">Free</span>`;
        if(!url){
          aiResultWrap.innerHTML = `<div class="gen-hint">Generation failed (network issue) — try again.</div>`;
          return;
        }
        aiResultWrap.innerHTML = `
          <img class="ai-result-img" src="${url}">
          <div class="ai-result-actions">
            <button class="cf-btn primary" id="useAiPhotoBtn">Use as main photo</button>
          </div>`;
        document.getElementById('useAiPhotoBtn').onclick = ()=>{
          photoDataUrl = url;
          photoDrop.classList.add('has-photo');
          setPhotoDropImage(url);
          applyNaturalAspect(photoDrop, url);
          if(!notesInput.value.trim()) notesInput.value = prompt;
          refreshFormGen();
          refreshSaveState();
          previewEl.querySelector('[data-tab="details"]').click();
        };
      });
  };

  function refreshSaveState(){
    saveBtn.disabled = nameInput.value.trim().length===0;
  }
  wireAiAssistButton('pfNotesAssistBtn', 'pfNotes',
    (typeof buildAssetContextSummary==='function' ? buildAssetContextSummary() + '\n\n' : '')
    + 'Rewrite this rough prop idea into a vivid, specific object description for an AI image generator — material, color, wear, size. One or two sentences. Reply with only the rewritten description, nothing else.',
    refreshFormGen);
  nameInput.addEventListener('input', ()=>{ refreshSaveState(); refreshFormGen(); });
  notesInput.addEventListener('input', refreshFormGen);
  refreshFormGen();

  document.getElementById('pfCancel').onclick = ()=>{
    if(isEdit) showPropCard(cat, editIdx);
    else showPropGallery(cat);
  };
  async function doSave(stayOnForm){
    if(nameInput.value.trim().length===0) return null;
    const data = {
      id: existing && existing.id ? existing.id : 'pr' + (propSeq++),
      name: nameInput.value.trim(),
      icon: 'ti-package',
      live: !!photoDataUrl,
      photo: photoDataUrl,
      description: notesInput.value.trim(),
      angles: anglePhotos.slice(),
      referenceCard: formRefText,
      _assetFiles: existing ? existing._assetFiles : undefined,
    };
    let savedIdx;
    if(isEdit){
      cat.items[editIdx] = data;
      savedIdx = editIdx;
    } else {
      cat.items.push(data);
      savedIdx = cat.items.length - 1;
      existing = data; isEdit = true; editIdx = savedIdx;
    }
    renderAssets();
    if(!stayOnForm){
      if(isEdit) showPropCard(cat, savedIdx);
      else showPropGallery(cat);
    }
    if(typeof persistPropImages==='function'){
      if(typeof setSaveStatus==='function') setSaveStatus('saving');
      await persistPropImages(data);
      if(typeof persistObjectCardInputs==='function') await persistObjectCardInputs('props', data);
    }
    if(typeof saveProjectSoon==='function') saveProjectSoon();
    return data;
  }
  saveBtn.onclick = ()=> doSave(false);
}
