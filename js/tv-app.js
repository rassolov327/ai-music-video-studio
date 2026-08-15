// ---------- /TV app: tab switching, approval gates, boot ----------

function showTvPage(page){
  tvState.activeTab = page;
  document.querySelectorAll('.tv-page-tab').forEach(t=> t.classList.toggle('active', t.dataset.tvPage===page));
  document.querySelectorAll('.tv-page').forEach(el=> el.classList.toggle('hidden', el.dataset.tvPage!==page));
  renderTvApprovalButton();
  if(page==='news') renderTvNewsPickers();
  if(page==='grid') renderTvGrid();
}

function renderTvApprovalButton(){
  const btn = document.getElementById('tvApproveBtn');
  if(!btn) return;
  const approved = !!tvState.approvals[tvState.activeTab];
  btn.classList.toggle('tv-approved', approved);
  btn.textContent = approved ? '✓ Утверждено в выпуск' : 'Утвердить в выпуск';
}

function toggleTvApproval(){
  const tab = tvState.activeTab;
  tvState.approvals[tab] = !tvState.approvals[tab];
  renderTvApprovalButton();
}

// ---- shared modal (anchor detail / form / Character Card builder swap into this) ----
function tvOpenModal(){
  document.getElementById('tvAnchorModal').classList.remove('hidden');
}
function tvCloseModal(){
  document.getElementById('tvAnchorModal').classList.add('hidden');
  document.getElementById('tvAnchorModalBody').innerHTML = '';
  tvAnchorCardBuilderOpenId = null;
}

// ---- reference-capable model list (for Character Card generation) ----
let tvModelOptions = [];
async function tvLoadModelList(){
  try{
    const res = await fetch('/api/models');
    const data = await res.json().catch(()=> null);
    tvModelOptions = (data && data.models) || [];
  } catch(err){
    tvModelOptions = [];
  }
}
function tvPickReferenceCapableModel(){
  return tvModelOptions.find(m=> m.supportsReferenceImage) || null;
}

