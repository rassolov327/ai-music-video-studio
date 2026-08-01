// ---------- Looks: gallery, form, generate + approve workflow ----------
function buildLookPrompt(description){
  const parts = [];
  parts.push(description);
  parts.push('full-body outfit reference photo, neutral standing pose, plain neutral background, even studio lighting, no face detail needed');
  return parts.join(', ');
}

function showLookGallery(cat){
  pausePlayback();
  previewEl.classList.add('align-tl');
  previewEl.onclick = null;
  previewBarEl.textContent = 'Looks';

  const tiles = cat.items.map((it,idx)=>`
    <div class="char-tile" data-idx="${idx}">
      <div class="char-tile-photo">
        ${it.previewImage ? `<img src="${it.previewImage}">` : shirtSvg(26)}
        <div class="char-tile-status status-${lookStatus(it)}" title="${it.approved?'Approved':it.previewImage?'Preview generated, not approved':'Missing required fields'}"></div>
        <div class="char-tile-del" data-del-idx="${idx}" title="Remove">${trashSvg(13)}</div>
      </div>
      <div class="char-tile-name">${it.name}</div>
    </div>`
  ).join('');

  previewEl.innerHTML = `
    <div class="char-gallery">
      <div class="char-grid">
        ${tiles}
        <div class="char-tile char-tile-add" id="addLookTile">
          <div class="char-tile-photo">${plusSvg(26)}</div>
          <div class="char-tile-name">Add look</div>
        </div>
      </div>
    </div>`;

  previewEl.querySelectorAll('[data-del-idx]').forEach(btn=>{
    btn.onclick = (e)=>{
      e.stopPropagation();
      const idx = parseInt(e.target.closest('[data-del-idx]').dataset.delIdx, 10);
      if(typeof deleteGeneratedAssetImage==='function') deleteGeneratedAssetImage(cat.items[idx], 'looks', 'previewImage');
      cat.items.splice(idx,1);
      renderAssets();
      showLookGallery(cat);
      if(typeof saveProjectSoon==='function') saveProjectSoon();
    };
  });
  previewEl.querySelectorAll('.char-tile:not(.char-tile-add)').forEach(tile=>{
    tile.onclick = (e)=>{
      if(e.target.closest('.char-tile-del')) return;
      showLookForm(cat, parseInt(tile.dataset.idx, 10));
    };
  });
  document.getElementById('addLookTile').onclick = ()=> showLookForm(cat);
}

function renderLookGenSection(sectionEl, look){
  if(!sectionEl) return;
  const ready = !!(look.description && look.description.trim());
  if(!ready){
    sectionEl.innerHTML = `<div class="gen-hint">Describe the outfit to generate a preview.</div>`;
    return;
  }
  let html = '';
  if(look.previewImage){
    html += `<div class="shot-preview-thumb"><img src="${look.previewImage}"></div>`;
    html += `<button class="cf-btn${look.approved?'':' primary'}" id="lookApproveBtn" style="width:100%;margin-top:8px;">${look.approved ? 'Approved ✓ — this is the locked look' : 'Approve this look'}</button>`;
  }
  html += `<div id="lookTaskSlot"></div>`;
  sectionEl.innerHTML = html;

  const approveBtn = document.getElementById('lookApproveBtn');
  if(approveBtn){
    approveBtn.onclick = ()=>{
      look.approved = true;
      renderLookGenSection(sectionEl, look);
      renderAssets();
    };
  }
  renderLookTaskSlot(look);
}

