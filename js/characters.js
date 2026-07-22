// ---------- preview: character card (detail view) ----------
function showCharacterCard(cat, idx){
  pausePlayback();
  previewEl.classList.remove('align-tl');
  const it = cat.items[idx];
  previewBarEl.textContent = 'Character card — ' + it.name;

  const filledSlots = it.angleSlots ? CHAR_ANGLE_SLOTS.filter(s=>it.angleSlots[s.key]) : [];
  const coreDone = filledCoreAngleCount(it.angleSlots);
  const anglesHtml = filledSlots.length
    ? `<div class="char-card-section-title">Reference angles — ${coreDone}/${coreAngleCountTotal()} core</div>
       <div class="char-card-angles">${filledSlots.map(s=>`<div class="char-card-angle" style="background-image:url(${it.angleSlots[s.key]})" title="${s.label}"></div>`).join('')}</div>`
    : `<div class="char-card-section-title">Reference angles — 0/${coreAngleCountTotal()} core</div>
       <div class="gen-hint" style="margin-top:0;">Add reference photos via Edit to build a full turnaround.</div>`;

  previewEl.innerHTML = `
    <div class="char-card" id="charCard">
      <div class="char-card-photo" id="cardPhoto" style="${it.photo ? `background-image:url(${it.photo})` : ''}">
        ${it.photo ? '' : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="12" cy="8" r="4"></circle><path d="M4 21c0-4 4-6 8-6s8 2 8 6"></path></svg>'}
      </div>
      <div class="char-card-body">
        <p class="char-card-name">${it.name}</p>
        ${it.role ? `<span class="char-card-role">${it.role}</span>` : ''}
        ${it.description ? `<p class="char-card-desc">${it.description}</p>` : ''}
        ${anglesHtml}
        <div class="char-card-actions">
          <button class="cf-btn" id="cardBack">Back to characters</button>
          <div style="display:flex;gap:8px;">
            <button class="cf-btn" id="cardEdit">Edit</button>
            <button class="cf-btn" id="cardDelete" style="color:var(--danger);">Delete</button>
          </div>
        </div>
        <div class="gen-section" id="genSection"></div>
      </div>
    </div>`;

  renderGenSection(cat, idx);

  document.getElementById('cardBack').onclick = ()=> showCharacterGallery(cat);
  document.getElementById('cardEdit').onclick = ()=> showCharacterForm(cat, idx);
  document.getElementById('cardDelete').onclick = ()=>{
    cat.items.splice(idx,1);
    renderAssets();
    showCharacterGallery(cat);
  };

  // click on the surrounding empty area (not the card itself) returns to the gallery
  previewEl.onclick = (e)=>{
    if(e.target === previewEl) showCharacterGallery(cat);
  };
}

// ---------- preview: character creation / edit form ----------
function showCharacterForm(cat, editIdx){
  pausePlayback();
  const isEdit = typeof editIdx === 'number';
  const existing = isEdit ? cat.items[editIdx] : null;

  previewEl.classList.remove('align-tl');
  previewEl.onclick = null;
  previewBarEl.textContent = isEdit ? 'Edit character — ' + existing.name : 'Add asset — Band / Characters';

  const angleSlots = (existing && existing.angleSlots) ? Object.assign(emptyAngleSlots(), existing.angleSlots) : emptyAngleSlots();

  previewEl.innerHTML = `
    <div class="char-form">
      <h3>${isEdit ? 'Edit character' : 'New character'}</h3>
      <p class="sub">${isEdit ? 'Update the saved character details.' : 'Add a band member as a digital actor for this project.'}</p>

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

      <div class="req-checklist">
        <div class="req-title">For a reliable reference set</div>
        Even, neutral light · plain background · no sunglasses or heavy filters · face fills ~40–70% of the portrait shots · same hair/outfit across the set.
      </div>

      <div class="cf-field">
        <label>Reference photos</label>
        <div class="angle-progress" id="angleProgress"></div>
        <div class="angle-slots-grid" id="angleSlotsGrid"></div>
        <input type="file" id="slotFileInput" accept="image/*,.heic,.heif,.tiff,.tif,.bmp,.svg,.avif,.webp" style="position:absolute;width:1px;height:1px;opacity:0;overflow:hidden;">
      </div>

      <div class="gen-section" id="genSectionForm"></div>

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
  const slotFileInput = document.getElementById('slotFileInput');
  let formRefText = existing ? existing.referenceCard || null : null;
  let formSheet = existing ? existing.turnaroundSheet || null : null;
  let activeSlotKey = null;

  function refreshFormGen(){
    const data = {
      name: nameInput.value.trim(),
      role: roleInput.value.trim(),
      description: notesInput.value.trim(),
      photo: angleSlots.front,
      angleSlots,
    };
    renderGenBlock(document.getElementById('genSectionForm'), data, formRefText, (text, sheet)=>{
      formRefText = text;
      if(sheet) formSheet = sheet;
      refreshFormGen();
    }, {
      kind:'character',
      requireCoreAngles:true,
      buildSheet: buildTurnaroundSheet,
      existingSheet: formSheet,
    });
  }

  function renderSlots(){
    const filled = filledCoreAngleCount(angleSlots);
    document.getElementById('angleProgress').innerHTML = `<b>${filled}/${coreAngleCountTotal()}</b> core angles captured${filled>=coreAngleCountTotal()?' — nice, that\u2019s the full set':''}`;
    const grid = document.getElementById('angleSlotsGrid');
    grid.innerHTML = CHAR_ANGLE_SLOTS.map(s=>{
      const src = angleSlots[s.key];
      return `
        <div class="angle-slot${src?' filled':''}${s.required?'':' optional'}" data-slot="${s.key}" title="${s.hint}">
          ${src ? `<img src="${src}"><div class="slot-remove" data-remove="${s.key}">${(function(){return '<svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>';})()}</div>` : `<span class="slot-plus">${plusSvg(15)}</span>`}
          <span class="slot-label">${s.label}${s.required?'':' (opt.)'}</span>
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
        angleSlots[btn.dataset.remove] = null;
        renderSlots();
        refreshFormGen();
      };
    });
  }
  renderSlots();

  slotFileInput.onchange = async ()=>{
    const file = slotFileInput.files[0];
    if(!file || !activeSlotKey) return;
    try{
      const dataUrl = await loadImageAsDataURL(file);
      angleSlots[activeSlotKey] = dataUrl;
      renderSlots();
      refreshFormGen();
    } catch(err){}
    slotFileInput.value = '';
  };

  function refreshSaveState(){
    saveBtn.disabled = nameInput.value.trim().length===0;
  }
  nameInput.addEventListener('input', ()=>{ refreshSaveState(); refreshFormGen(); });
  roleInput.addEventListener('input', refreshFormGen);
  notesInput.addEventListener('input', refreshFormGen);
  refreshFormGen();

  document.getElementById('cfCancel').onclick = ()=>{
    if(isEdit) showCharacterCard(cat, editIdx);
    else showCharacterGallery(cat);
  };
  saveBtn.onclick = ()=>{
    if(nameInput.value.trim().length===0) return;
    const data = {
      id: existing && existing.id ? existing.id : 'c' + (charSeq++),
      name: nameInput.value.trim(),
      icon: 'ti-user',
      live: !!angleSlots.front,
      photo: angleSlots.front,
      role: roleInput.value.trim(),
      description: notesInput.value.trim(),
      angleSlots,
      referenceCard: formRefText,
      turnaroundSheet: formSheet,
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
  };
}

