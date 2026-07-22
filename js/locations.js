// ---------- preview: locations gallery (tile grid) ----------
function showLocationGallery(cat){
  pausePlayback();
  previewEl.classList.add('align-tl');
  previewEl.onclick = null;
  previewBarEl.textContent = 'Locations';

  const tiles = cat.items.map((it,idx)=>`
    <div class="char-tile" data-idx="${idx}">
      <div class="char-tile-photo" style="${it.photo ? `background-image:url(${it.photo})` : ''}">
        ${it.photo ? '' : '<i class="ti ti-map-pin"></i>'}
        <div class="char-tile-status status-${locationStatus(it)}" title="${locationStatus(it)==='green'?'AI reference generated':locationStatus(it)==='yellow'?'Location complete, reference not generated':'Missing required fields'}"></div>
        <div class="char-tile-del" title="Remove"><svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"></path><path d="M10 11v6"></path><path d="M14 11v6"></path></svg></div>
      </div>
      <div class="char-tile-name">${it.name}</div>
    </div>
  `).join('');

  previewEl.innerHTML = `
    <div class="char-gallery">
      <div class="char-grid">
        ${tiles}
        <div class="char-tile char-tile-add" id="addLocTile">
          <div class="char-tile-photo">${plusSvg(26)}</div>
          <div class="char-tile-name">Add location</div>
        </div>
      </div>
    </div>`;

  previewEl.querySelectorAll('.char-tile-del').forEach(btn=>{
    btn.onclick = (e)=>{
      e.stopPropagation();
      const idx = parseInt(e.target.closest('.char-tile').dataset.idx, 10);
      cat.items.splice(idx,1);
      renderAssets();
      showLocationGallery(cat);
    };
  });
  previewEl.querySelectorAll('.char-tile:not(.char-tile-add)').forEach(tile=>{
    tile.onclick = (e)=>{
      if(e.target.closest('.char-tile-del')) return;
      showLocationCard(cat, parseInt(tile.dataset.idx, 10));
    };
  });
  document.getElementById('addLocTile').onclick = ()=> showLocationForm(cat);
}

// ---------- preview: location card (detail view) ----------
function showLocationCard(cat, idx){
  pausePlayback();
  previewEl.classList.remove('align-tl');
  const it = cat.items[idx];
  previewBarEl.textContent = 'Location card — ' + it.name;

  const anglesHtml = (it.angles && it.angles.length)
    ? `<div class="char-card-section-title">Additional views</div>
       <div class="char-card-angles">${it.angles.map(a=>`<div class="char-card-angle" style="background-image:url(${a})"></div>`).join('')}</div>`
    : '';

  previewEl.innerHTML = `
    <div class="char-card" id="locCard">
      <div class="char-card-photo" id="locCardPhoto" style="${it.photo ? `background-image:url(${it.photo})` : ''}">
        ${it.photo ? '' : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M12 21s7-6.5 7-12a7 7 0 0 0-14 0c0 5.5 7 12 7 12z"></path><circle cx="12" cy="9" r="2.5"></circle></svg>'}
      </div>
      <div class="char-card-body">
        <p class="char-card-name">${it.name}</p>
        ${it.description ? `<p class="char-card-desc">${it.description}</p>` : ''}
        ${anglesHtml}
        <div class="char-card-actions">
          <button class="cf-btn" id="locCardBack">Back to locations</button>
          <div style="display:flex;gap:8px;">
            <button class="cf-btn" id="locCardEdit">Edit</button>
            <button class="cf-btn" id="locCardDelete" style="color:var(--danger);">Delete</button>
          </div>
        </div>
        <div class="gen-section" id="locGenSection"></div>
      </div>
    </div>`;

  renderLocGenSection(cat, idx);

  document.getElementById('locCardBack').onclick = ()=> showLocationGallery(cat);
  document.getElementById('locCardEdit').onclick = ()=> showLocationForm(cat, idx);
  document.getElementById('locCardDelete').onclick = ()=>{
    cat.items.splice(idx,1);
    renderAssets();
    showLocationGallery(cat);
  };
  previewEl.onclick = (e)=>{
    if(e.target === previewEl) showLocationGallery(cat);
  };
}