// ---- generation infra — same endpoints the main app's Character Card builder uses ----
async function tvUploadReferencePhoto(photoUrl){
  let dataUrl = photoUrl;
  if(photoUrl.indexOf('blob:')===0){
    const blob = await (await fetch(photoUrl)).blob();
    dataUrl = await new Promise((resolve, reject)=>{
      const fr = new FileReader();
      fr.onload = ()=> resolve(fr.result);
      fr.onerror = reject;
      fr.readAsDataURL(blob);
    });
  }
  const res = await fetch('/api/upload-reference-image', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ dataUrl }),
  });
  const data = await res.json().catch(()=> null);
  if(!res.ok || !data || !data.url){
    console.warn('[tv] could not upload reference photo, generating without it:', data && data.message);
    return undefined;
  }
  return data.url;
}
async function tvPollGenerationSlot(taskId){
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
function tvGatherReferencePhotos(anchor){
  const photos = TV_CARD_INPUT_SLOTS.map(s=> anchor.card.inputSlots[s.key]).filter(Boolean);
  if(photos.length===0 && anchor.photo) photos.push(anchor.photo);
  return photos;
}
// Same turnaround-sheet prompt template characters.js uses — generic enough (any person,
// any wardrobe) to apply to a TV anchor without changes.
function tvBuildCardSheetPrompt(anchor, basePrompt, extra){
  return [
    basePrompt || anchor.description || '',
    'character reference turnaround sheet, two rows of four panels each, the exact same person with identical face, hair, build, and outfit in every panel',
    'top row, panel 1 (full body): facing straight at the camera, front view',
    'top row, panel 2 (full body): body and face turned so the person is looking toward the LEFT edge of the frame — their right cheek and right ear are hidden from view',
    'top row, panel 3 (full body): the mirror opposite of panel 2 — body and face turned so the person is looking toward the RIGHT edge of the frame instead — their left cheek and left ear are hidden from view. Panels 2 and 3 must face opposite directions from each other, not the same direction',
    'top row, panel 4 (full body): viewed from directly behind, back of the head and body, face not visible',
    'bottom row, panel 1 (close-up portrait): facing straight at the camera, matching panel 1 above',
    'bottom row, panel 2 (close-up portrait): looking toward the LEFT edge of the frame, matching the turn direction of panel 2 above',
    'bottom row, panel 3 (close-up portrait): the mirror opposite of bottom panel 2 — looking toward the RIGHT edge of the frame instead, matching the turn direction of panel 3 above. Bottom panels 2 and 3 must face opposite directions from each other, not the same direction',
    'bottom row, panel 4 (close-up): back of the head only, matching panel 4 above',
    extra,
    'plain neutral background, even studio lighting, photoreal, highly detailed, no text, no labels, no panel borders',
  ].filter(Boolean).join(', ');
}

// ---- local persistence (js/tv-persistence.js) ----
// Anchors live in tvState only — saving means writing the workspace (disk folder or
// IndexedDB), not talking to a server. Binary fields (photo, generated card sheet) are
// captured as separate blob assets at the moment they're picked/generated (see
// tvOpenAnchorForm's save handler and tvRunCreateCard) — tvSaveAnchorLocal() just merges
// the plain fields and triggers the workspace save.
function tvSaveAnchorLocal(payload, existing){
  if(existing){
    Object.assign(existing, payload);
    tvSaveSoon();
    return existing;
  }
  const anchor = Object.assign({ id: tvAnchorSeq++, card: null, approved: false, _assetFiles: {} }, payload);
  tvState.tvAnchors.push(anchor);
  tvSaveSoon();
  return anchor;
}
function tvDeleteAnchorLocal(id){
  tvState.tvAnchors = tvState.tvAnchors.filter(a=> a.id!==id);
  tvSaveSoon();
}

// ---- status (red = incomplete basics, yellow = basics done but no card yet, green = card built) ----
function tvAnchorStatus(a){
  if(!a.name || !a.photo || !a.rubric || !a.description) return 'red';
  const hasSheet = !!(a.card && a.card.images && a.card.images.sheet && a.card.images.sheet.url);
  return hasSheet ? 'green' : 'yellow';
}

// ---- Work tab: anchors gallery ----
function renderTvAnchors(){
  const el = document.getElementById('tvAnchorsGrid');
  if(!el) return;
  if(!tvState.tvAnchors.length){
    el.innerHTML = `<div class="tv-empty-hint">Ведущих пока нет — нажмите «+ Ведущий».</div>`;
    return;
  }
  el.innerHTML = tvState.tvAnchors.map(a=> `
    <div class="char-tile" data-id="${a.id}">
      <div class="char-tile-photo">${a.photo ? `<img src="${a.photo}">` : '<i class="ti ti-user"></i>'}</div>
      <div class="char-tile-status status-${tvAnchorStatus(a)}"></div>
      <div class="char-tile-name">${a.name}</div>
      ${a.rubric ? `<div class="char-tile-role">${tvRubricLabel(a.rubric)}</div>` : ''}
    </div>`).join('');
  el.querySelectorAll('.char-tile').forEach(tile=>{
    tile.onclick = ()=>{
      const anchor = tvState.tvAnchors.find(a=> String(a.id)===tile.dataset.id);
      if(anchor) tvOpenAnchorDetail(anchor);
    };
  });
}

// ---- anchor detail view (modal) ----
function tvOpenAnchorDetail(anchor){
  const hasSheet = !!(anchor.card && anchor.card.images && anchor.card.images.sheet && anchor.card.images.sheet.url);
  const body = document.getElementById('tvAnchorModalBody');
  body.innerHTML = `
    <div class="char-card">
      <div class="char-card-photo">
        ${anchor.photo ? `<img src="${anchor.photo}">` : '<i class="ti ti-user" style="font-size:40px;"></i>'}
      </div>
      <div class="char-card-body">
        <p class="char-card-name">${anchor.name}</p>
        ${anchor.rubric ? `<span class="char-card-role">${tvRubricLabel(anchor.rubric)}</span>` : ''}
        ${anchor.description ? `<p class="char-card-desc">${anchor.description}</p>` : ''}
        ${anchor.voiceId ? `<div class="gen-hint" style="margin-top:-8px;margin-bottom:14px;">Голос: ${anchor.voiceId}</div>` : ''}
        <div class="char-card-section-title">Character Card</div>
        ${hasSheet
          ? `<div class="char-card-angles"><div class="char-card-angle" style="width:100%;height:90px;"><img src="${anchor.card.images.sheet.url}"></div></div>`
          : `<div class="gen-hint" style="margin-top:0;">Лист ещё не создан — на нём держится каждая генерация этого ведущего.</div>`}
        <div class="char-card-actions">
          <button class="cf-btn" id="tvAnchorBack">Закрыть</button>
          <div style="display:flex;gap:8px;">
            <button class="cf-btn" id="tvAnchorEdit">Изменить</button>
            <button class="cf-btn" id="tvAnchorDelete" style="color:var(--danger);">Удалить</button>
          </div>
        </div>
        <button class="cf-btn primary" id="tvAnchorBuildBtn" style="width:100%;margin-top:12px;">${hasSheet ? 'Изменить Character Card' : 'Создать Character Card'}</button>
      </div>
    </div>`;
  document.getElementById('tvAnchorBack').onclick = tvCloseModal;
  document.getElementById('tvAnchorEdit').onclick = ()=> tvOpenAnchorForm(anchor);
  document.getElementById('tvAnchorBuildBtn').onclick = ()=> tvOpenAnchorCardBuilder(anchor);
  document.getElementById('tvAnchorDelete').onclick = ()=>{
    if(!confirm('Удалить ведущего «' + anchor.name + '»?')) return;
    tvDeleteAnchorLocal(anchor.id);
    renderTvAnchors();
    tvCloseModal();
  };
  tvOpenModal();
}

// ---- anchor create/edit form (the lightweight "step 1" card) ----
function tvOpenAnchorForm(existing){
  const body = document.getElementById('tvAnchorModalBody');
  body.innerHTML = `
    <div class="char-form">
      <h3>${existing ? 'Изменить ведущего' : 'Новый ведущий'}</h3>
      <p class="sub">${existing ? 'Обновите данные ведущего.' : 'Имя, рубрика, описание, голос, одно фото. После сохранения можно собрать полную Character Card.'}</p>
      <div class="cf-field"><label>Имя</label><input type="text" id="tvAnchorName" placeholder="например, Анна Соколова" value="${existing ? existing.name : ''}"></div>
      <div class="cf-field"><label>Рубрика</label><select id="tvAnchorRubric">${TV_RUBRICS.map(r=> `<option value="${r.key}"${existing && existing.rubric===r.key ? ' selected' : ''}>${r.label}</option>`).join('')}</select></div>
      <div class="cf-field"><label>Описание / характер</label><textarea id="tvAnchorDesc" placeholder="Внешность, манера, что важно помнить">${existing && existing.description ? existing.description : ''}</textarea></div>
      <div class="cf-field"><label>Голос (TTS id) <span style="color:var(--text-3);font-weight:400;">— пригодится во вкладке Студия</span></label><input type="text" id="tvAnchorVoice" placeholder="пока свободный текст" value="${existing && existing.voiceId ? existing.voiceId : ''}"></div>
      <div class="cf-field">
        <label>Фото</label>
        <label class="photo-drop${existing && existing.photo ? ' has-photo' : ''}" id="tvAnchorPhotoDrop">
          ${existing && existing.photo ? `<img src="${existing.photo}">` : ''}
          <span class="photo-drop-plus"><i class="ti ti-plus"></i></span><span class="photo-drop-text">Добавить фото</span>
          <input type="file" id="tvAnchorPhotoInput" accept="image/*" style="position:absolute;width:1px;height:1px;opacity:0;overflow:hidden;">
        </label>
      </div>
      <div class="cf-actions">
        <button class="cf-btn" id="tvAnchorCancel">Отмена</button>
        <button class="cf-btn primary" id="tvAnchorSave" ${existing && existing.name ? '' : 'disabled'}>${existing ? 'Сохранить' : 'Добавить'}</button>
      </div>
    </div>`;

  const photoDrop = document.getElementById('tvAnchorPhotoDrop');
  let photoInput = document.getElementById('tvAnchorPhotoInput');
  let photoDataUrl = existing ? existing.photo || null : null;
  photoDrop.onclick = (e)=>{ if(!e.target.closest('input')) photoInput.click(); };
  function wirePhotoInput(){
    photoInput = document.getElementById('tvAnchorPhotoInput');
    photoInput.onchange = async ()=>{
      const file = photoInput.files[0];
      if(!file) return;
      try{
        photoDataUrl = await loadImageAsDataURL(file);
        photoDrop.classList.add('has-photo');
        photoDrop.innerHTML = `<img src="${photoDataUrl}"><span class="photo-drop-plus"><i class="ti ti-plus"></i></span><span class="photo-drop-text">Добавить фото</span><input type="file" id="tvAnchorPhotoInput" accept="image/*" style="position:absolute;width:1px;height:1px;opacity:0;overflow:hidden;">`;
        wirePhotoInput();
      } catch(err){}
    };
  }
  wirePhotoInput();

  const nameInput = document.getElementById('tvAnchorName');
  const saveBtn = document.getElementById('tvAnchorSave');
  nameInput.addEventListener('input', ()=>{ saveBtn.disabled = nameInput.value.trim().length===0; });

  document.getElementById('tvAnchorCancel').onclick = ()=> existing ? tvOpenAnchorDetail(existing) : tvCloseModal();
  saveBtn.onclick = async ()=>{
    const name = nameInput.value.trim();
    if(!name) return;
    saveBtn.disabled = true; saveBtn.textContent = 'Сохранение…';
    // A freshly picked file comes through as a data: URL (from loadImageAsDataURL); an
    // unchanged/restored photo is already a blob: URL from a persisted asset — only the
    // former needs (re-)persisting.
    const isNewPhoto = photoDataUrl && photoDataUrl.indexOf('data:')===0;
    const payload = {
      name,
      rubric: document.getElementById('tvAnchorRubric').value,
      description: document.getElementById('tvAnchorDesc').value.trim(),
      voiceId: document.getElementById('tvAnchorVoice').value.trim(),
    };
    if(!isNewPhoto) payload.photo = photoDataUrl;
    const anchor = tvSaveAnchorLocal(payload, existing || null);
    if(isNewPhoto){
      const result = await tvPersistLocalImageAsset('anchor:' + anchor.id + ':photo', photoDataUrl);
      anchor.photo = result ? result.url : photoDataUrl;
      anchor._assetFiles = anchor._assetFiles || {};
      anchor._assetFiles.photo = !!result;
      anchor._assetFiles.photoFile = result ? result.fileName : undefined;
      tvSaveSoon();
    }
    renderTvAnchors();
    tvOpenAnchorDetail(anchor);
  };
  tvOpenModal();
}

// ---- Character Card builder — the real, generation-driving reference set ----
let tvAnchorCardBuilderOpenId = null;

function tvOpenAnchorCardBuilder(anchor){
  tvAnchorCardBuilderOpenId = anchor.id;
  if(!anchor.card) anchor.card = { inputSlots: tvEmptyCardInputSlots(), prompt: anchor.description || '', images: {} };
  if(!anchor.card.inputSlots) anchor.card.inputSlots = tvEmptyCardInputSlots();
  if(!anchor.card.images) anchor.card.images = {};
  if(!anchor.card.inputSlots.front && anchor.photo) anchor.card.inputSlots.front = anchor.photo;

  const hasSheet = !!(anchor.card.images.sheet && anchor.card.images.sheet.url);
  const body = document.getElementById('tvAnchorModalBody');
  body.innerHTML = `
    <div class="char-form card-builder">
      <h3>Character Card — ${anchor.name}</h3>
      <p class="sub">На этой карте держится каждая генерация ${anchor.name}. Добавьте, что есть — хватит и одного фото — опишите ведущего и создайте полный набор.</p>
      <div class="cf-field">
        <label>Референс-фото <span style="color:var(--text-3);font-weight:400;">— опционально, больше — лучше</span></label>
        <div class="angle-slots-grid" id="tvCardInputGrid"></div>
        <input type="file" id="tvCardSlotFileInput" accept="image/*" style="position:absolute;width:1px;height:1px;opacity:0;overflow:hidden;">
      </div>
      <div class="cf-field">
        <label>Описание <span style="color:var(--text-3);font-weight:400;">— промпт для карты</span></label>
        <textarea id="tvCardPromptInput" style="min-height:80px;" placeholder="Внешность, одежда, отличительные черты...">${anchor.card.prompt || anchor.description || ''}</textarea>
      </div>
      <button class="cf-btn primary" id="tvCardCreateBtn" style="width:100%;">${hasSheet ? 'Пересоздать карту' : 'Создать карту'}</button>
      <div class="gen-hint" id="tvCardModelHint" style="margin-top:6px;"></div>
      <div class="char-card-section-title" style="margin-top:16px;">Изображения карты</div>
      <div class="card-output-grid" id="tvCardOutputGrid" style="grid-template-columns:1fr;"></div>
      <div class="cf-actions" style="margin-top:16px;">
        <button class="cf-btn" id="tvCardBuilderBack">Назад к ведущему</button>
      </div>
    </div>`;

  tvRenderCardInputGrid(anchor);
  tvRenderCardOutputGrid(anchor);

  const model = tvPickReferenceCapableModel();
  const modelHint = document.getElementById('tvCardModelHint');
  if(!model){
    modelHint.textContent = 'Нет подключённой модели с поддержкой референс-фото (например, Nano Banana Pro).';
    modelHint.style.color = 'var(--danger)';
    document.getElementById('tvCardCreateBtn').disabled = true;
  } else {
    modelHint.textContent = 'Генерация через ' + model.label + ' (использует ваши референс-фото напрямую).';
  }

  document.getElementById('tvCardPromptInput').addEventListener('input', (e)=>{ anchor.card.prompt = e.target.value; });
  document.getElementById('tvCardCreateBtn').onclick = ()=> tvRunCreateCard(anchor);
  document.getElementById('tvCardBuilderBack').onclick = ()=>{
    tvAnchorCardBuilderOpenId = null;
    tvOpenAnchorDetail(anchor);
  };
  tvOpenModal();
}

function tvRenderCardInputGrid(anchor){
  const grid = document.getElementById('tvCardInputGrid');
  if(!grid) return;
  const slotFileInput = document.getElementById('tvCardSlotFileInput');
  let activeSlotKey = null;
  grid.innerHTML = TV_CARD_INPUT_SLOTS.map(s=>{
    const src = anchor.card.inputSlots[s.key];
    return `<div class="angle-slot${src?' filled':' optional'}" data-slot="${s.key}" title="${s.hint}">
      ${src ? `<img src="${src}"><div class="slot-remove" data-remove="${s.key}"><i class="ti ti-x" style="font-size:10px;"></i></div>` : `<span class="slot-plus"><i class="ti ti-plus"></i></span>`}
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
      anchor.card.inputSlots[btn.dataset.remove] = null;
      tvRenderCardInputGrid(anchor);
    };
  });
  slotFileInput.onchange = async ()=>{
    const file = slotFileInput.files[0];
    if(!file || !activeSlotKey) return;
    try{
      const dataUrl = await loadImageAsDataURL(file);
      anchor.card.inputSlots[activeSlotKey] = dataUrl;
      tvRenderCardInputGrid(anchor);
    } catch(err){}
    slotFileInput.value = '';
  };
}

function tvRenderCardOutputGrid(anchor){
  const grid = document.getElementById('tvCardOutputGrid');
  if(!grid) return;
  const entry = anchor.card.images.sheet;
  const pending = anchor.card._pending && anchor.card._pending.sheet;
  let inner;
  if(entry && entry.url) inner = `<img src="${entry.url}">`;
  else if(pending) inner = `<div class="task-tile-spin"></div>`;
  else inner = `<span class="card-output-empty">Ещё не сгенерировано</span>`;
  grid.innerHTML = `<div class="card-sheet-tile">${inner}</div>`;
}
function tvRenderCardOutputGridIfOpen(anchor){
  if(tvAnchorCardBuilderOpenId===anchor.id) tvRenderCardOutputGrid(anchor);
}

async function tvRunCreateCard(anchor){
  const model = tvPickReferenceCapableModel();
  if(!model) return;
  const btn = document.getElementById('tvCardCreateBtn');
  if(btn){ btn.disabled = true; btn.textContent = 'Генерация…'; }
  const promptText = document.getElementById('tvCardPromptInput').value.trim();
  anchor.card.prompt = promptText;
  anchor.card._pending = anchor.card._pending || {};
  anchor.card._pending.sheet = true;
  tvRenderCardOutputGridIfOpen(anchor);

  try{
    const photos = tvGatherReferencePhotos(anchor);
    const referenceImageUrls = [];
    for(const p of photos){
      const url = await tvUploadReferencePhoto(p);
      if(url) referenceImageUrls.push(url);
    }
    const prompt = tvBuildCardSheetPrompt(anchor, promptText);
    const res = await fetch('/api/generate-image/start', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt, width: TV_CARD_SHEET_WIDTH, height: TV_CARD_SHEET_HEIGHT, model: model.id,
        referenceImageUrl: referenceImageUrls,
        meta: { kind: 'tv-anchor-card', anchorId: anchor.id, anchorName: anchor.name },
      }),
    });
    const data = await res.json().catch(()=> null);
    if(res.status===401) throw new Error('Нужно войти в аккаунт — откройте / и авторизуйтесь, затем вернитесь на /tv.');
    if(!res.ok || !data || !data.taskId) throw new Error((data && data.message) || 'Не удалось запустить генерацию.');
    const imageUrl = await tvPollGenerationSlot(data.taskId);
    // KIE's URL is temp-hosted — download it once and keep a durable local copy, same as
    // every other generation in this app.
    const persisted = await tvPersistRemoteImageAsset('anchor:' + anchor.id + ':sheet', imageUrl);
    anchor.card.images.sheet = anchor.card.images.sheet || {};
    anchor.card.images.sheet.url = persisted ? persisted.url : imageUrl;
    anchor._assetFiles = anchor._assetFiles || {};
    anchor._assetFiles.sheet = !!persisted;
    anchor._assetFiles.sheetFile = persisted ? persisted.fileName : undefined;
    delete anchor.card._pending.sheet;
    tvSaveSoon();
  } catch(err){
    console.warn('[tv] failed to generate the anchor card:', err);
    alert('Не удалось создать Character Card: ' + err.message);
  } finally {
    if(anchor.card._pending) delete anchor.card._pending.sheet;
    tvRenderCardOutputGridIfOpen(anchor);
  }

  if(btn){ btn.disabled = false; btn.textContent = (anchor.card.images.sheet && anchor.card.images.sheet.url) ? 'Пересоздать карту' : 'Создать карту'; }
  renderTvAnchors();
}

// ---- Work tab: studio backdrops — Object Card (consistency reference) + angle shots
// (finished, independently usable establishing images), both patterns reused from
// object-card.js / locations.js the same way anchors reuse characters.js above. ----
function tvSaveBackdropLocal(payload, existing){
  if(existing){
    Object.assign(existing, payload);
    tvSaveSoon();
    return existing;
  }
  const backdrop = Object.assign({ id: tvBackdropSeq++, card: null, angleShots: {}, approved: false, _assetFiles: {} }, payload);
  tvState.tvBackdrops.push(backdrop);
  tvSaveSoon();
  return backdrop;
}
function tvDeleteBackdropLocal(id){
  tvState.tvBackdrops = tvState.tvBackdrops.filter(b=> b.id!==id);
  tvSaveSoon();
}
function tvBackdropStatus(b){
  if(!b.name || !b.photo || !b.description) return 'red';
  const hasSheet = !!(b.card && b.card.images && b.card.images.sheet && b.card.images.sheet.url);
  return hasSheet ? 'green' : 'yellow';
}

function renderTvBackdrops(){
  const el = document.getElementById('tvBackdropsGrid');
  if(!el) return;
  if(!tvState.tvBackdrops.length){
    el.innerHTML = `<div class="tv-empty-hint">Декораций студии пока нет — нажмите «+ Декорация».</div>`;
    return;
  }
  el.innerHTML = tvState.tvBackdrops.map(b=> `
    <div class="char-tile" data-id="${b.id}">
      <div class="char-tile-photo">${b.photo ? `<img src="${b.photo}">` : '<i class="ti ti-photo"></i>'}</div>
      <div class="char-tile-status status-${tvBackdropStatus(b)}"></div>
      <div class="char-tile-name">${b.name}</div>
    </div>`).join('');
  el.querySelectorAll('.char-tile').forEach(tile=>{
    tile.onclick = ()=>{
      const backdrop = tvState.tvBackdrops.find(b=> String(b.id)===tile.dataset.id);
      if(backdrop) tvOpenBackdropDetail(backdrop);
    };
  });
}

function tvOpenBackdropDetail(backdrop){
  const hasSheet = !!(backdrop.card && backdrop.card.images && backdrop.card.images.sheet && backdrop.card.images.sheet.url);
  const filledAngles = TV_ANGLE_KEYS.filter(k=> backdrop.angleShots && backdrop.angleShots[k] && backdrop.angleShots[k].photo);
  const body = document.getElementById('tvAnchorModalBody');
  body.innerHTML = `
    <div class="char-card">
      <div class="char-card-photo">
        ${backdrop.photo ? `<img src="${backdrop.photo}">` : '<i class="ti ti-photo" style="font-size:40px;"></i>'}
      </div>
      <div class="char-card-body">
        <p class="char-card-name">${backdrop.name}</p>
        ${backdrop.description ? `<p class="char-card-desc">${backdrop.description}</p>` : ''}
        <div class="char-card-section-title">Object Card</div>
        ${hasSheet
          ? `<div class="char-card-angles"><div class="char-card-angle" style="width:100%;height:90px;"><img src="${backdrop.card.images.sheet.url}"></div></div>`
          : `<div class="gen-hint" style="margin-top:0;">Лист ещё не создан — на нём держится консистентность декорации между генерациями.</div>`}
        <div class="char-card-section-title" style="margin-top:14px;">Ракурсы (${filledAngles.length}/${TV_ANGLE_KEYS.length})</div>
        ${filledAngles.length
          ? `<div class="char-card-angles">${filledAngles.map(k=> `<div class="char-card-angle" style="width:60px;height:60px;"><img src="${backdrop.angleShots[k].photo}"></div>`).join('')}</div>`
          : `<div class="gen-hint" style="margin-top:0;">Готовых ракурсов пока нет.</div>`}
        <div class="char-card-actions">
          <button class="cf-btn" id="tvBackdropBack">Закрыть</button>
          <div style="display:flex;gap:8px;">
            <button class="cf-btn" id="tvBackdropEdit">Изменить</button>
            <button class="cf-btn" id="tvBackdropDelete" style="color:var(--danger);">Удалить</button>
          </div>
        </div>
        <button class="cf-btn primary" id="tvBackdropCardBtn" style="width:100%;margin-top:12px;">${hasSheet ? 'Изменить Object Card' : 'Создать Object Card'}</button>
        <button class="cf-btn" id="tvBackdropAnglesBtn" style="width:100%;margin-top:8px;">Ракурсы</button>
      </div>
    </div>`;
  document.getElementById('tvBackdropBack').onclick = tvCloseModal;
  document.getElementById('tvBackdropEdit').onclick = ()=> tvOpenBackdropForm(backdrop);
  document.getElementById('tvBackdropCardBtn').onclick = ()=> tvOpenBackdropCardBuilder(backdrop);
  document.getElementById('tvBackdropAnglesBtn').onclick = ()=> tvOpenBackdropAngleShots(backdrop);
  document.getElementById('tvBackdropDelete').onclick = ()=>{
    if(!confirm('Удалить декорацию «' + backdrop.name + '»?')) return;
    tvDeleteBackdropLocal(backdrop.id);
    renderTvBackdrops();
    tvCloseModal();
  };
  tvOpenModal();
}

function tvOpenBackdropForm(existing){
  const body = document.getElementById('tvAnchorModalBody');
  body.innerHTML = `
    <div class="char-form">
      <h3>${existing ? 'Изменить декорацию' : 'Новая декорация'}</h3>
      <p class="sub">${existing ? 'Обновите данные декорации.' : 'Название, описание, одно фото. После сохранения можно собрать Object Card и ракурсы.'}</p>
      <div class="cf-field"><label>Название</label><input type="text" id="tvBackdropName" placeholder="например, Студия новостей" value="${existing ? existing.name : ''}"></div>
      <div class="cf-field"><label>Описание</label><textarea id="tvBackdropDesc" placeholder="Что за декорация, стиль, детали интерьера">${existing && existing.description ? existing.description : ''}</textarea></div>
      <div class="cf-field">
        <label>Фото</label>
        <label class="photo-drop${existing && existing.photo ? ' has-photo' : ''}" id="tvBackdropPhotoDrop">
          ${existing && existing.photo ? `<img src="${existing.photo}">` : ''}
          <span class="photo-drop-plus"><i class="ti ti-plus"></i></span><span class="photo-drop-text">Добавить фото</span>
          <input type="file" id="tvBackdropPhotoInput" accept="image/*" style="position:absolute;width:1px;height:1px;opacity:0;overflow:hidden;">
        </label>
      </div>
      <div class="cf-actions">
        <button class="cf-btn" id="tvBackdropCancel">Отмена</button>
        <button class="cf-btn primary" id="tvBackdropSave" ${existing && existing.name ? '' : 'disabled'}>${existing ? 'Сохранить' : 'Добавить'}</button>
      </div>
    </div>`;

  const photoDrop = document.getElementById('tvBackdropPhotoDrop');
  let photoInput = document.getElementById('tvBackdropPhotoInput');
  let photoDataUrl = existing ? existing.photo || null : null;
  photoDrop.onclick = (e)=>{ if(!e.target.closest('input')) photoInput.click(); };
  function wirePhotoInput(){
    photoInput = document.getElementById('tvBackdropPhotoInput');
    photoInput.onchange = async ()=>{
      const file = photoInput.files[0];
      if(!file) return;
      try{
        photoDataUrl = await loadImageAsDataURL(file);
        photoDrop.classList.add('has-photo');
        photoDrop.innerHTML = `<img src="${photoDataUrl}"><span class="photo-drop-plus"><i class="ti ti-plus"></i></span><span class="photo-drop-text">Добавить фото</span><input type="file" id="tvBackdropPhotoInput" accept="image/*" style="position:absolute;width:1px;height:1px;opacity:0;overflow:hidden;">`;
        wirePhotoInput();
      } catch(err){}
    };
  }
  wirePhotoInput();

  const nameInput = document.getElementById('tvBackdropName');
  const saveBtn = document.getElementById('tvBackdropSave');
  nameInput.addEventListener('input', ()=>{ saveBtn.disabled = nameInput.value.trim().length===0; });

  document.getElementById('tvBackdropCancel').onclick = ()=> existing ? tvOpenBackdropDetail(existing) : tvCloseModal();
  saveBtn.onclick = async ()=>{
    const name = nameInput.value.trim();
    if(!name) return;
    saveBtn.disabled = true; saveBtn.textContent = 'Сохранение…';
    const isNewPhoto = photoDataUrl && photoDataUrl.indexOf('data:')===0;
    const payload = { name, description: document.getElementById('tvBackdropDesc').value.trim() };
    if(!isNewPhoto) payload.photo = photoDataUrl;
    const backdrop = tvSaveBackdropLocal(payload, existing || null);
    if(isNewPhoto){
      const result = await tvPersistLocalImageAsset('backdrop:' + backdrop.id + ':photo', photoDataUrl);
      backdrop.photo = result ? result.url : photoDataUrl;
      backdrop._assetFiles = backdrop._assetFiles || {};
      backdrop._assetFiles.photo = !!result;
      backdrop._assetFiles.photoFile = result ? result.fileName : undefined;
      tvSaveSoon();
    }
    renderTvBackdrops();
    tvOpenBackdropDetail(backdrop);
  };
  tvOpenModal();
}

// ---- Object Card builder (4-slot reference sheet — object-card.js's pattern) ----
let tvBackdropCardBuilderOpenId = null;
function tvBuildBackdropCardSheetPrompt(backdrop, basePrompt, extra){
  return [
    basePrompt || backdrop.description || '',
    'reference turnaround sheet for this exact studio backdrop/set, four panels in a 2x2 grid, the exact same set with identical architecture, materials, colors, and lighting in every panel',
    'top-left panel: viewed straight-on from the front',
    'top-right panel: viewed from directly behind',
    'bottom-left panel: viewed from the left side',
    'bottom-right panel: viewed from the right side — the mirror opposite of the bottom-left panel, facing the opposite direction',
    extra,
    'plain neutral surroundings beyond the set itself, even studio lighting, photoreal, highly detailed, no text, no labels, no panel borders, no people',
  ].filter(Boolean).join(', ');
}
function tvGatherBackdropReferencePhotos(backdrop){
  const photos = TV_OBJECT_CARD_INPUT_SLOTS.map(s=> backdrop.card.inputSlots[s.key]).filter(Boolean);
  if(photos.length===0 && backdrop.photo) photos.push(backdrop.photo);
  return photos;
}
function tvOpenBackdropCardBuilder(backdrop){
  tvBackdropCardBuilderOpenId = backdrop.id;
  if(!backdrop.card) backdrop.card = { inputSlots: tvEmptyObjectCardInputSlots(), prompt: backdrop.description || '', images: {} };
  if(!backdrop.card.inputSlots) backdrop.card.inputSlots = tvEmptyObjectCardInputSlots();
  if(!backdrop.card.images) backdrop.card.images = {};
  if(!backdrop.card.inputSlots.front && backdrop.photo) backdrop.card.inputSlots.front = backdrop.photo;

  const hasSheet = !!(backdrop.card.images.sheet && backdrop.card.images.sheet.url);
  const body = document.getElementById('tvAnchorModalBody');
  body.innerHTML = `
    <div class="char-form card-builder">
      <h3>Object Card — ${backdrop.name}</h3>
      <p class="sub">На этой карте держится консистентность декорации между генерациями. Добавьте, что есть — хватит и одного фото.</p>
      <div class="cf-field">
        <label>Референс-фото <span style="color:var(--text-3);font-weight:400;">— опционально, больше — лучше</span></label>
        <div class="angle-slots-grid" id="tvBackdropCardInputGrid"></div>
        <input type="file" id="tvBackdropCardSlotFileInput" accept="image/*" style="position:absolute;width:1px;height:1px;opacity:0;overflow:hidden;">
      </div>
      <div class="cf-field">
        <label>Описание <span style="color:var(--text-3);font-weight:400;">— промпт для карты</span></label>
        <textarea id="tvBackdropCardPromptInput" style="min-height:80px;">${backdrop.card.prompt || backdrop.description || ''}</textarea>
      </div>
      <button class="cf-btn primary" id="tvBackdropCardCreateBtn" style="width:100%;">${hasSheet ? 'Пересоздать карту' : 'Создать карту'}</button>
      <div class="gen-hint" id="tvBackdropCardModelHint" style="margin-top:6px;"></div>
      <div class="char-card-section-title" style="margin-top:16px;">Изображения карты</div>
      <div class="card-output-grid" id="tvBackdropCardOutputGrid" style="grid-template-columns:1fr;"></div>
      <div class="cf-actions" style="margin-top:16px;">
        <button class="cf-btn" id="tvBackdropCardBuilderBack">Назад к декорации</button>
      </div>
    </div>`;

  tvRenderBackdropCardInputGrid(backdrop);
  tvRenderBackdropCardOutputGrid(backdrop);

  const model = tvPickReferenceCapableModel();
  const modelHint = document.getElementById('tvBackdropCardModelHint');
  if(!model){
    modelHint.textContent = 'Нет подключённой модели с поддержкой референс-фото.';
    modelHint.style.color = 'var(--danger)';
    document.getElementById('tvBackdropCardCreateBtn').disabled = true;
  } else {
    modelHint.textContent = 'Генерация через ' + model.label + '.';
  }

  document.getElementById('tvBackdropCardPromptInput').addEventListener('input', (e)=>{ backdrop.card.prompt = e.target.value; });
  document.getElementById('tvBackdropCardCreateBtn').onclick = ()=> tvRunCreateBackdropCard(backdrop);
  document.getElementById('tvBackdropCardBuilderBack').onclick = ()=>{
    tvBackdropCardBuilderOpenId = null;
    tvOpenBackdropDetail(backdrop);
  };
  tvOpenModal();
}
function tvRenderBackdropCardInputGrid(backdrop){
  const grid = document.getElementById('tvBackdropCardInputGrid');
  if(!grid) return;
  const slotFileInput = document.getElementById('tvBackdropCardSlotFileInput');
  let activeSlotKey = null;
  grid.innerHTML = TV_OBJECT_CARD_INPUT_SLOTS.map(s=>{
    const src = backdrop.card.inputSlots[s.key];
    return `<div class="angle-slot${src?' filled':' optional'}" data-slot="${s.key}" title="${s.hint}">
      ${src ? `<img src="${src}"><div class="slot-remove" data-remove="${s.key}"><i class="ti ti-x" style="font-size:10px;"></i></div>` : `<span class="slot-plus"><i class="ti ti-plus"></i></span>`}
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
      backdrop.card.inputSlots[btn.dataset.remove] = null;
      tvRenderBackdropCardInputGrid(backdrop);
    };
  });
  slotFileInput.onchange = async ()=>{
    const file = slotFileInput.files[0];
    if(!file || !activeSlotKey) return;
    try{
      const dataUrl = await loadImageAsDataURL(file);
      backdrop.card.inputSlots[activeSlotKey] = dataUrl;
      tvRenderBackdropCardInputGrid(backdrop);
    } catch(err){}
    slotFileInput.value = '';
  };
}
function tvRenderBackdropCardOutputGrid(backdrop){
  const grid = document.getElementById('tvBackdropCardOutputGrid');
  if(!grid) return;
  const entry = backdrop.card.images.sheet;
  const pending = backdrop.card._pending && backdrop.card._pending.sheet;
  let inner;
  if(entry && entry.url) inner = `<img src="${entry.url}">`;
  else if(pending) inner = `<div class="task-tile-spin"></div>`;
  else inner = `<span class="card-output-empty">Ещё не сгенерировано</span>`;
  grid.innerHTML = `<div class="card-sheet-tile">${inner}</div>`;
}
function tvRenderBackdropCardOutputGridIfOpen(backdrop){
  if(tvBackdropCardBuilderOpenId===backdrop.id) tvRenderBackdropCardOutputGrid(backdrop);
}
async function tvRunCreateBackdropCard(backdrop){
  const model = tvPickReferenceCapableModel();
  if(!model) return;
  const btn = document.getElementById('tvBackdropCardCreateBtn');
  if(btn){ btn.disabled = true; btn.textContent = 'Генерация…'; }
  const promptText = document.getElementById('tvBackdropCardPromptInput').value.trim();
  backdrop.card.prompt = promptText;
  backdrop.card._pending = backdrop.card._pending || {};
  backdrop.card._pending.sheet = true;
  tvRenderBackdropCardOutputGridIfOpen(backdrop);

  try{
    const photos = tvGatherBackdropReferencePhotos(backdrop);
    const referenceImageUrls = [];
    for(const p of photos){
      const url = await tvUploadReferencePhoto(p);
      if(url) referenceImageUrls.push(url);
    }
    const prompt = tvBuildBackdropCardSheetPrompt(backdrop, promptText);
    const res = await fetch('/api/generate-image/start', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt, width: TV_CARD_SHEET_WIDTH, height: TV_CARD_SHEET_HEIGHT, model: model.id,
        referenceImageUrl: referenceImageUrls,
        meta: { kind: 'tv-backdrop-card', backdropId: backdrop.id, backdropName: backdrop.name },
      }),
    });
    const data = await res.json().catch(()=> null);
    if(res.status===401) throw new Error('Нужно войти в аккаунт — откройте / и авторизуйтесь, затем вернитесь на /tv.');
    if(!res.ok || !data || !data.taskId) throw new Error((data && data.message) || 'Не удалось запустить генерацию.');
    const imageUrl = await tvPollGenerationSlot(data.taskId);
    const persisted = await tvPersistRemoteImageAsset('backdrop:' + backdrop.id + ':sheet', imageUrl);
    backdrop.card.images.sheet = backdrop.card.images.sheet || {};
    backdrop.card.images.sheet.url = persisted ? persisted.url : imageUrl;
    backdrop._assetFiles = backdrop._assetFiles || {};
    backdrop._assetFiles.sheet = !!persisted;
    backdrop._assetFiles.sheetFile = persisted ? persisted.fileName : undefined;
    delete backdrop.card._pending.sheet;
    tvSaveSoon();
  } catch(err){
    console.warn('[tv] failed to generate the backdrop card:', err);
    alert('Не удалось создать Object Card: ' + err.message);
  } finally {
    if(backdrop.card._pending) delete backdrop.card._pending.sheet;
    tvRenderBackdropCardOutputGridIfOpen(backdrop);
  }

  if(btn){ btn.disabled = false; btn.textContent = (backdrop.card.images.sheet && backdrop.card.images.sheet.url) ? 'Пересоздать карту' : 'Создать карту'; }
  renderTvBackdrops();
}