async function renderLookTaskSlot(look){
  const slot = document.getElementById('lookTaskSlot');
  if(!slot) return;
  const looksCat = state.categories.find(c=>c.key==='looks');
  const isSaved = looksCat && looksCat.items.some(x=> x.id===look.id);
  if(!isSaved) return; // not saved yet — needs to actually be in the asset list before it can be queued
  const available = await checkPaidGenerationAvailable();
  const freshSlot = document.getElementById('lookTaskSlot');
  if(!freshSlot) return;
  if(!available) return;
  freshSlot.innerHTML = `<button class="cf-btn" id="lookAddToTasksBtn" style="width:100%;margin-top:8px;">Add to Tasks (real AI)</button>`;
  document.getElementById('lookAddToTasksBtn').onclick = ()=>{
    queueAssetGeneration('looks', look);
    freshSlot.innerHTML = `<div class="gen-hint" style="margin-top:8px;color:#5fae7a;">Added to the TASKS queue.</div>`;
  };
}

function showLookForm(cat, editIdx){
  pausePlayback();
  const isEdit = typeof editIdx === 'number';
  const existing = isEdit ? cat.items[editIdx] : null;

  previewEl.classList.remove('align-tl');
  previewEl.onclick = null;
  previewBarEl.textContent = isEdit ? 'Edit look — ' + existing.name : 'Add asset — Looks';

  const defaultName = existing ? existing.name : 'Look ' + (cat.items.length + 1);

  previewEl.innerHTML = `
    <div class="char-form">
      <h3>${isEdit ? 'Edit look' : 'New look'}</h3>
      <p class="sub">${isEdit ? 'Update this outfit.' : 'Design an outfit — attach it to a character later, per scene.'}</p>

      <div class="cf-field">
        <label>Name</label>
        <input type="text" id="lkName" value="${defaultName}">
      </div>
      <div class="cf-field">
        <label>Description <span style="color:var(--text-3);font-weight:400;">— prompt for the outfit</span></label>
        <textarea id="lkDesc" placeholder="e.g. leather jacket, blue jeans, sneakers" style="min-height:80px;">${existing && existing.description ? existing.description : ''}</textarea>
        <button class="cf-btn ai-assist-btn" id="lkDescAssistBtn" style="width:100%;margin-top:6px;display:none;">✨ Improve with AI</button>
      </div>

      <div class="gen-section" id="lookGenSection"></div>

      <div class="cf-actions">
        <button class="cf-btn" id="lkCancel">Cancel</button>
        <button class="cf-btn primary" id="lkSave" ${defaultName.trim() ? '' : 'disabled'}>${isEdit ? 'Save changes' : 'Add look'}</button>
      </div>
    </div>
  `;

  const nameInput = document.getElementById('lkName');
  const descInput = document.getElementById('lkDesc');
  const saveBtn = document.getElementById('lkSave');

  // working copy so Cancel doesn't leave a half-generated look behind
  const draft = existing ? Object.assign({}, existing) : {
    id: 'lk' + (lookSeq++), name: defaultName, description: '',
    previewImage: null, approved: false,
  };

  function refreshGen(){
    draft.name = nameInput.value.trim();
    draft.description = descInput.value;
    renderLookGenSection(document.getElementById('lookGenSection'), draft);
  }
  wireAiAssistButton('lkDescAssistBtn', 'lkDesc',
    (typeof buildAssetContextSummary==='function' ? buildAssetContextSummary() + '\n\n' : '')
    + 'Rewrite this rough outfit idea into a vivid, specific wardrobe description for an AI image generator — materials, colors, fit, condition. One or two sentences. Reply with only the rewritten description, nothing else.',
    refreshGen);
  nameInput.addEventListener('input', ()=>{ saveBtn.disabled = nameInput.value.trim().length===0; });
  descInput.addEventListener('input', refreshGen);
  refreshGen();

  document.getElementById('lkCancel').onclick = ()=> showLookGallery(cat);
  saveBtn.onclick = ()=>{
    if(nameInput.value.trim().length===0) return;
    const data = {
      id: draft.id,
      name: nameInput.value.trim(),
      description: descInput.value.trim(),
      previewImage: draft.previewImage,
      approved: draft.approved,
      _assetFiles: draft._assetFiles,
    };
    if(isEdit) cat.items[editIdx] = data;
    else cat.items.push(data);
    renderAssets();
    showLookGallery(cat);
  };
}