function renderLocGenSection(cat, idx){
  const it = cat.items[idx];
  renderGenBlock(document.getElementById('locGenSection'), it, it.referenceCard, (text)=>{
    it.referenceCard = text;
    renderAssets();
    renderLocGenSection(cat, idx);
  }, { kind:'location', requireRole:false });
}

// ---------- preview: location creation / edit form ----------
function showLocationForm(cat, editIdx){
  pausePlayback();
  const isEdit = typeof editIdx === 'number';
  const existing = isEdit ? cat.items[editIdx] : null;

  previewEl.classList.remove('align-tl');
  previewEl.onclick = null;
  previewBarEl.textContent = isEdit ? 'Edit location — ' + existing.name : 'Add asset — Locations';
  previewEl.innerHTML = `
    <div class="char-form">
      <h3>${isEdit ? 'Edit location' : 'New location'}</h3>
      <p class="sub">${isEdit ? 'Update the saved location details.' : 'Add a location that shots can be set in.'}</p>

      <div class="cf-field">
        <label>Name</label>
        <input type="text" id="lfName" placeholder="e.g. Route 66 Bar" value="${existing ? existing.name : ''}">
      </div>

      <div class="form-tabs">
        <div class="form-tab active" data-tab="details">Details</div>
        <div class="form-tab" data-tab="ai">AI Generator</div>
      </div>

      <div class="form-tab-panel" id="tabDetails">
        <label class="photo-drop${existing && existing.photo ? ' has-photo' : ''}" id="locPhotoDrop" for="locPhotoInput" style="${existing && existing.photo ? `background-image:url(${existing.photo})` : ''}">
          <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"></path><circle cx="12" cy="13" r="3.5"></circle></svg>
          <span>Add photo</span>
          <div class="photo-remove" id="locPhotoRemove"><svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg></div>
        </label>
        <input type="file" id="locPhotoInput" accept="image/*,.heic,.heif,.tiff,.tif,.bmp,.svg,.avif,.webp" style="position:absolute;width:1px;height:1px;opacity:0;overflow:hidden;">

        <div class="cf-field">
          <label>Description</label>
          <textarea id="lfNotes" placeholder="Layout, furniture, lighting style, anything worth remembering">${existing && existing.description ? existing.description : ''}</textarea>
        </div>
        <div class="cf-field">
          <label>Additional views</label>
          <div class="angles-row" id="locAnglesRow"></div>
          <input type="file" id="locAngleInput" accept="image/*,.heic,.heif,.tiff,.tif,.bmp,.svg,.avif,.webp" style="position:absolute;width:1px;height:1px;opacity:0;overflow:hidden;">
        </div>

        <div class="gen-section" id="locGenSectionForm"></div>
      </div>

      <div class="form-tab-panel" id="tabAI" style="display:none;">
        <div class="cf-field">
          <label>Prompt</label>
          <textarea id="aiPromptInput" style="min-height:70px;" placeholder="Describe the location — e.g. a dim roadside bar, neon signs, wooden counter, smoke in the air">${existing && existing.description ? existing.description : ''}</textarea>
        </div>
        <button class="gen-btn" id="aiGenBtn">Generate free preview <span class="gen-cost">Free</span></button>
        <div class="gen-hint">Uses Pollinations.ai — no key, no cost, rough quality. Good for blocking out the look before a real generation pass later.</div>
        <div id="aiResultWrap"></div>
      </div>

      <div class="cf-actions">
        <button class="cf-btn" id="lfCancel">Cancel</button>
        <button class="cf-btn primary" id="lfSave" ${existing && existing.name ? '' : 'disabled'}>${isEdit ? 'Save changes' : 'Add location'}</button>
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
  const anglesRow = document.getElementById('locAnglesRow');
  const angleInput = document.getElementById('locAngleInput');
  const notesInput = document.getElementById('lfNotes');
  let formRefText = existing ? existing.referenceCard || null : null;

  function refreshFormGen(){
    const data = {
      name: nameInput.value.trim(),
      description: notesInput.value.trim(),
      photo: photoDataUrl,
      angles: anglePhotos,
    };
    renderGenBlock(document.getElementById('locGenSectionForm'), data, formRefText, (text)=>{
      formRefText = text;
      refreshFormGen();
    }, { kind:'location', requireRole:false });
  }

  function renderAngles(){
    anglesRow.innerHTML = anglePhotos.map((src,idx)=>`
      <div class="angle-tile" style="background-image:url(${src})" data-idx="${idx}">
        <div class="angle-tile-del" title="Remove"><svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg></div>
      </div>
    `).join('') + `
      <label class="angle-tile-add" for="locAngleInput" title="Add view"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg></label>
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

  const photoDrop = document.getElementById('locPhotoDrop');
  const photoInput = document.getElementById('locPhotoInput');
  const photoRemove = document.getElementById('locPhotoRemove');
  const nameInput = document.getElementById('lfName');
  const saveBtn = document.getElementById('lfSave');
  let photoDataUrl = existing ? existing.photo || null : null;
  if(photoDataUrl) applyNaturalAspect(photoDrop, photoDataUrl);

  photoInput.onchange = async ()=>{
    const file = photoInput.files[0];
    if(!file) return;
    try{
      photoDataUrl = await loadImageAsDataURL(file);
      photoDrop.classList.add('has-photo');
      photoDrop.style.backgroundImage = `url(${photoDataUrl})`;
      applyNaturalAspect(photoDrop, photoDataUrl);
      refreshFormGen();
    } catch(err){}
  };
  photoRemove.onclick = (e)=>{
    e.preventDefault();
    e.stopPropagation();
    photoDataUrl = null;
    photoDrop.classList.remove('has-photo');
    photoDrop.style.backgroundImage='';
    photoDrop.style.aspectRatio='';
    photoInput.value='';
    refreshFormGen();
  };

  const aiGenBtn = document.getElementById('aiGenBtn');
  const aiPromptInput = document.getElementById('aiPromptInput');
  const aiResultWrap = document.getElementById('aiResultWrap');
  aiGenBtn.onclick = ()=>{
    const prompt = aiPromptInput.value.trim();
    if(!prompt) return;
    aiGenBtn.disabled = true;
    aiGenBtn.innerHTML = `<span class="gen-spin"></span>Generating…`;
    aiResultWrap.innerHTML = '';
    tryLoadImage(buildPollinationsUrl(prompt + ', location establishing shot, cinematic', 640, 360))
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
          photoDrop.style.backgroundImage = `url(${url})`;
          applyNaturalAspect(photoDrop, url);
          refreshFormGen();
          previewEl.querySelector('[data-tab="details"]').click();
        };
      });
  };

  function refreshSaveState(){
    saveBtn.disabled = nameInput.value.trim().length===0;
  }
  nameInput.addEventListener('input', ()=>{ refreshSaveState(); refreshFormGen(); });
  notesInput.addEventListener('input', refreshFormGen);
  refreshFormGen();

  document.getElementById('lfCancel').onclick = ()=>{
    if(isEdit) showLocationCard(cat, editIdx);
    else showLocationGallery(cat);
  };
  saveBtn.onclick = ()=>{
    if(nameInput.value.trim().length===0) return;
    const data = {
      id: existing && existing.id ? existing.id : 'l' + (locSeq++),
      name: nameInput.value.trim(),
      icon: 'ti-map-pin',
      live: !!photoDataUrl,
      photo: photoDataUrl,
      description: notesInput.value.trim(),
      angles: anglePhotos.slice(),
      referenceCard: formRefText,
    };
    if(isEdit){
      cat.items[editIdx] = data;
      renderAssets();
      showLocationCard(cat, editIdx);
    } else {
      cat.items.push(data);
      renderAssets();
      showLocationGallery(cat);
    }
  };
}