// ---- Angle shots (locations.js's LOCATION_ANGLE_KEYS pattern) — five independently
// generated, finished establishing shots, each using every other filled angle (or,
// failing that, the Object Card sheet / micro-photo) as a reference. ----
const TV_ANGLE_SHOT_WIDTH = 1920, TV_ANGLE_SHOT_HEIGHT = 1080;
let tvBackdropAnglesOpenId = null;
function tvGatherAngleReferences(backdrop, excludeKey){
  const refs = [];
  TV_ANGLE_KEYS.forEach(k=>{
    if(k===excludeKey) return;
    const a = backdrop.angleShots && backdrop.angleShots[k];
    if(a && a.photo) refs.push(a.photo);
  });
  if(refs.length===0){
    const sheet = backdrop.card && backdrop.card.images && backdrop.card.images.sheet;
    if(sheet && sheet.url) refs.push(sheet.url);
    else if(backdrop.photo) refs.push(backdrop.photo);
  }
  return refs.slice(0, 8);
}
function tvBuildAngleShotPrompt(backdrop, key){
  const directionText = TV_ANGLE_PROMPT_LABELS[key] || key;
  return (backdrop.description ? backdrop.description + '. ' : '')
    + 'The exact same studio backdrop/set as in the reference image(s) — same architecture, materials, colors, and lighting — but shown as ' + directionText + '. Do not invent a different place, no people in frame.';
}
function tvOpenBackdropAngleShots(backdrop){
  tvBackdropAnglesOpenId = backdrop.id;
  backdrop.angleShots = backdrop.angleShots || {};
  const body = document.getElementById('tvAnchorModalBody');
  body.innerHTML = `
    <div class="char-form card-builder">
      <h3>Ракурсы — ${backdrop.name}</h3>
      <p class="sub">Готовые, самостоятельно используемые планы декорации с разных сторон. Каждый генерируется с учётом уже готовых ракурсов — так модель видит декорацию с нескольких сторон сразу.</p>
      <div class="location-angle-grid" id="tvAngleGrid"></div>
      <input type="file" id="tvAngleFileInput" accept="image/*" style="position:absolute;width:1px;height:1px;opacity:0;overflow:hidden;">
      <div class="gen-hint" id="tvAngleModelHint" style="margin-top:10px;"></div>
      <div class="cf-actions" style="margin-top:16px;">
        <button class="cf-btn" id="tvAnglesBack">Назад к декорации</button>
      </div>
    </div>`;
  tvRenderAngleTiles(backdrop);
  const model = tvPickReferenceCapableModel();
  const modelHint = document.getElementById('tvAngleModelHint');
  if(!model){
    modelHint.textContent = 'Нет подключённой модели с поддержкой референс-фото — генерация ракурсов недоступна, но загрузка своих фото работает.';
    modelHint.style.color = 'var(--danger)';
  } else {
    modelHint.textContent = 'Генерация через ' + model.label + '.';
  }
  document.getElementById('tvAnglesBack').onclick = ()=>{
    tvBackdropAnglesOpenId = null;
    tvOpenBackdropDetail(backdrop);
  };
  tvOpenModal();
}
function tvRenderAngleTiles(backdrop){
  const grid = document.getElementById('tvAngleGrid');
  if(!grid) return;
  grid.innerHTML = TV_ANGLE_KEYS.map(key=>{
    const angle = backdrop.angleShots && backdrop.angleShots[key];
    const pending = backdrop._pendingAngles && backdrop._pendingAngles[key];
    const label = `<div class="location-angle-tile-label">${TV_ANGLE_UI_LABELS[key]}</div>`;
    let inner;
    if(angle && angle.photo) inner = `<img src="${angle.photo}">${label}<div class="location-angle-tile-del" data-angle-key="${key}" title="Удалить"><i class="ti ti-x" style="font-size:11px;"></i></div>`;
    else if(pending) inner = `<div class="task-tile-spin"></div>${label}`;
    else inner = `<div class="location-angle-tile-add"><i class="ti ti-plus" style="font-size:20px;"></i></div>${label}`;
    return `<div class="location-angle-tile" data-angle-key="${key}">${inner}</div>`;
  }).join('');
  grid.querySelectorAll('.location-angle-tile').forEach(tile=>{
    tile.onclick = (e)=>{
      if(e.target.closest('.location-angle-tile-del')) return;
      tvOpenAngleTileMenu(backdrop, tile.dataset.angleKey, tile);
    };
  });
  grid.querySelectorAll('.location-angle-tile-del').forEach(btn=>{
    btn.onclick = (e)=>{
      e.stopPropagation();
      delete backdrop.angleShots[btn.dataset.angleKey];
      tvRenderAngleTiles(backdrop);
      tvSaveSoon();
    };
  });
}
function tvCloseAngleTileMenu(){
  const menu = document.getElementById('tvAngleTileMenu');
  if(menu) menu.remove();
  document.removeEventListener('click', tvCloseAngleTileMenu, true);
}
function tvOpenAngleTileMenu(backdrop, key, tileEl){
  tvCloseAngleTileMenu();
  const rect = tileEl.getBoundingClientRect();
  const model = tvPickReferenceCapableModel();
  const menu = document.createElement('div');
  menu.className = 'angle-tile-menu';
  menu.id = 'tvAngleTileMenu';
  menu.style.left = rect.left + 'px';
  menu.style.top = (rect.bottom + 4) + 'px';
  menu.innerHTML = `
    <div class="angle-tile-menu-item" data-action="upload">Загрузить с диска</div>
    <div class="angle-tile-menu-item${model?'':' disabled'}" data-action="generate">Сгенерировать с ИИ</div>`;
  document.body.appendChild(menu);
  menu.querySelector('[data-action="upload"]').onclick = (e)=>{
    e.stopPropagation();
    tvCloseAngleTileMenu();
    const input = document.getElementById('tvAngleFileInput');
    input.onchange = async ()=>{
      const file = input.files[0];
      if(!file) return;
      try{
        const dataUrl = await loadImageAsDataURL(file);
        const result = await tvPersistLocalImageAsset('backdrop:' + backdrop.id + ':angle:' + key, dataUrl);
        backdrop.angleShots[key] = { photo: result ? result.url : dataUrl };
        backdrop._assetFiles = backdrop._assetFiles || {};
        backdrop._assetFiles['angle_' + key] = !!result;
        backdrop._assetFiles['angle_' + key + 'File'] = result ? result.fileName : undefined;
        tvRenderAngleTiles(backdrop);
        renderTvBackdrops();
        tvSaveSoon();
      } catch(err){}
      input.value = '';
    };
    input.click();
  };
  const genItem = menu.querySelector('[data-action="generate"]');
  if(model){
    genItem.onclick = (e)=>{
      e.stopPropagation();
      tvCloseAngleTileMenu();
      tvRunGenerateAngleShot(backdrop, key);
    };
  }
  setTimeout(()=> document.addEventListener('click', tvCloseAngleTileMenu, true), 0);
}
async function tvRunGenerateAngleShot(backdrop, key){
  const model = tvPickReferenceCapableModel();
  if(!model) return;
  backdrop._pendingAngles = backdrop._pendingAngles || {};
  backdrop._pendingAngles[key] = true;
  tvRenderAngleTilesIfOpen(backdrop);
  try{
    const refs = tvGatherAngleReferences(backdrop, key);
    const referenceImageUrls = [];
    for(const p of refs){
      const url = await tvUploadReferencePhoto(p);
      if(url) referenceImageUrls.push(url);
    }
    const prompt = tvBuildAngleShotPrompt(backdrop, key);
    const res = await fetch('/api/generate-image/start', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt, width: TV_ANGLE_SHOT_WIDTH, height: TV_ANGLE_SHOT_HEIGHT, model: model.id,
        referenceImageUrl: referenceImageUrls,
        meta: { kind: 'tv-backdrop-angle', backdropId: backdrop.id, angleKey: key },
      }),
    });
    const data = await res.json().catch(()=> null);
    if(res.status===401) throw new Error('Нужно войти в аккаунт — откройте / и авторизуйтесь, затем вернитесь на /tv.');
    if(!res.ok || !data || !data.taskId) throw new Error((data && data.message) || 'Не удалось запустить генерацию.');
    const imageUrl = await tvPollGenerationSlot(data.taskId);
    const persisted = await tvPersistRemoteImageAsset('backdrop:' + backdrop.id + ':angle:' + key, imageUrl);
    backdrop.angleShots[key] = { photo: persisted ? persisted.url : imageUrl };
    backdrop._assetFiles = backdrop._assetFiles || {};
    backdrop._assetFiles['angle_' + key] = !!persisted;
    backdrop._assetFiles['angle_' + key + 'File'] = persisted ? persisted.fileName : undefined;
    tvSaveSoon();
  } catch(err){
    console.warn('[tv] failed to generate angle shot', key, err);
    alert('Не удалось сгенерировать ракурс: ' + err.message);
  } finally {
    if(backdrop._pendingAngles) delete backdrop._pendingAngles[key];
    tvRenderAngleTilesIfOpen(backdrop);
    renderTvBackdrops();
  }
}
function tvRenderAngleTilesIfOpen(backdrop){
  if(tvBackdropAnglesOpenId===backdrop.id) tvRenderAngleTiles(backdrop);
}

