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
  if(!a.name || !a.photo || !a.role || !a.description) return 'red';
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
      ${a.role ? `<div class="char-tile-role">${a.role}</div>` : ''}
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
        ${anchor.role ? `<span class="char-card-role">${anchor.role}</span>` : ''}
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
      <p class="sub">${existing ? 'Обновите данные ведущего.' : 'Имя, специализация, описание, голос, одно фото. После сохранения можно собрать полную Character Card.'}</p>
      <div class="cf-field"><label>Имя</label><input type="text" id="tvAnchorName" placeholder="например, Анна Соколова" value="${existing ? existing.name : ''}"></div>
      <div class="cf-field"><label>Специализация</label><input type="text" id="tvAnchorRole" placeholder="например, ведёт рубрику Игры" value="${existing && existing.role ? existing.role : ''}"></div>
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
      role: document.getElementById('tvAnchorRole').value.trim(),
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

// ---- Work tab: studio backdrops (placeholder — Object Card flow reused from locations.js is next) ----
function renderTvBackdrops(){
  const el = document.getElementById('tvBackdropsGrid');
  if(!el) return;
  el.innerHTML = tvState.tvBackdrops.length
    ? tvState.tvBackdrops.map(b=> `<div class="tv-card-tile"><div class="tv-card-tile-name">${b.name}</div></div>`).join('')
    : `<div class="tv-empty-hint">Декораций студии пока нет — нажмите «+ Декорация».</div>`;
}
function addTvBackdrop(){
  const name = prompt('Название декорации:');
  if(!name) return;
  tvState.tvBackdrops.push({ id: tvBackdropSeq++, name, cardInputSlots: {}, cardOutputSlots: {}, angleShots: [], approved:false });
  renderTvBackdrops();
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

// ---- Сетка tab: rubric-grouped blocks ----
function renderTvGrid(){
  const el = document.getElementById('tvGridTrack');
  if(!el) return;
  if(!tvState.tvGridBlocks.length){
    el.innerHTML = `<div class="tv-empty-hint">Сетка пуста — соберётся автоматически из утверждённых новостей.</div>`;
    return;
  }
  el.innerHTML = TV_RUBRICS.map(r=>{
    const blocks = tvState.tvGridBlocks.filter(b=> b.rubric===r.key).sort((a,b)=> a.sortOrder-b.sortOrder);
    if(!blocks.length) return '';
    return `<div class="tv-grid-block-group">
      <div class="tv-grid-block-label">${r.label}</div>
      <div class="tv-grid-block-row">${blocks.map(b=> `<div class="tv-grid-block">${b.newsItemId ?? ''}</div>`).join('')}</div>
    </div>`;
  }).join('');
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
  if(addBackdropBtn) addBackdropBtn.onclick = addTvBackdrop;
  const modalBackdrop = document.getElementById('tvAnchorModalBackdrop');
  if(modalBackdrop) modalBackdrop.onclick = tvCloseModal;
  const folderBtn = document.getElementById('tvConnectFolderBtn');
  if(folderBtn) folderBtn.onclick = tvHandleFolderButtonClick;
  const gatherNewsBtn = document.getElementById('tvGatherNewsBtn');
  if(gatherNewsBtn) gatherNewsBtn.onclick = tvGatherNews;
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