// ---- Новости tab: two-pane picker (left = proposed, right = included in episode) ----
function renderTvNewsPickers(){
  const leftEl = document.getElementById('tvNewsLeftPane');
  const rightEl = document.getElementById('tvNewsRightPane');
  if(!leftEl || !rightEl) return;
  const left = tvState.tvNewsItems.filter(n=> !n.included);
  const right = tvState.tvNewsItems.filter(n=> n.included);
  const row = (n)=> `<div class="tv-news-row" data-id="${n.id}">
    <span class="tv-news-rubric">${tvRubricLabel(n.rubric)}</span>
    <span class="tv-news-title">${n.title}</span>
    ${n.source==='ai-draft' ? '<span class="tv-news-flag tv-news-flag-ai" title="Черновик Gemini — проверьте факты перед использованием">ИИ-черновик</span>' : ''}
    ${n.materialStatus==='мало материала' ? '<span class="tv-news-flag">мало материала</span>' : ''}
    ${n.isAnniversary ? '<span class="tv-news-flag tv-news-flag-anniv">юбилей</span>' : ''}
  </div>`;
  leftEl.innerHTML = left.length ? left.map(row).join('') : `<div class="tv-empty-hint">Нет предложенных новостей.</div>`;
  rightEl.innerHTML = right.length ? right.map(row).join('') : `<div class="tv-empty-hint">Перетащите новости сюда, чтобы включить в выпуск.</div>`;
}

// ---- Сетка tab: auto-populated from TV_FORMAT_TEMPLATE (see tv-state.js — draft, derived
// from scripts/analyze-show-format.js's analysis of 3 real reference episodes) ----
const TV_GRID_FIXED_LABELS = { intro:'Заставка', host_intro:'Выход ведущего', jingle:'Джингл', outro:'Аутро' };
function tvAutoPopulateGrid(){
  const included = tvState.tvNewsItems.filter(n=> n.included);
  if(!included.length){
    alert('Нет новостей, включённых в выпуск — сначала добавьте их на вкладке «Новости».');
    return;
  }
  const t = TV_FORMAT_TEMPLATE;
  const blocks = [];
  let order = 0;
  const push = (fields)=> blocks.push(Object.assign({ id: tvGridBlockSeq++, rubric:null, newsItemId:null, sortOrder: order++, voTrack:{}, cutaways:[] }, fields));

  push({ blockType:'intro', estimatedDurationSec: t.introDurationSec });
  push({ blockType:'host_intro', estimatedDurationSec: t.hostIntroDurationSec });

  t.rubricOrder.forEach(rubricKey=>{
    const items = included.filter(n=> n.rubric===rubricKey).sort((a,b)=> (a.sortOrder||0)-(b.sortOrder||0));
    if(!items.length) return;
    push({ blockType:'jingle', estimatedDurationSec: t.jingleDurationSec });
    items.forEach(item=>{
      push({ blockType:'story', rubric: rubricKey, newsItemId: item.id, estimatedDurationSec: t.storyDurationSec[rubricKey] || 60 });
    });
  });

  push({ blockType:'jingle', estimatedDurationSec: t.jingleDurationSec });
  push({ blockType:'outro', estimatedDurationSec: t.outroDurationSec });

  tvState.tvGridBlocks = blocks;
  tvSaveSoon();
  renderTvGrid();
}
function renderTvGrid(){
  const el = document.getElementById('tvGridTrack');
  if(!el) return;
  if(!tvState.tvGridBlocks.length){
    el.innerHTML = `<div class="tv-empty-hint">Сетка пуста — нажмите «Собрать сетку», чтобы собрать её автоматически из новостей, включённых в выпуск.</div>`;
    return;
  }
  const blocks = [...tvState.tvGridBlocks].sort((a,b)=> a.sortOrder-b.sortOrder);
  const totalSec = blocks.reduce((sum,b)=> sum + (b.estimatedDurationSec||0), 0);
  const rows = blocks.map(b=>{
    if(b.blockType==='story'){
      const item = tvState.tvNewsItems.find(n=> n.id===b.newsItemId);
      return `<div class="tv-grid-item">
        <span class="tv-grid-item-rubric">${tvRubricLabel(b.rubric)}</span>
        <span class="tv-grid-item-title">${item ? item.title : '— новость удалена —'}</span>
        <span class="tv-grid-item-dur">~${b.estimatedDurationSec}с</span>
      </div>`;
    }
    return `<div class="tv-grid-item fixed">
      <span class="tv-grid-item-title">${TV_GRID_FIXED_LABELS[b.blockType] || b.blockType}</span>
      <span class="tv-grid-item-dur">~${b.estimatedDurationSec}с</span>
    </div>`;
  }).join('');
  el.innerHTML = `<div class="gen-hint" style="margin-bottom:10px;">Черновая оценка хронометража: ~${Math.round(totalSec/60)} мин (${totalSec} сек) — уточнится, когда появится реальная озвучка.</div><div class="tv-grid-flow">${rows}</div>`;
}

// ---- Собрать новости — Gemini drafts a candidate list for the matching week 25 years
// ago. Never treated as ready-to-air: every item lands with source:'ai-draft',
// included:false, materialStatus:'мало материала' until Костян reviews it and attaches
// real material, same rule CLAUDE.md sets for scarce material in general. ----
async function tvGatherNews(){
  const btn = document.getElementById('tvGatherNewsBtn');
  const hint = document.getElementById('tvGatherNewsHint');
  if(btn){ btn.disabled = true; btn.textContent = 'Собираю…'; }
  if(hint) hint.textContent = '';
  try{
    const res = await fetch('/api/tv/gather-news', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
    const data = await res.json().catch(()=> null);
    if(!res.ok || !data || !Array.isArray(data.items)) throw new Error((data && data.message) || 'Не удалось собрать новости.');
    data.items.forEach(item=>{
      tvState.tvNewsItems.push({
        id: tvNewsItemSeq++,
        rubric: item.rubric,
        title: item.title,
        summary: item.summary,
        sourceDate: item.sourceDateGuess || null,
        sourceUrl: null,
        media: [],
        materialStatus: 'мало материала',
        isAnniversary: false,
        included: false,
        assignedAnchorId: null,
        approvedForRelease: false,
        sortOrder: 0,
        source: 'ai-draft',
      });
    });
    renderTvNewsPickers();
    tvSaveSoon();
    if(hint) hint.textContent = 'Добавлено: ' + data.items.length + ' (черновик, проверьте факты)';
  } catch(err){
    if(hint){ hint.textContent = err.message; hint.style.color = 'var(--danger)'; }
  } finally {
    if(btn){ btn.disabled = false; btn.textContent = 'Собрать новости'; }
  }
}

// ---- KIE.ai credits indicator (bottom-right) — same live-balance endpoint as
// js/credits.js, but the "owed to users" subtraction can't come from dev's own DB (dev
// and main deliberately use separate Postgres instances — see CLAUDE.md), so it's read
// from tvState.tvOwedToUsers, a number Костян updates by hand from main's admin panel. ----
let tvCreditsRefreshTimer = null;
let tvLastBalanceData = null; // re-used to redraw instantly when the "owed" input changes, without a refetch

function tvSyncOwedInput(){
  const input = document.getElementById('tvOwedInput');
  if(!input) return;
  input.value = tvState.tvOwedToUsers || 0;
  input.oninput = ()=>{
    tvState.tvOwedToUsers = Math.max(0, Number(input.value) || 0);
    tvSaveSoon();
    tvRenderCreditsIndicator();
  };
}

function tvWireCreditsIndicator(){
  const el = document.getElementById('tvCreditsIndicator');
  if(!el) return;
  el.onclick = tvRefreshCredits;
  tvSyncOwedInput();
  tvRefreshCredits();
  if(tvCreditsRefreshTimer) clearInterval(tvCreditsRefreshTimer);
  tvCreditsRefreshTimer = setInterval(tvRefreshCredits, 5 * 60 * 1000);
}
async function tvRefreshCredits(){
  const el = document.getElementById('tvCreditsIndicator');
  const dot = document.getElementById('tvCreditsDot');
  const spinner = document.getElementById('tvCreditsSpinner');
  if(!el || !dot || !spinner) return;
  spinner.classList.remove('hidden');
  try{
    const res = await fetch('/api/my-balance');
    const data = await res.json().catch(()=> null);
    tvLastBalanceData = (res.ok && data && typeof data.credits === 'number') ? data : null;
    if(!tvLastBalanceData){
      const notConfigured = data && data.error==='not_configured';
      dot.className = 'credits-dot grey';
      document.getElementById('tvCreditsValue').textContent = notConfigured ? 'не настроено' : (data && data.error==='not_authenticated' ? 'нужен вход' : 'ошибка');
      el.title = (data && data.message) || 'Не удалось связаться с сервером — нажмите, чтобы повторить';
      return;
    }
    tvRenderCreditsIndicator();
  } catch(err){
    tvLastBalanceData = null;
    dot.className = 'credits-dot red';
    document.getElementById('tvCreditsValue').textContent = 'ошибка';
    el.title = 'Не удалось связаться с сервером — нажмите, чтобы повторить';
  } finally {
    spinner.classList.add('hidden');
  }
}
// Redraws from the last-fetched balance — called both after a fresh fetch and instantly
// when the manual "owed to users" input changes, so editing it doesn't need a network round-trip.
function tvRenderCreditsIndicator(){
  const el = document.getElementById('tvCreditsIndicator');
  const dot = document.getElementById('tvCreditsDot');
  const value = document.getElementById('tvCreditsValue');
  const data = tvLastBalanceData;
  if(!el || !dot || !value || !data) return;
  // The raw KIE balance (data.credits, for admins) is live and DB-independent — only the
  // "minus what's owed to users" part needs the manually-entered number, since dev's own
  // DB has no record of main's real users.
  const hasOwed = data.isAdmin && tvState.tvOwedToUsers > 0;
  const shownCredits = hasOwed ? Math.max(0, data.credits - tvState.tvOwedToUsers) : data.credits;
  let imagesRemaining = data.imagesRemaining;
  if(hasOwed && data.imagesRemaining && data.credits){
    const creditsPerImage = data.credits / data.imagesRemaining;
    imagesRemaining = creditsPerImage > 0 ? Math.floor(shownCredits / creditsPerImage) : null;
  }
  let cls = 'grey';
  if(imagesRemaining===0) cls = 'red';
  else if(imagesRemaining!==null && imagesRemaining!==undefined && imagesRemaining < 20) cls = 'yellow';
  else if(imagesRemaining!==null && imagesRemaining!==undefined) cls = 'green';
  dot.className = 'credits-dot ' + cls;
  const unit = data.isAdmin ? ' кр' : ' токенов';
  value.textContent = shownCredits + unit;
  el.title = (hasOwed ? 'Личный баланс (KIE минус вручную указанное "роздано"): ' : 'Баланс KIE.ai: ') + shownCredits + unit + ' — нажмите, чтобы обновить';
}

function wireTvPageTabs(){
  document.querySelectorAll('.tv-page-tab').forEach(tab=>{
    tab.onclick = ()=> showTvPage(tab.dataset.tvPage);
  });
  const approveBtn = document.getElementById('tvApproveBtn');
  if(approveBtn) approveBtn.onclick = toggleTvApproval;
  const addAnchorBtn = document.getElementById('tvAddAnchorBtn');
  if(addAnchorBtn) addAnchorBtn.onclick = ()=> tvOpenAnchorForm(null);
  const addBackdropBtn = document.getElementById('tvAddBackdropBtn');
  if(addBackdropBtn) addBackdropBtn.onclick = ()=> tvOpenBackdropForm(null);
  const modalBackdrop = document.getElementById('tvAnchorModalBackdrop');
  if(modalBackdrop) modalBackdrop.onclick = tvCloseModal;
  const folderBtn = document.getElementById('tvConnectFolderBtn');
  if(folderBtn) folderBtn.onclick = tvHandleFolderButtonClick;
  const gatherNewsBtn = document.getElementById('tvGatherNewsBtn');
  if(gatherNewsBtn) gatherNewsBtn.onclick = tvGatherNews;
  const autoPopulateGridBtn = document.getElementById('tvAutoPopulateGridBtn');
  if(autoPopulateGridBtn) autoPopulateGridBtn.onclick = tvAutoPopulateGrid;
}

(async function(){
  wireTvPageTabs();
  showTvPage('work');
  tvWireCreditsIndicator();
  await Promise.all([tvLoadModelList(), tvLoadWorkspace()]);
  tvStartAutosave();
  renderTvAnchors();
  renderTvBackdrops();
  renderTvNewsPickers();
  renderTvGrid();
})();
