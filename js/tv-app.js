// ---------- /TV app: tab switching, approval gates, boot ----------

function showTvPage(page){
  tvState.activeTab = page;
  document.querySelectorAll('.tv-page-tab').forEach(t=> t.classList.toggle('active', t.dataset.tvPage===page));
  document.querySelectorAll('.tv-page').forEach(el=> el.classList.toggle('hidden', el.dataset.tvPage!==page));
  renderTvApprovalButton();
  if(page==='news'){
    tvPruneOldArchive();
    // Wrapped defensively: an error in the calendar must never block the rest of the
    // Новости tab from rendering — and surfaces the real message in the UI itself, since
    // Костян can't easily pull DevTools console output for me.
    try{ renderTvNewsCalendar(); }
    catch(err){
      console.error('[tv] calendar render failed:', err);
      const calEl = document.getElementById('tvNewsCalendar');
      if(calEl) calEl.innerHTML = `<div class="gen-hint" style="color:var(--danger);">Ошибка календаря: ${err.message}</div>`;
    }
    renderTvNewsSources();
    renderTvNewsSubTabs();
    renderTvNewsPickers();
  }
  if(page==='studio') renderTvRedaktsiya();
  if(page==='mic') renderTvMic();
  if(page==='tasks') renderTvTasks();
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
  tvMicPanelOpenAnchorId = null;
}

// ---- fullscreen image lightbox (Character Card / Object Card sheet preview) ----
function tvOpenLightbox(url){
  document.getElementById('tvLightboxImg').src = url;
  document.getElementById('tvLightbox').classList.remove('hidden');
}
function tvCloseLightbox(){
  document.getElementById('tvLightbox').classList.add('hidden');
  document.getElementById('tvLightboxImg').src = '';
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

// ---- text-writing / voicing model lists (TASKS tile pickers) ----
let tvTextModelOptions = [];
let tvVoiceModelOptions = [];
async function tvLoadTaskModelLists(){
  try{
    const [textRes, voiceRes] = await Promise.all([fetch('/api/tv/text-models'), fetch('/api/tv/voice-models')]);
    const textData = await textRes.json().catch(()=> null);
    const voiceData = await voiceRes.json().catch(()=> null);
    tvTextModelOptions = (textData && textData.models) || [];
    tvVoiceModelOptions = (voiceData && voiceData.models) || [];
  } catch(err){
    tvTextModelOptions = [];
    tvVoiceModelOptions = [];
  }
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
  const anchor = Object.assign({ id: tvAnchorSeq++, card: null, persona: tvEmptyPersona(), approved: false, _assetFiles: {} }, payload);
  tvState.tvAnchors.push(anchor);
  tvSaveSoon();
  return anchor;
}
function tvDeleteAnchorLocal(id){
  tvState.tvAnchors = tvState.tvAnchors.filter(a=> a.id!==id);
  tvSaveSoon();
}

// ---- status (red = incomplete basics, yellow = basics done but no card yet, green = card built) ----
// rubric is intentionally NOT required — null means "hosts the whole show" (a real value,
// not a missing one; see TV_RUBRICS/tvRubricLabel in tv-state.js).
function tvAnchorStatus(a){
  if(!a.name || !a.photo || !a.description) return 'red';
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
      <div class="char-tile-role">${tvRubricLabel(a.rubric)}</div>
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
        <span class="char-card-role">${tvRubricLabel(anchor.rubric)}</span>
        ${anchor.description ? `<p class="char-card-desc">${anchor.description}</p>` : ''}
        ${anchor.voiceId ? `<div class="gen-hint" style="margin-top:-8px;margin-bottom:14px;">Голос: ${anchor.voiceId}</div>` : ''}
        <div class="char-card-section-title">Character Card</div>
        ${hasSheet
          ? `<div class="char-card-angles"><div class="char-card-angle tv-clickable-img" id="tvAnchorSheetThumb" style="width:100%;height:90px;"><img src="${anchor.card.images.sheet.url}"></div></div>`
          : `<div class="gen-hint" style="margin-top:0;">Лист ещё не создан — на нём держится каждая генерация этого ведущего.</div>`}
        <div class="char-card-actions">
          <button class="cf-btn" id="tvAnchorBack">Закрыть</button>
          <div style="display:flex;gap:8px;">
            <button class="cf-btn" id="tvAnchorEdit">Изменить</button>
            <button class="cf-btn" id="tvAnchorDelete" style="color:var(--danger);">Удалить</button>
          </div>
        </div>
        <button class="cf-btn primary" id="tvAnchorBuildBtn" style="width:100%;margin-top:12px;">${hasSheet ? 'Изменить Character Card' : 'Создать Character Card'}</button>
        <button class="cf-btn" id="tvAnchorPersonaBtn" style="width:100%;margin-top:8px;">Персона / голос</button>
      </div>
    </div>`;
  document.getElementById('tvAnchorBack').onclick = tvCloseModal;
  document.getElementById('tvAnchorEdit').onclick = ()=> tvOpenAnchorForm(anchor);
  document.getElementById('tvAnchorBuildBtn').onclick = ()=> tvOpenAnchorCardBuilder(anchor);
  document.getElementById('tvAnchorPersonaBtn').onclick = ()=> tvOpenAnchorPersona(anchor);
  if(hasSheet) document.getElementById('tvAnchorSheetThumb').onclick = ()=> tvOpenLightbox(anchor.card.images.sheet.url);
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
      <div class="cf-field"><label>Рубрика</label><select id="tvAnchorRubric">
        <option value=""${!existing || !existing.rubric ? ' selected' : ''}>Ведущий передачи целиком (без рубрики)</option>
        ${TV_RUBRICS.map(r=> `<option value="${r.key}"${existing && existing.rubric===r.key ? ' selected' : ''}>${r.label}</option>`).join('')}
      </select></div>
      <div class="cf-field"><label>Описание / характер</label><textarea id="tvAnchorDesc" placeholder="Внешность, манера, что важно помнить">${existing && existing.description ? existing.description : ''}</textarea></div>
      <div class="cf-field"><label>Голос — TTS <span style="color:var(--text-3);font-weight:400;">— используется при озвучке в Микрофонной</span></label>
        <select id="tvAnchorVoice">
          ${TV_GEMINI_VOICES.map(v=> `<option value="${v.id}"${existing && existing.voiceId===v.id ? ' selected' : ''}>${v.id} — ${v.label}</option>`).join('')}
        </select>
      </div>
      <div class="cf-field"><label>Скорость чтения</label>
        <select id="tvAnchorVoiceSpeed">
          <option value="slow"${existing && existing.voiceSpeed==='slow' ? ' selected' : ''}>Медленно</option>
          <option value="normal"${!existing || !existing.voiceSpeed || existing.voiceSpeed==='normal' ? ' selected' : ''}>Нормально</option>
          <option value="fast"${existing && existing.voiceSpeed==='fast' ? ' selected' : ''}>Быстро</option>
        </select>
      </div>
      <div class="cf-field">
        <button class="cf-btn" type="button" id="tvAnchorVoicePreviewBtn" style="width:100%;">▶ Прослушать тестовый кусочек</button>
        <div class="gen-hint" id="tvAnchorVoicePreviewHint" style="margin-top:6px;"></div>
        <audio id="tvAnchorVoicePreviewAudio" controls style="width:100%;margin-top:6px;display:none;"></audio>
      </div>
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

  // Preview uses whatever's currently picked in the selects, even before Save — so trying
  // a few voices/speeds doesn't require saving the anchor each time just to hear them.
  document.getElementById('tvAnchorVoicePreviewBtn').onclick = async ()=>{
    const previewBtn = document.getElementById('tvAnchorVoicePreviewBtn');
    const hint = document.getElementById('tvAnchorVoicePreviewHint');
    const audioEl = document.getElementById('tvAnchorVoicePreviewAudio');
    previewBtn.disabled = true; previewBtn.textContent = 'Генерация…';
    hint.textContent = ''; hint.style.color = '';
    try{
      const res = await fetch('/api/tv/generate-voice', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: 'Добрый вечер. В эфире технические новости.',
          voiceName: document.getElementById('tvAnchorVoice').value,
          voiceSpeed: document.getElementById('tvAnchorVoiceSpeed').value,
          model: 'gemini-tts',
        }),
      });
      if(!res.ok){
        const data = await res.json().catch(()=> null);
        throw new Error((data && data.message) || 'Не удалось сгенерировать пример.');
      }
      const blob = await res.blob();
      audioEl.src = URL.createObjectURL(blob);
      audioEl.style.display = '';
      audioEl.play();
    } catch(err){
      hint.textContent = err.message;
      hint.style.color = 'var(--danger)';
    } finally {
      previewBtn.disabled = false; previewBtn.textContent = '▶ Прослушать тестовый кусочек';
    }
  };

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
      rubric: document.getElementById('tvAnchorRubric').value || null,
      description: document.getElementById('tvAnchorDesc').value.trim(),
      voiceId: document.getElementById('tvAnchorVoice').value,
      voiceSpeed: document.getElementById('tvAnchorVoiceSpeed').value,
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

// ---- Персона / voice — the character-bible fields (age, archetype, catchphrase, speech
// quirks, sample lines...) a future text-generation pass ("Journalist" in CLAUDE.md) will
// read to write voiceover that actually sounds like THIS host. Doesn't touch appearance —
// that's Character Card's job — except visualStyle, which also feeds the card prompt. ----
function tvBuildAnchorVoiceContext(anchor){
  const p = anchor.persona || {};
  const lines = ['Ведущий: ' + (anchor.name || '—') + ' (' + tvRubricLabel(anchor.rubric) + ')'];
  TV_PERSONA_TEXT_FIELDS.forEach(f=>{ if(p[f.key]) lines.push(f.label + ': ' + p[f.key]); });
  TV_PERSONA_LIST_FIELDS.forEach(f=>{
    const items = (p[f.key] || []).filter(Boolean);
    if(!items.length) return;
    lines.push('');
    lines.push(f.label + ':');
    items.forEach(it=> lines.push('- ' + it));
  });
  return lines.join('\n');
}
// Picks one random truthy entry from a list — used for catchphrases/signature actions so
// each written article gets a different one instead of the model settling on a favorite.
function tvPickRandom(arr){
  const items = (arr || []).filter(Boolean);
  return items.length ? items[Math.floor(Math.random() * items.length)] : null;
}
function tvOpenAnchorPersona(anchor){
  anchor.persona = anchor.persona || tvEmptyPersona();
  const p = anchor.persona;
  const body = document.getElementById('tvAnchorModalBody');
  body.innerHTML = `
    <div class="char-form card-builder">
      <h3>Персона / голос — ${anchor.name}</h3>
      <p class="sub">Не влияет на внешность (её задаёт Character Card) — это характер и манера речи, чтобы будущая генерация текста для выпуска звучала именно этим ведущим, а не обезличенно.</p>
      ${TV_PERSONA_TEXT_FIELDS.map(f=> f.multiline
        ? `<div class="cf-field"><label>${f.label}</label><textarea id="tvPersona_${f.key}" placeholder="${f.placeholder}" style="min-height:50px;">${p[f.key] || ''}</textarea></div>`
        : `<div class="cf-field"><label>${f.label}</label><input type="text" id="tvPersona_${f.key}" placeholder="${f.placeholder}" value="${p[f.key] || ''}"></div>`
      ).join('')}
      ${TV_PERSONA_LIST_FIELDS.map(f=> `<div class="cf-field"><label>${f.label}</label><textarea id="tvPersona_${f.key}" placeholder="${f.placeholder}" style="min-height:70px;">${(p[f.key] || []).join('\n')}</textarea></div>`).join('')}
      <div class="cf-actions">
        <button class="cf-btn" id="tvPersonaBack">Назад к ведущему</button>
        <button class="cf-btn primary" id="tvPersonaSave">Сохранить</button>
      </div>
      <div class="char-card-section-title" style="margin-top:16px;">Как это увидит модель</div>
      <div class="ref-card-box" id="tvPersonaPreview"></div>
    </div>`;
  const updatePreview = ()=>{ document.getElementById('tvPersonaPreview').textContent = tvBuildAnchorVoiceContext(anchor); };
  updatePreview();
  document.getElementById('tvPersonaBack').onclick = ()=> tvOpenAnchorDetail(anchor);
  document.getElementById('tvPersonaSave').onclick = ()=>{
    TV_PERSONA_TEXT_FIELDS.forEach(f=>{ p[f.key] = document.getElementById('tvPersona_' + f.key).value.trim(); });
    TV_PERSONA_LIST_FIELDS.forEach(f=>{ p[f.key] = document.getElementById('tvPersona_' + f.key).value.split('\n').map(s=> s.trim()).filter(Boolean); });
    updatePreview();
    tvSaveSoon();
    renderTvAnchors();
  };
  tvOpenModal();
}

// ---- Character Card builder — the real, generation-driving reference set ----
let tvAnchorCardBuilderOpenId = null;

function tvOpenAnchorCardBuilder(anchor){
  tvAnchorCardBuilderOpenId = anchor.id;
  if(!anchor.card) anchor.card = { inputSlots: tvEmptyCardInputSlots(), prompt: anchor.description || (anchor.persona && anchor.persona.visualStyle) || '', images: {} };
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
      <div style="display:flex;gap:8px;">
        <button class="cf-btn primary" id="tvCardCreateBtn" style="flex:1;">${hasSheet ? 'Пересоздать карту' : 'Создать карту'}</button>
        <button class="cf-btn" id="tvCardUploadBtn" type="button" style="flex:1;">Загрузить с диска</button>
        <input type="file" id="tvCardSheetFileInput" accept="image/*" style="position:absolute;width:1px;height:1px;opacity:0;overflow:hidden;">
      </div>
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
    modelHint.textContent = 'Нет подключённой модели с поддержкой референс-фото (например, Nano Banana Pro) — генерация недоступна, но загрузка своего листа с диска работает.';
    modelHint.style.color = 'var(--danger)';
    document.getElementById('tvCardCreateBtn').disabled = true;
  } else {
    modelHint.textContent = 'Генерация через ' + model.label + ' (использует ваши референс-фото напрямую).';
  }

  document.getElementById('tvCardPromptInput').addEventListener('input', (e)=>{ anchor.card.prompt = e.target.value; });
  document.getElementById('tvCardCreateBtn').onclick = ()=> tvRunCreateCard(anchor);
  // Manual upload — the finished turnaround sheet doesn't have to come from generation;
  // Костян can draw/edit/source one himself and just drop it in.
  document.getElementById('tvCardUploadBtn').onclick = ()=> document.getElementById('tvCardSheetFileInput').click();
  document.getElementById('tvCardSheetFileInput').onchange = async (e)=>{
    const file = e.target.files[0];
    if(!file) return;
    try{
      const dataUrl = await loadImageAsDataURL(file);
      const result = await tvPersistLocalImageAsset('anchor:' + anchor.id + ':sheet', dataUrl);
      anchor.card.images.sheet = anchor.card.images.sheet || {};
      anchor.card.images.sheet.url = result ? result.url : dataUrl;
      anchor._assetFiles = anchor._assetFiles || {};
      anchor._assetFiles.sheet = !!result;
      anchor._assetFiles.sheetFile = result ? result.fileName : undefined;
      tvSaveSoon();
      tvRenderCardOutputGrid(anchor);
      renderTvAnchors();
      document.getElementById('tvCardCreateBtn').textContent = 'Пересоздать карту';
    } catch(err){}
    e.target.value = '';
  };
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

// ---- Work tab: studios — one dedicated "corner" per rubric (or the general host).
// Manually uploaded only, never AI-generated: exactly 4 wide/establishing shots. The
// planned virtual editor derives medium/close-up framing from these itself (crop/pan/zoom
// at render time) — there is no generation step anywhere in this flow. ----
function tvSaveStudioLocal(payload, existing){
  if(existing){
    Object.assign(existing, payload);
    tvSaveSoon();
    return existing;
  }
  const studio = Object.assign({ id: tvStudioSeq++, angles: tvEmptyStudioAngles(), _assetFiles: {} }, payload);
  tvState.tvStudios.push(studio);
  tvSaveSoon();
  return studio;
}
function tvDeleteStudioLocal(id){
  tvState.tvStudios = tvState.tvStudios.filter(s=> s.id!==id);
  tvSaveSoon();
}
function tvStudioStatus(s){
  if(!s.name) return 'red';
  const filled = TV_STUDIO_ANGLE_KEYS.filter(k=> s.angles && s.angles[k]).length;
  if(filled===0) return 'red';
  return filled===TV_STUDIO_ANGLE_KEYS.length ? 'green' : 'yellow';
}

function renderTvStudios(){
  const el = document.getElementById('tvStudiosGrid');
  if(!el) return;
  if(!tvState.tvStudios.length){
    el.innerHTML = `<div class="tv-empty-hint">Студий пока нет — нажмите «+ Студия».</div>`;
    return;
  }
  el.innerHTML = tvState.tvStudios.map(s=>{
    const cover = TV_STUDIO_ANGLE_KEYS.map(k=> s.angles && s.angles[k]).find(Boolean);
    return `
    <div class="char-tile" data-id="${s.id}">
      <div class="char-tile-photo">${cover ? `<img src="${cover}">` : '<i class="ti ti-camera"></i>'}</div>
      <div class="char-tile-status status-${tvStudioStatus(s)}"></div>
      <div class="char-tile-name">${s.name}</div>
    </div>`;
  }).join('');
  el.querySelectorAll('.char-tile').forEach(tile=>{
    tile.onclick = ()=>{
      const studio = tvState.tvStudios.find(s=> String(s.id)===tile.dataset.id);
      if(studio) tvOpenStudioDetail(studio);
    };
  });
}

// Carousel in the main photo slot — same pattern as showLocationCard()'s angle browser in
// js/locations.js (.loc-card-photo-arrow/.loc-card-photo-label, shared styles.css classes),
// adapted to studios' 4 named directions instead of locations' 5 angle keys.
function tvOpenStudioDetail(studio){
  const available = TV_STUDIO_ANGLE_KEYS.filter(k=> studio.angles && studio.angles[k]);
  let viewIdx = 0;
  const body = document.getElementById('tvAnchorModalBody');
  body.innerHTML = `
    <div class="char-card">
      <div class="char-card-photo" id="tvStudioCardPhoto">
        ${available.length
          ? `<img src="${studio.angles[available[0]]}" id="tvStudioCardPhotoImg" class="tv-clickable-img">`
          : '<i class="ti ti-camera" style="font-size:40px;"></i>'}
        ${available.length > 1 ? `
          <div class="loc-card-photo-arrow left" id="tvStudioPhotoPrev" title="Предыдущий план"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"></polyline></svg></div>
          <div class="loc-card-photo-arrow right" id="tvStudioPhotoNext" title="Следующий план"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg></div>
          <div class="loc-card-photo-label" id="tvStudioPhotoLabel">${TV_STUDIO_ANGLE_LABELS[available[0]]}</div>
        ` : (available.length===1 ? `<div class="loc-card-photo-label">${TV_STUDIO_ANGLE_LABELS[available[0]]}</div>` : '')}
      </div>
      <div class="char-card-body">
        <p class="char-card-name">${studio.name}</p>
        <span class="char-card-role">${tvRubricLabel(studio.rubric)}</span>
        <div class="char-card-section-title">Общие планы (${available.length}/${TV_STUDIO_ANGLE_KEYS.length})</div>
        ${available.length ? '' : `<div class="gen-hint" style="margin-top:0;">Планов пока нет — загрузите их в форме редактирования.</div>`}
        <div class="char-card-actions">
          <button class="cf-btn" id="tvStudioBack">Закрыть</button>
          <div style="display:flex;gap:8px;">
            <button class="cf-btn" id="tvStudioEdit">Изменить</button>
            <button class="cf-btn" id="tvStudioDelete" style="color:var(--danger);">Удалить</button>
          </div>
        </div>
      </div>
    </div>`;

  if(available.length){
    const imgEl = document.getElementById('tvStudioCardPhotoImg');
    const labelEl = document.getElementById('tvStudioPhotoLabel');
    function showAngle(i){
      viewIdx = (i + available.length) % available.length;
      const key = available[viewIdx];
      if(imgEl) imgEl.src = studio.angles[key];
      if(labelEl) labelEl.textContent = TV_STUDIO_ANGLE_LABELS[key];
    }
    if(available.length > 1){
      document.getElementById('tvStudioPhotoPrev').onclick = (e)=>{ e.stopPropagation(); showAngle(viewIdx - 1); };
      document.getElementById('tvStudioPhotoNext').onclick = (e)=>{ e.stopPropagation(); showAngle(viewIdx + 1); };
    }
    imgEl.onclick = ()=> tvOpenLightbox(studio.angles[available[viewIdx]]);
  }
  document.getElementById('tvStudioBack').onclick = tvCloseModal;
  document.getElementById('tvStudioEdit').onclick = ()=> tvOpenStudioForm(studio);
  document.getElementById('tvStudioDelete').onclick = ()=>{
    if(!confirm('Удалить студию «' + studio.name + '»?')) return;
    tvDeleteStudioLocal(studio.id);
    renderTvStudios();
    tvCloseModal();
  };
  tvOpenModal();
}

// Angle uploads stay purely local (in `localAngles`, a plain-object copy) until Save —
// same convention as the anchor/backdrop single-photo forms — so a cancelled "new studio"
// form never persists an asset under an id that gets thrown away.
function tvOpenStudioForm(existing){
  const localAngles = Object.assign({}, tvEmptyStudioAngles(), existing ? existing.angles : null);
  const body = document.getElementById('tvAnchorModalBody');
  body.innerHTML = `
    <div class="char-form card-builder">
      <h3>${existing ? 'Изменить студию' : 'Новая студия'}</h3>
      <p class="sub">${existing ? 'Обновите данные студии.' : 'Название, рубрика и 4 общих плана — загружаются с диска, ничего не генерируется.'}</p>
      <div class="cf-field"><label>Название</label><input type="text" id="tvStudioName" placeholder="например, Студия «Игры»" value="${existing ? existing.name : ''}"></div>
      <div class="cf-field"><label>Рубрика</label><select id="tvStudioRubric">
        <option value=""${!existing || !existing.rubric ? ' selected' : ''}>Ведущий передачи целиком (без рубрики)</option>
        ${TV_RUBRICS.map(r=> `<option value="${r.key}"${existing && existing.rubric===r.key ? ' selected' : ''}>${r.label}</option>`).join('')}
      </select></div>
      <div class="cf-field">
        <label>Общие планы <span style="color:var(--text-3);font-weight:400;">— ровно 4, загрузка с диска</span></label>
        <div class="angle-slots-grid" id="tvStudioAngleGrid"></div>
        <input type="file" id="tvStudioAngleFileInput" accept="image/*" style="position:absolute;width:1px;height:1px;opacity:0;overflow:hidden;">
      </div>
      <div class="cf-actions">
        <button class="cf-btn" id="tvStudioCancel">Отмена</button>
        <button class="cf-btn primary" id="tvStudioSave" ${existing && existing.name ? '' : 'disabled'}>${existing ? 'Сохранить' : 'Добавить'}</button>
      </div>
    </div>`;

  function renderAngleGrid(){
    const grid = document.getElementById('tvStudioAngleGrid');
    if(!grid) return;
    grid.innerHTML = TV_STUDIO_ANGLE_KEYS.map(key=>{
      const src = localAngles[key];
      return `<div class="angle-slot${src?' filled':' optional'}" data-slot="${key}">
        ${src ? `<img src="${src}"><div class="slot-remove" data-remove="${key}"><i class="ti ti-x" style="font-size:10px;"></i></div>` : `<span class="slot-plus"><i class="ti ti-plus"></i></span>`}
        <span class="slot-label">${TV_STUDIO_ANGLE_LABELS[key]}</span>
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
        localAngles[btn.dataset.remove] = null;
        renderAngleGrid();
      };
    });
  }
  const slotFileInput = document.getElementById('tvStudioAngleFileInput');
  let activeSlotKey = null;
  slotFileInput.onchange = async ()=>{
    const file = slotFileInput.files[0];
    if(!file || !activeSlotKey) return;
    try{
      localAngles[activeSlotKey] = await loadImageAsDataURL(file);
      renderAngleGrid();
    } catch(err){}
    slotFileInput.value = '';
  };
  renderAngleGrid();

  const nameInput = document.getElementById('tvStudioName');
  const saveBtn = document.getElementById('tvStudioSave');
  nameInput.addEventListener('input', ()=>{ saveBtn.disabled = nameInput.value.trim().length===0; });

  document.getElementById('tvStudioCancel').onclick = ()=> existing ? tvOpenStudioDetail(existing) : tvCloseModal();
  saveBtn.onclick = async ()=>{
    const name = nameInput.value.trim();
    if(!name) return;
    saveBtn.disabled = true; saveBtn.textContent = 'Сохранение…';
    const payload = { name, rubric: document.getElementById('tvStudioRubric').value || null };
    const studio = tvSaveStudioLocal(payload, existing || null);
    studio.angles = studio.angles || tvEmptyStudioAngles();
    studio._assetFiles = studio._assetFiles || {};
    for(const key of TV_STUDIO_ANGLE_KEYS){
      const val = localAngles[key];
      if(val && val.indexOf('data:')===0){
        const result = await tvPersistLocalImageAsset('studio:' + studio.id + ':angle:' + key, val);
        studio.angles[key] = result ? result.url : val;
        studio._assetFiles['angle_' + key] = !!result;
        studio._assetFiles['angle_' + key + 'File'] = result ? result.fileName : undefined;
      } else if(!val){
        studio.angles[key] = null;
        delete studio._assetFiles['angle_' + key];
        delete studio._assetFiles['angle_' + key + 'File'];
      }
    }
    tvSaveSoon();
    renderTvStudios();
    tvOpenStudioDetail(studio);
  };
  tvOpenModal();
}

// ---- Новости tab: two-pane picker (left = proposed, right = included in episode) ----
// ---- target week (client-side mirror of server.js's tvHistoricalWeekRange) — drives both
// the calendar and the week sent to /api/tv/gather-news ----
// Date components stay LOCAL throughout (renderTvNewsCalendar() below reads startDate/
// endDate back out with local getters to highlight days on a human-facing calendar grid —
// that's correct, a calendar should follow the viewer's own local day boundaries). The
// `start`/`end` STRINGS actually sent to the server used to go through `toISOString()`,
// which re-interprets a local-midnight Date in UTC — for any positive-offset timezone
// (Россия included), that silently rolled the reported date back by one, shifting the
// whole range the server searched. Formatting directly off the local Y/M/D components
// instead avoids that UTC round-trip entirely.
function tvFmtLocalDate(d){
  const pad = (n)=> String(n).padStart(2,'0');
  return d.getFullYear() + '-' + pad(d.getMonth()+1) + '-' + pad(d.getDate());
}
function tvComputeTargetWeek(refDate){
  const now = refDate || new Date();
  const day = now.getDay(); // 0=Sun..6=Sat, local time
  const monday = new Date(now);
  monday.setHours(0,0,0,0);
  monday.setDate(now.getDate() + ((day===0 ? -6 : 1) - day));
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  const histMonday = new Date(monday); histMonday.setFullYear(monday.getFullYear() - 25);
  const histSunday = new Date(sunday); histSunday.setFullYear(sunday.getFullYear() - 25);
  return { start: tvFmtLocalDate(histMonday), end: tvFmtLocalDate(histSunday), startDate: histMonday, endDate: histSunday, year: histMonday.getFullYear() };
}
const TV_MONTH_NAMES = ['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря'];
// Static display only (no navigation, per Костян) — a month grid for the target week's
// month, with that week's 7 days highlighted.
function renderTvNewsCalendar(){
  const el = document.getElementById('tvNewsCalendar');
  if(!el) return;
  const week = tvComputeTargetWeek();
  const monthStart = new Date(week.startDate.getFullYear(), week.startDate.getMonth(), 1);
  const startWeekday = (monthStart.getDay() + 6) % 7; // Monday-start grid
  const daysInMonth = new Date(monthStart.getFullYear(), monthStart.getMonth()+1, 0).getDate();
  const inTargetWeek = (d)=> d >= week.startDate && d <= week.endDate;

  let cells = '';
  for(let i=0;i<startWeekday;i++) cells += `<div class="tv-cal-cell empty"></div>`;
  for(let day=1; day<=daysInMonth; day++){
    const d = new Date(monthStart.getFullYear(), monthStart.getMonth(), day);
    cells += `<div class="tv-cal-cell${inTargetWeek(d) ? ' tv-cal-cell-active' : ''}">${day}</div>`;
  }
  const sameMonth = week.startDate.getMonth()===week.endDate.getMonth();
  const label = sameMonth
    ? `${week.startDate.getDate()}–${week.endDate.getDate()} ${TV_MONTH_NAMES[week.endDate.getMonth()]} ${week.year}`
    : `${week.startDate.getDate()} ${TV_MONTH_NAMES[week.startDate.getMonth()]} – ${week.endDate.getDate()} ${TV_MONTH_NAMES[week.endDate.getMonth()]} ${week.year}`;
  el.innerHTML = `
    <div class="tv-cal-header">Неделя выпуска: ${label}</div>
    <div class="tv-cal-weekdays">${['Пн','Вт','Ср','Чт','Пт','Сб','Вс'].map(w=> `<div>${w}</div>`).join('')}</div>
    <div class="tv-cal-grid">${cells}</div>
  `;
}

// ---- Новости / Архив sub-tabs ----
// Костян's worry was clutter — instead of a manual "clear" button, stale proposals
// (not-included items whose gatheredForWeek no longer matches the current target week)
// move themselves to a dated archive on the next "Собрать новости", and anything sitting
// in the archive for 30 days is deleted for good (tvPruneOldArchive). Items already в
// выпуске are never auto-archived regardless of week, since work on an episode can span
// more than one calendar week.
let tvNewsSubTab = 'news'; // 'news' | 'archive'
const tvSelectedNewsIds = new Set(); // checked items in "Предложено", for bulk actions

function tvPruneOldArchive(){
  const cutoff = Date.now() - 30*24*60*60*1000;
  const before = tvState.tvNewsItems.length;
  tvState.tvNewsItems = tvState.tvNewsItems.filter(n=> !(n.archived && n.archivedAt && n.archivedAt < cutoff));
  if(tvState.tvNewsItems.length !== before) tvSaveSoon();
}
// Archives everything currently "Предложено" (proposed but not yet included) so a fresh
// "Собрать новости" run doesn't treat them as duplicates (tvGatherNews()'s dedup check
// only looks at !n.archived items, regardless of included — see there) and can re-propose
// the same real story again. "В выпуске" is left untouched on purpose — those are already
// decided, unlike stale/unwanted proposals. Archiving rather than deleting keeps the
// existing 30-day "Вернуть" undo window (tvPruneOldArchive) instead of losing anything for good.
function tvClearProposedNews(){
  const proposed = tvState.tvNewsItems.filter(n=> !n.included && !n.archived);
  if(!proposed.length) return;
  proposed.forEach(n=>{ n.archived = true; n.archivedAt = Date.now(); });
  renderTvNewsPickers();
  renderTvNewsSubTabs();
  tvSaveSoon();
}
function tvSwitchNewsSubTab(tab){
  tvNewsSubTab = tab;
  tvSelectedNewsIds.clear();
  renderTvNewsSubTabs();
}
function renderTvNewsSubTabs(){
  const tabsEl = document.getElementById('tvNewsSubTabs');
  const mainView = document.getElementById('tvNewsMainView');
  const archiveView = document.getElementById('tvNewsArchiveView');
  if(!tabsEl || !mainView || !archiveView) return;
  const archivedCount = tvState.tvNewsItems.filter(n=> n.archived).length;
  tabsEl.querySelectorAll('.tv-subtab').forEach(t=> t.classList.toggle('active', t.dataset.subtab===tvNewsSubTab));
  const archiveTabEl = tabsEl.querySelector('[data-subtab="archive"]');
  if(archiveTabEl) archiveTabEl.textContent = 'Архив' + (archivedCount ? ' (' + archivedCount + ')' : '');
  mainView.classList.toggle('hidden', tvNewsSubTab!=='news');
  archiveView.classList.toggle('hidden', tvNewsSubTab!=='archive');
  if(tvNewsSubTab==='archive') renderTvNewsArchive();
}
function renderTvNewsArchive(){
  const el = document.getElementById('tvNewsArchiveList');
  if(!el) return;
  const items = tvState.tvNewsItems.filter(n=> n.archived).sort((a,b)=> (b.archivedAt||0)-(a.archivedAt||0));
  if(!items.length){ el.innerHTML = `<div class="tv-empty-hint">Архив пуст.</div>`; return; }
  el.innerHTML = items.map(n=>{
    const daysLeft = n.archivedAt ? Math.max(0, 30 - Math.floor((Date.now()-n.archivedAt)/86400000)) : 30;
    return `<div class="tv-news-row" data-id="${n.id}">
      <span class="tv-news-rubric">${tvRubricLabel(n.rubric)}</span>
      <span class="tv-news-title">${n.title}</span>
      <span class="tv-news-flag" title="Удалится безвозвратно">удалится через ${daysLeft} дн.</span>
      <button class="cf-btn" data-restore="${n.id}" style="flex:0 0 auto;padding:3px 8px;font-size:11px;">Вернуть</button>
    </div>`;
  }).join('');
  el.querySelectorAll('[data-restore]').forEach(btn=>{
    btn.onclick = ()=>{
      const id = Number(btn.dataset.restore);
      const item = tvState.tvNewsItems.find(n=> n.id===id);
      if(item){ item.archived = false; item.archivedAt = null; tvSaveSoon(); renderTvNewsArchive(); renderTvNewsSubTabs(); renderTvNewsPickers(); }
    };
  });
}

// ---- two-pane picker, with click-to-expand (read full text + collected materials) ----
const tvExpandedNewsIds = new Set(); // UI-only, not persisted — resets on reload
function tvNewsPrecisionBadge(n){
  if(n.source==='manual') return '<span class="tv-news-flag" style="color:var(--accent-text);border-color:var(--accent);" title="Добавлено вручную, не из автоматического поиска">вручную</span>';
  if(n.sourcePrecision==='week') return '<span class="tv-news-flag tv-news-flag-week" title="Реальный архивный источник, датирован именно этой неделей">неделя</span>';
  if(n.sourcePrecision==='month') return '<span class="tv-news-flag tv-news-flag-month" title="Для этой рубрики за точную неделю ничего не нашлось — источник реальный, но датирован в пределах месяца">месяц</span>';
  if(n.sourcePrecision==='year') return '<span class="tv-news-flag tv-news-flag-year" title="Источник — Wikipedia, точность в пределах года, не недели">год</span>';
  return '';
}
function tvUpdateNewsBulkButtons(){
  const bar = document.getElementById('tvNewsBulkActions');
  if(!bar) return;
  const count = tvSelectedNewsIds.size;
  bar.style.display = count ? 'flex' : 'none';
  const countEl = document.getElementById('tvNewsBulkCount');
  if(countEl) countEl.textContent = 'Выбрано: ' + count;
}
function tvBulkMoveSelectedNews(target){ // 'included' | 'archived'
  tvState.tvNewsItems.forEach(n=>{
    if(!tvSelectedNewsIds.has(n.id)) return;
    if(target==='included') n.included = true;
    else if(target==='archived'){ n.archived = true; n.archivedAt = Date.now(); }
  });
  tvSelectedNewsIds.clear();
  renderTvNewsPickers();
  renderTvNewsSubTabs();
  tvSaveSoon();
}
function renderTvNewsPickers(){
  const leftEl = document.getElementById('tvNewsLeftPane');
  const rightEl = document.getElementById('tvNewsRightPane');
  if(!leftEl || !rightEl) return;
  const left = tvState.tvNewsItems.filter(n=> !n.included && !n.archived);
  const right = tvState.tvNewsItems.filter(n=> n.included && !n.archived);
  const row = (n, pane)=>{
    const expanded = tvExpandedNewsIds.has(n.id);
    return `<div class="tv-news-row-wrap">
      <div class="tv-news-row" data-id="${n.id}">
        ${pane==='left' ? `<input type="checkbox" class="tv-news-checkbox" data-check="${n.id}"${tvSelectedNewsIds.has(n.id) ? ' checked' : ''}>` : ''}
        <span class="tv-news-rubric">${tvRubricLabel(n.rubric)}</span>
        <span class="tv-news-title">${n.title}</span>
        ${tvNewsPrecisionBadge(n)}
        ${n.materialStatus==='мало материала' ? '<span class="tv-news-flag">мало материала</span>' : ''}
        ${n.isAnniversary ? '<span class="tv-news-flag tv-news-flag-anniv">юбилей</span>' : ''}
        ${pane==='right' ? `<button class="tv-news-return-btn" data-unincude="${n.id}" title="Вернуть в Предложено">Вернуть</button>` : ''}
      </div>
      ${expanded ? `<div class="tv-news-expand">
        ${n.summary ? `<p>${n.summary}</p>` : ''}
        ${n.extract && n.extract!==n.summary ? `<p class="tv-news-expand-extract">${n.extract}</p>` : ''}
        ${n.sourceUrl ? `<a href="${n.sourceUrl}" target="_blank" rel="noopener" class="tv-news-source-link">Источник${n.sourceDate ? ' · ' + n.sourceDate : ''}</a>` : ''}
        ${n.media && n.media.length ? `<div class="tv-news-media">${n.media.map(m=> `<img src="${m.url}" title="${m.title||''}">`).join('')}</div>` : '<div class="gen-hint" style="margin:6px 0 0;">Материалов пока нет.</div>'}
      </div>` : ''}
    </div>`;
  };
  leftEl.innerHTML = left.length ? left.map(n=> row(n,'left')).join('') : `<div class="tv-empty-hint">Нет предложенных новостей.</div>`;
  rightEl.innerHTML = right.length ? right.map(n=> row(n,'right')).join('') : `<div class="tv-empty-hint">Отметьте новости в «Предложено» и нажмите «В выпуск».</div>`;
  [leftEl, rightEl].forEach(pane=>{
    pane.querySelectorAll('.tv-news-row').forEach(rowEl=>{
      rowEl.onclick = (e)=>{
        if(e.target.closest('a') || e.target.closest('.tv-news-checkbox') || e.target.closest('.tv-news-return-btn')) return;
        const id = Number(rowEl.dataset.id);
        if(tvExpandedNewsIds.has(id)) tvExpandedNewsIds.delete(id); else tvExpandedNewsIds.add(id);
        renderTvNewsPickers();
      };
    });
  });
  rightEl.querySelectorAll('.tv-news-return-btn').forEach(btn=>{
    btn.onclick = (e)=>{
      e.stopPropagation();
      const id = Number(btn.dataset.unincude);
      const item = tvState.tvNewsItems.find(n=> n.id===id);
      if(item){ item.included = false; tvSaveSoon(); renderTvNewsPickers(); }
    };
  });
  leftEl.querySelectorAll('.tv-news-checkbox').forEach(cb=>{
    cb.onclick = (e)=> e.stopPropagation();
    cb.onchange = ()=>{
      const id = Number(cb.dataset.check);
      if(cb.checked) tvSelectedNewsIds.add(id); else tvSelectedNewsIds.delete(id);
      tvUpdateNewsBulkButtons();
    };
  });
  tvUpdateNewsBulkButtons();
}

// ---- manual news item creation — yellow "+" above the "В выпуске" pane. Костян can add a
// story himself (title, rubric, content, his own photos) and it lands straight in the
// episode, bypassing Wayback/Wikipedia sourcing entirely — for stories he already knows
// about and has material for. Tagged source:'manual' so tvNewsPrecisionBadge shows
// "вручную" instead of a week/month/year precision badge (there's no source URL to be
// precise about). ----
let tvManualNewsPhotos = []; // [{ id, url }] — local to the open modal, not saved until Save
function tvOpenManualNewsForm(){
  tvManualNewsPhotos = [];
  const body = document.getElementById('tvAnchorModalBody');
  body.innerHTML = `
    <div class="char-form">
      <h3>Новость вручную</h3>
      <p class="sub">Добавьте свою новость напрямую — сразу «В выпуске», без поиска по архивам.</p>
      <div class="cf-field"><label>Тема</label><input type="text" id="tvManualNewsTitle" placeholder="Например, вышла новая версия ICQ"></div>
      <div class="cf-field"><label>Рубрика</label><select id="tvManualNewsRubric">
        ${TV_RUBRICS.map(r=> `<option value="${r.key}">${r.label}</option>`).join('')}
      </select></div>
      <div class="cf-field"><label>Содержание</label><textarea id="tvManualNewsContent" placeholder="О чём новость — коротко перескажите суть"></textarea></div>
      <div class="cf-field">
        <label>Фотографии</label>
        <div class="angle-slots-grid" id="tvManualNewsPhotoGrid"></div>
        <input type="file" id="tvManualNewsPhotoInput" accept="image/*" multiple style="position:absolute;width:1px;height:1px;opacity:0;overflow:hidden;">
      </div>
      <div class="cf-actions">
        <button class="cf-btn" id="tvManualNewsCancel">Отмена</button>
        <button class="cf-btn primary" id="tvManualNewsSave" disabled>Сохранить</button>
      </div>
    </div>`;

  tvRenderManualNewsPhotoGrid();

  const titleInput = document.getElementById('tvManualNewsTitle');
  const saveBtn = document.getElementById('tvManualNewsSave');
  titleInput.addEventListener('input', ()=>{ saveBtn.disabled = titleInput.value.trim().length===0; });

  document.getElementById('tvManualNewsCancel').onclick = tvCloseModal;
  saveBtn.onclick = ()=> tvSaveManualNewsItem();
  tvOpenModal();
}
function tvRenderManualNewsPhotoGrid(){
  const grid = document.getElementById('tvManualNewsPhotoGrid');
  const input = document.getElementById('tvManualNewsPhotoInput');
  if(!grid || !input) return;
  grid.innerHTML = tvManualNewsPhotos.map(p=> `
      <div class="angle-slot filled" data-photo-tile="${p.id}">
        <img src="${p.url}"><div class="slot-remove" data-remove-photo="${p.id}"><i class="ti ti-x" style="font-size:10px;"></i></div>
      </div>`).join('')
    + `<div class="angle-slot optional" id="tvManualNewsAddPhotoTile"><span class="slot-plus"><i class="ti ti-plus"></i></span><span class="slot-label">Добавить фото</span></div>`;
  document.getElementById('tvManualNewsAddPhotoTile').onclick = ()=> input.click();
  grid.querySelectorAll('[data-remove-photo]').forEach(btn=>{
    btn.onclick = (e)=>{
      e.stopPropagation();
      tvManualNewsPhotos = tvManualNewsPhotos.filter(p=> p.id!==btn.dataset.removePhoto);
      tvRenderManualNewsPhotoGrid();
    };
  });
  input.onchange = async ()=>{
    const files = Array.from(input.files || []);
    for(const file of files){
      try{
        const dataUrl = await loadImageAsDataURL(file);
        tvManualNewsPhotos.push({ id: 'm' + Date.now() + Math.random().toString(36).slice(2), url: dataUrl });
      } catch(err){}
    }
    input.value = '';
    tvRenderManualNewsPhotoGrid();
  };
}
async function tvSaveManualNewsItem(){
  const title = document.getElementById('tvManualNewsTitle').value.trim();
  if(!title) return;
  const rubric = document.getElementById('tvManualNewsRubric').value;
  const content = document.getElementById('tvManualNewsContent').value.trim();
  const week = tvComputeTargetWeek();
  const id = tvNewsItemSeq++;
  const media = [];
  const mediaAssetFiles = [];
  for(const photo of tvManualNewsPhotos){
    const result = await tvPersistLocalImageAsset('newsitem:' + id + ':media:' + photo.id, photo.url);
    media.push({ type:'image', url: result ? result.url : photo.url, title:'', id: photo.id });
    if(result) mediaAssetFiles.push({ id: photo.id, fileName: result.fileName });
  }
  tvState.tvNewsItems.push({
    id,
    rubric,
    title,
    summary: content,
    extract: content,
    sourceDate: null,
    sourceUrl: null,
    source: 'manual',
    sourcePrecision: null,
    media,
    materialStatus: media.length ? 'ok' : 'мало материала',
    isAnniversary: false,
    included: true,
    archived: false,
    archivedAt: null,
    gatheredForWeek: week.start,
    assignedAnchorId: null,
    approvedForRelease: false,
    sortOrder: 0,
    _assetFiles: mediaAssetFiles.length ? { media: mediaAssetFiles } : undefined,
  });
  tvManualNewsPhotos = [];
  tvCloseModal();
  renderTvNewsPickers();
  renderTvNewsSubTabs();
  tvSaveSoon();
}

// ---- Редакция tab (data-tv-page="studio", renamed in the UI — "Студия" was ambiguous
// against the Студии entity gallery on Work) — assign anchor + studio per included news
// item, then send fully-assigned items off as article-writing tasks. Auto-assigns the
// rubric's own anchor/studio whenever the match is unambiguous ("тот, кто обычно отвечает
// за рубрику"); ambiguous or missing matches stay unassigned (red) for a manual pick, on
// every render — not just once — so adding an anchor/studio later fills gaps automatically. ----
function tvRedaktsiyaItemStatus(item){
  if(item.assignedAnchorId && item.assignedStudioId) return 'green';
  if(item.assignedAnchorId || item.assignedStudioId) return 'yellow';
  return 'red';
}
function tvAutoAssignRedaktsiyaDefaults(){
  const included = tvState.tvNewsItems.filter(n=> n.included && !n.archived);
  let changed = false;
  included.forEach(item=>{
    if(!item.assignedAnchorId){
      const matches = tvState.tvAnchors.filter(a=> a.rubric===item.rubric);
      if(matches.length===1){ item.assignedAnchorId = matches[0].id; changed = true; }
    }
    if(!item.assignedStudioId){
      const anchor = item.assignedAnchorId ? tvState.tvAnchors.find(a=> a.id===item.assignedAnchorId) : null;
      const targetRubric = anchor ? anchor.rubric : item.rubric;
      const matches = tvState.tvStudios.filter(s=> s.rubric===targetRubric);
      if(matches.length===1){ item.assignedStudioId = matches[0].id; changed = true; }
    }
  });
  if(changed) tvSaveSoon();
}
function tvUpdateSendToWritingButton(){
  const btn = document.getElementById('tvSendToWritingBtn');
  if(!btn) return;
  const included = tvState.tvNewsItems.filter(n=> n.included && !n.archived);
  const ready = included.filter(n=> tvRedaktsiyaItemStatus(n)==='green' && !n.articleTaskId && !n.articleText);
  btn.disabled = ready.length===0;
  btn.textContent = ready.length ? ('Отправить на написание статей (' + ready.length + ')') : 'Отправить на написание статей';
}
function renderTvRedaktsiya(){
  const el = document.getElementById('tvStudioList');
  if(!el) return;
  tvAutoAssignRedaktsiyaDefaults();
  const included = tvState.tvNewsItems.filter(n=> n.included && !n.archived);
  if(!included.length){
    el.innerHTML = `<div class="tv-empty-hint">Нет новостей, включённых в выпуск — добавьте их на вкладке «Новости».</div>`;
    tvUpdateSendToWritingButton();
    return;
  }
  const rubricOrder = TV_RUBRICS.map(r=> r.key);
  const groups = [...new Set(included.map(n=> n.rubric))].sort((a,b)=> rubricOrder.indexOf(a)-rubricOrder.indexOf(b));
  el.innerHTML = groups.map(rubricKey=>{
    const items = included.filter(n=> n.rubric===rubricKey).sort((a,b)=> (a.sortOrder||0)-(b.sortOrder||0));
    const rows = items.map(item=>{
      const status = tvRedaktsiyaItemStatus(item);
      const sentLabel = item.articleText ? 'текст готов' : item.articleTaskId ? 'отправлено' : '';
      return `<div class="tv-news-row" data-id="${item.id}">
        <span class="tv-redak-status-dot status-${status}"></span>
        <span class="tv-news-title">${item.title}</span>
        <select class="tv-redak-select" data-anchor-for="${item.id}">
          <option value="">— ведущий —</option>
          ${tvState.tvAnchors.map(a=> `<option value="${a.id}"${item.assignedAnchorId===a.id?' selected':''}>${a.name}</option>`).join('')}
        </select>
        <select class="tv-redak-select" data-studio-for="${item.id}">
          <option value="">— студия —</option>
          ${tvState.tvStudios.map(s=> `<option value="${s.id}"${item.assignedStudioId===s.id?' selected':''}>${s.name}</option>`).join('')}
        </select>
        ${sentLabel ? `<span class="tv-redak-sent-badge">${sentLabel}</span>` : ''}
      </div>`;
    }).join('');
    return `<div class="tv-redak-rubric-title">${tvRubricLabel(rubricKey)}</div>${rows}`;
  }).join('');

  el.querySelectorAll('[data-anchor-for]').forEach(sel=>{
    sel.onchange = ()=>{
      const item = tvState.tvNewsItems.find(n=> n.id===Number(sel.dataset.anchorFor));
      if(!item) return;
      item.assignedAnchorId = sel.value ? Number(sel.value) : null;
      tvSaveSoon();
      renderTvRedaktsiya();
    };
  });
  el.querySelectorAll('[data-studio-for]').forEach(sel=>{
    sel.onchange = ()=>{
      const item = tvState.tvNewsItems.find(n=> n.id===Number(sel.dataset.studioFor));
      if(!item) return;
      item.assignedStudioId = sel.value ? Number(sel.value) : null;
      tvSaveSoon();
      renderTvRedaktsiya();
    };
  });
  tvUpdateSendToWritingButton();
}
// Queues a text-writing TASKS entry for every fully-assigned item that isn't already
// written or already queued — the actual Gemini call happens later, from the TASKS tile
// itself, once Костян picks a model and clicks Generate (never auto-started).
function tvSendToWriting(){
  const included = tvState.tvNewsItems.filter(n=> n.included && !n.archived);
  const ready = included.filter(n=> tvRedaktsiyaItemStatus(n)==='green' && !n.articleTaskId && !n.articleText);
  if(!ready.length) return;
  ready.forEach(item=>{
    const task = { id: tvTaskSeq++, kind:'article', newsItemId: item.id, model:null, status:'draft', createdAt: Date.now() };
    tvState.tvTaskQueue.push(task);
    item.articleTaskId = task.id;
  });
  tvSaveSoon();
  renderTvRedaktsiya();
  renderTvTasks();
  const hint = document.getElementById('tvRedaktsiyaHint');
  if(hint){
    hint.textContent = 'Отправлено в TASKS: ' + ready.length;
    setTimeout(()=>{ if(hint.textContent==='Отправлено в TASKS: ' + ready.length) hint.textContent=''; }, 4000);
  }
}

// ---- TASKS tab — two-phase tiles, same lifecycle as js/tasks.js's own queue: 'draft' (model
// not chosen/sent yet) -> 'running' (sent, waiting on the provider) -> 'done'/'failed'. Never
// auto-starts — a draft tile just sits there until Костян picks a model and clicks Generate. ----
function tvTaskModelOptions(kind){
  return kind==='article' ? tvTextModelOptions : tvVoiceModelOptions;
}
function tvFormatCost(costUsd){
  return costUsd ? ('$' + costUsd.toFixed(2)) : 'бесплатно';
}
// Same idea as the main app's updateTasksBadge() (js/tasks.js) — count draft + in-flight
// tasks so the TASKS tab shows at a glance whether anything needs attention.
function tvUpdateTasksBadge(){
  const badge = document.getElementById('tvTasksBadge');
  if(!badge) return;
  const total = tvState.tvTaskQueue.filter(t=> t.status==='draft' || t.status==='running' || t.status==='failed').length;
  badge.style.display = total ? '' : 'none';
  badge.textContent = String(total);
}
// Thumb = the news item's own illustration when it has one (same media Новости already
// collected), so a TASKS tile is recognizable at a glance instead of being plain text.
// A task is either for a news item (article writing, or its voicing) or a grid block
// (voicing only — grid-block TEXT is written directly via "Сделать ведущему", never
// TASKS-queued). This resolves either shape into one normalized view so the rest of TASKS
// doesn't need to care which kind of thing it's looking at.
function tvResolveTaskTarget(task){
  if(task.blockId){
    const block = tvState.tvGridBlocks.find(b=> b.id===task.blockId);
    if(!block) return null;
    return {
      kindTarget: 'block',
      ref: block,
      title: (TV_GRID_FIXED_LABELS[block.blockType] || block.blockType) + (block.blockType==='rubric_intro' ? ' — ' + tvRubricLabel(block.rubric) : ''),
      anchor: tvState.tvAnchors.find(a=> a.id===block.anchorId),
      mediaUrl: null,
    };
  }
  const item = tvState.tvNewsItems.find(n=> n.id===task.newsItemId);
  if(!item) return null;
  return {
    kindTarget: 'newsItem',
    ref: item,
    title: item.title,
    anchor: tvState.tvAnchors.find(a=> a.id===item.assignedAnchorId),
    mediaUrl: item.media && item.media[0] && item.media[0].url,
  };
}
function tvTaskThumbHtml(mediaUrl){
  return `<div class="task-tile-thumb">${mediaUrl ? `<img src="${mediaUrl}">` : '<i class="ti ti-news" style="font-size:22px;color:var(--text-3);"></i>'}</div>`;
}
// Who's actually responsible for this piece — small avatar + name, same idea as the
// anchor tiles elsewhere, so a TASKS tile answers "whose job is this" without opening it.
function tvTaskAnchorRowHtml(anchor){
  if(!anchor) return '';
  return `<div class="tv-task-anchor-row">
    <span class="tv-task-anchor-photo">${anchor.photo ? `<img src="${anchor.photo}">` : '<i class="ti ti-user"></i>'}</span>
    <span class="tv-task-anchor-name">${anchor.name}</span>
  </div>`;
}
function renderTvTasks(){
  const el = document.getElementById('tvTasksBox');
  tvUpdateTasksBadge();
  if(!el) return;
  if(!tvState.tvTaskQueue.length){
    el.innerHTML = `<div class="tv-empty-hint">Задач пока нет.</div>`;
    return;
  }
  el.innerHTML = tvState.tvTaskQueue.map(t=>{
    const target = tvResolveTaskTarget(t);
    const kindLabel = t.kind==='article' ? 'Текст' : 'Озвучка';
    const title = target ? target.title : (t.blockId ? '— блок удалён —' : '— новость удалена —');
    // 'draft' (never sent) and 'failed' (sent, came back with an error) both need the same
    // thing: pick/change a model, then send — a failed task shouldn't be a dead end that
    // forces deleting it and re-queuing from scratch just to try a different model.
    if(t.status==='draft' || t.status==='failed'){
      const options = tvTaskModelOptions(t.kind);
      const modelHtml = options.length
        ? `<select class="tv-redak-select" data-task-model="${t.id}" style="width:100%;">
             <option value="">Выберите модель</option>
             ${options.map(m=> `<option value="${m.id}"${t.model===m.id?' selected':''}>${m.label} — ${tvFormatCost(m.costUsd)}</option>`).join('')}
           </select>`
        : `<div class="gen-hint" style="margin:0;">Модели недоступны.</div>`;
      return `<div class="task-tile draft" data-task-id="${t.id}">
        ${tvTaskThumbHtml(target && target.mediaUrl)}
        <div class="task-tile-body">
          <div class="task-tile-scene">${kindLabel}</div>
          <div class="task-tile-shot">${title}</div>
          ${tvTaskAnchorRowHtml(target && target.anchor)}
          ${t.status==='failed' ? `<div class="task-tile-error">${(t.errorMessage||'').replace(/</g,'&lt;')}</div>` : ''}
          <div class="tv-task-model-row">${modelHtml}</div>
          <button class="cf-btn primary task-tile-send-btn" style="width:100%;margin-top:8px;" data-run="${t.id}" ${t.model?'':'disabled'}>${t.status==='failed' ? 'Повторить' : 'Сгенерировать'}</button>
          <button class="cf-btn" style="width:100%;margin-top:6px;" data-remove="${t.id}">Убрать из очереди</button>
        </div>
      </div>`;
    }
    const statusLabel = t.status==='running' ? 'генерация…' : 'готово';
    return `<div class="task-tile" data-task-id="${t.id}">
      ${tvTaskThumbHtml(target && target.mediaUrl)}
      <div class="task-tile-body">
        <div class="task-tile-scene">${kindLabel}</div>
        <div class="task-tile-shot">${title}</div>
        ${tvTaskAnchorRowHtml(target && target.anchor)}
        <div class="task-tile-status ${t.status}">${statusLabel}</div>
        ${t.status==='running' ? `<div class="task-tile-spin"></div>` : ''}
        <button class="cf-btn" style="width:100%;margin-top:8px;" data-remove="${t.id}">Убрать из очереди</button>
      </div>
    </div>`;
  }).join('');

  el.querySelectorAll('[data-task-model]').forEach(sel=>{
    sel.onchange = ()=>{
      const task = tvState.tvTaskQueue.find(t=> t.id===Number(sel.dataset.taskModel));
      if(task){ task.model = sel.value || null; tvSaveSoon(); renderTvTasks(); }
    };
  });
  el.querySelectorAll('[data-run]').forEach(btn=>{
    btn.onclick = ()=> tvRunTvTask(Number(btn.dataset.run));
  });
  el.querySelectorAll('[data-remove]').forEach(btn=>{
    btn.onclick = ()=>{
      const id = Number(btn.dataset.remove);
      const task = tvState.tvTaskQueue.find(t=> t.id===id);
      if(task){
        const target = tvResolveTaskTarget(task);
        if(target){
          if(target.ref.articleTaskId===id) target.ref.articleTaskId = null;
          if(target.ref.voiceTaskId===id) target.ref.voiceTaskId = null;
        }
      }
      tvState.tvTaskQueue = tvState.tvTaskQueue.filter(t=> t.id!==id);
      tvSaveSoon();
      renderTvTasks();
      renderTvRedaktsiya();
      renderTvGrid();
    };
  });
}
// Actually runs a task against the server — the ONLY place either Gemini route gets called
// from. Writes the result straight onto the news item or grid block (articleText/voiceUrl,
// or text/voiceUrl); the task tile itself just flips to 'done'/'failed' and stays until
// dismissed. kind:'article' is only ever queued for news items (grid blocks use the direct
// "Сделать ведущему" flow for text, never TASKS) — see tvResolveTaskTarget above.
async function tvRunTvTask(taskId){
  const task = tvState.tvTaskQueue.find(t=> t.id===taskId);
  if(!task || !task.model) return;
  const target = tvResolveTaskTarget(task);
  if(!target){ task.status = 'failed'; task.errorMessage = task.blockId ? 'Блок удалён.' : 'Новость удалена.'; renderTvTasks(); return; }
  task.status = 'running';
  renderTvTasks();
  try{
    if(task.kind==='article'){
      const item = target.ref;
      const anchor = target.anchor;
      if(!anchor) throw new Error('Ведущий не назначен.');
      const personaContext = tvBuildAnchorVoiceContext(anchor);
      // A different catchphrase/action picked per article, not the same one every time —
      // per Костян's explicit ask ("не каждую статью одну и ту же фразочку"). Picked here
      // (not left to the model) so it's genuinely randomized rather than the model settling
      // into a favorite. chosenAction becomes a parenthetical stage-direction remark in the
      // written text — the model is told this explicitly, see server.js's prompt.
      const p = anchor.persona || {};
      const catchphrasePool = (p.catchphrases && p.catchphrases.length) ? p.catchphrases : [p.catchphrase];
      const chosenCatchphrase = tvPickRandom(catchphrasePool);
      const chosenAction = tvPickRandom(p.signatureActions);
      const res = await fetch('/api/tv/write-article', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: item.title, summary: item.summary, extract: item.extract, rubric: item.rubric,
          sourceDate: item.sourceDate, sourceUrl: item.sourceUrl, source: item.source,
          personaContext, chosenCatchphrase, chosenAction, model: task.model,
        }),
      });
      const data = await res.json().catch(()=> null);
      if(res.status===401) throw new Error('Нужно войти в аккаунт — откройте / и авторизуйтесь, затем вернитесь на /tv.');
      if(!res.ok || !data || !data.text) throw new Error((data && data.message) || 'Не удалось написать текст.');
      item.articleText = data.text;
      item.articleTaskId = null;
    } else if(task.kind==='voice'){
      const text = target.kindTarget==='block' ? target.ref.text : target.ref.articleText;
      if(!text) throw new Error('Текст ещё не написан.');
      const anchor = target.anchor;
      const res = await fetch('/api/tv/generate-voice', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, voiceName: anchor && anchor.voiceId, voiceSpeed: anchor && anchor.voiceSpeed, model: task.model }),
      });
      if(res.status===401) throw new Error('Нужно войти в аккаунт — откройте / и авторизуйтесь, затем вернитесь на /tv.');
      if(!res.ok){
        const data = await res.json().catch(()=> null);
        throw new Error((data && data.message) || 'Не удалось озвучить текст.');
      }
      const blob = await res.blob();
      // No hardcoded extension — Gemini always returns WAV, but ElevenLabs (KIE) returns
      // MP3, so this has to follow the actual Content-Type the server sent back.
      const assetKeyPrefix = target.kindTarget==='block' ? 'gridblock:' + target.ref.id : 'newsitem:' + target.ref.id;
      const persisted = await tvPersistBlobAssetDirect(assetKeyPrefix + ':voice', blob);
      target.ref.voiceUrl = persisted ? persisted.url : URL.createObjectURL(blob);
      target.ref._assetFiles = target.ref._assetFiles || {};
      target.ref._assetFiles.voice = !!persisted;
      target.ref._assetFiles.voiceFile = persisted ? persisted.fileName : undefined;
      target.ref.voiceTaskId = null;
    }
    task.status = 'done';
    tvSaveSoon();
  } catch(err){
    task.status = 'failed';
    task.errorMessage = err.message;
  }
  renderTvTasks();
  renderTvRedaktsiya();
  renderTvMic();
  renderTvGrid();
  if(target.kindTarget==='newsItem' && tvMicPanelOpenAnchorId===target.ref.assignedAnchorId){
    tvRenderMicItemsList(target.ref.assignedAnchorId);
  }
}

// ---- Микрофонная tab — anchor tiles; each opens a panel listing the items written for
// that anchor (Редакция -> TASKS 'article' pipeline), with a crossed-out/solid speaker icon
// per item and an "Озвучить" button that queues a 'voice' TASKS entry. ----
function renderTvMic(){
  const el = document.getElementById('tvMicGrid');
  if(!el) return;
  const anchorsWithWork = tvState.tvAnchors.filter(a=>
    tvState.tvNewsItems.some(n=> n.assignedAnchorId===a.id && n.articleText));
  if(!anchorsWithWork.length){
    el.innerHTML = `<div class="tv-empty-hint">Пока нечего озвучивать — сначала назначьте новости и отправьте на написание статей в «Редакции».</div>`;
    return;
  }
  el.innerHTML = anchorsWithWork.map(a=>{
    const items = tvState.tvNewsItems.filter(n=> n.assignedAnchorId===a.id && n.articleText);
    const unvoiced = items.filter(n=> !n.voiceUrl).length;
    return `
    <div class="char-tile" data-id="${a.id}">
      <div class="char-tile-photo">${a.photo ? `<img src="${a.photo}">` : '<i class="ti ti-user"></i>'}</div>
      <div class="char-tile-name">${a.name}</div>
      ${unvoiced ? `<div class="gen-hint" style="margin:2px 0 0;text-align:center;">не озвучено: ${unvoiced}</div>` : ''}
    </div>`;
  }).join('');
  el.querySelectorAll('.char-tile').forEach(tile=>{
    tile.onclick = ()=>{
      const anchor = tvState.tvAnchors.find(a=> String(a.id)===tile.dataset.id);
      if(anchor) tvOpenMicPanel(anchor);
    };
  });
}
let tvMicPanelOpenAnchorId = null;
function tvOpenMicPanel(anchor){
  tvMicPanelOpenAnchorId = anchor.id;
  const body = document.getElementById('tvAnchorModalBody');
  body.innerHTML = `
    <div class="char-form">
      <h3>${anchor.name}</h3>
      <p class="sub">Тексты, подготовленные для этого ведущего.</p>
      <div id="tvMicItemsList"></div>
      <div class="cf-actions" style="margin-top:16px;">
        <button class="cf-btn" id="tvMicBack">Закрыть</button>
      </div>
    </div>`;
  tvRenderMicItemsList(anchor.id);
  document.getElementById('tvMicBack').onclick = tvCloseModal;
  tvOpenModal();
}
function tvRenderMicItemsList(anchorId){
  const listEl = document.getElementById('tvMicItemsList');
  if(!listEl) return;
  const items = tvState.tvNewsItems.filter(n=> n.assignedAnchorId===anchorId && n.articleText);
  if(!items.length){
    listEl.innerHTML = `<div class="gen-hint" style="margin-top:0;">Текстов пока нет.</div>`;
    return;
  }
  listEl.innerHTML = items.map(item=>{
    const voiced = !!item.voiceUrl;
    const pending = item.voiceTaskId != null;
    return `<div class="tv-mic-item" data-item-id="${item.id}">
      <div class="tv-mic-item-del" data-del-item="${item.id}" title="Удалить текст">&times;</div>
      <div class="tv-mic-item-title">${item.title}</div>
      <div class="tv-mic-item-text">${item.articleText}</div>
      <div class="tv-mic-item-row">
        <span class="tv-mic-speaker ${voiced?'voiced':'unvoiced'}" title="${voiced?'Озвучено':'Не озвучено'}">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M15.5 8.5a5 5 0 0 1 0 7"></path></svg>
        </span>
        ${voiced
          ? `<audio class="tv-mic-audio" controls src="${item.voiceUrl}"></audio>`
          : pending
            ? `<span class="gen-hint" style="margin:0;">Отправлено в TASKS</span>`
            : `<button class="cf-btn" data-voice-item="${item.id}">ОЗВУЧИТЬ</button>`}
      </div>
    </div>`;
  }).join('');
  listEl.querySelectorAll('[data-voice-item]').forEach(btn=>{
    btn.onclick = ()=>{
      tvSendToVoicing(Number(btn.dataset.voiceItem));
      tvRenderMicItemsList(anchorId);
    };
  });
  listEl.querySelectorAll('[data-del-item]').forEach(btn=>{
    btn.onclick = ()=>{
      const id = Number(btn.dataset.delItem);
      if(!confirm('Удалить этот текст? Он пропадёт из Микрофонной вместе с озвучкой (если была).')) return;
      tvDeleteMicItemText(id);
      tvRenderMicItemsList(anchorId);
      renderTvMic();
    };
  });
}
// "Delete text" — clears the article/voice for this item so it drops out of Микрофонная's
// (otherwise ever-growing) list. Doesn't undo the assignment itself, just the written/voiced
// output, same way a TASKS tile's "Убрать из очереди" clears a pending task without deleting
// the underlying news item.
function tvDeleteMicItemText(itemId){
  const item = tvState.tvNewsItems.find(n=> n.id===itemId);
  if(!item) return;
  tvState.tvTaskQueue = tvState.tvTaskQueue.filter(t=> t.id!==item.articleTaskId && t.id!==item.voiceTaskId);
  item.articleText = null;
  item.articleTaskId = null;
  item.voiceUrl = null;
  item.voiceTaskId = null;
  item._assetFiles = item._assetFiles || {};
  delete item._assetFiles.voice;
  delete item._assetFiles.voiceFile;
  tvSaveSoon();
  renderTvTasks();
  renderTvRedaktsiya();
}
function tvSendToVoicing(itemId){
  const item = tvState.tvNewsItems.find(n=> n.id===itemId);
  if(!item || !item.articleText || item.voiceUrl || item.voiceTaskId) return;
  const task = { id: tvTaskSeq++, kind:'voice', newsItemId: item.id, model:null, status:'draft', createdAt: Date.now() };
  tvState.tvTaskQueue.push(task);
  item.voiceTaskId = task.id;
  tvSaveSoon();
  renderTvTasks();
  renderTvMic();
}

// ---- Сетка tab: auto-populated from TV_FORMAT_TEMPLATE (see tv-state.js — draft, derived
// from scripts/analyze-show-format.js's analysis of 3 real reference episodes) ----
const TV_GRID_FIXED_LABELS = { intro:'Заставка', host_intro:'Выход ведущего', jingle:'Джингл', rubric_intro:'Подводка к рубрике', outro:'Аутро' };
// Grid blocks with host text/voice (host_intro/rubric_intro/outro) always belong to the
// null-rubric general host, never a rubric specialist — same "живёт в своей передаче" idea
// as Богданов in the reference show. Auto-assigns only when the match is unambiguous, same
// rule as Редакция's anchor default.
function tvGeneralHostAnchorId(){
  const matches = tvState.tvAnchors.filter(a=> !a.rubric);
  return matches.length===1 ? matches[0].id : null;
}
function tvAutoPopulateGrid(){
  const included = tvState.tvNewsItems.filter(n=> n.included);
  if(!included.length){
    alert('Нет новостей, включённых в выпуск — сначала добавьте их на вкладке «Новости».');
    return;
  }
  const t = TV_FORMAT_TEMPLATE;
  const hostAnchorId = tvGeneralHostAnchorId();
  const blocks = [];
  let order = 0;
  const push = (fields)=> blocks.push(Object.assign({ id: tvGridBlockSeq++, rubric:null, newsItemId:null, sortOrder: order++, voTrack:{}, cutaways:[] }, fields));

  push({ blockType:'intro', estimatedDurationSec: t.introDurationSec });
  // host_intro also teases the FIRST rubric — no separate rubric_intro precedes it.
  push({ blockType:'host_intro', estimatedDurationSec: t.hostIntroDurationSec, anchorId: hostAnchorId, text: null, voiceUrl: null, _assetFiles: {} });

  let isFirstRubric = true;
  t.rubricOrder.forEach(rubricKey=>{
    const items = included.filter(n=> n.rubric===rubricKey).sort((a,b)=> (a.sortOrder||0)-(b.sortOrder||0));
    if(!items.length) return;
    if(!isFirstRubric){
      push({ blockType:'rubric_intro', rubric: rubricKey, estimatedDurationSec: t.rubricIntroDurationSec, anchorId: hostAnchorId, text: null, voiceUrl: null, _assetFiles: {} });
    }
    isFirstRubric = false;
    push({ blockType:'jingle', estimatedDurationSec: t.jingleDurationSec });
    items.forEach(item=>{
      push({ blockType:'story', rubric: rubricKey, newsItemId: item.id, estimatedDurationSec: t.storyDurationSec[rubricKey] || 60 });
    });
  });

  push({ blockType:'jingle', estimatedDurationSec: t.jingleDurationSec });
  push({ blockType:'outro', estimatedDurationSec: t.outroDurationSec, anchorId: hostAnchorId, text: null, voiceUrl: null, _assetFiles: {} });

  tvState.tvGridBlocks = blocks;
  tvSaveSoon();
  renderTvGrid();
}
const TV_GRID_HOST_BLOCK_TYPES = ['host_intro', 'rubric_intro', 'outro'];
function tvGridBlockStatus(b){
  if(b.text && b.voiceUrl) return 'green';
  if(b.text) return 'yellow';
  return 'red';
}
function renderTvGrid(){
  const el = document.getElementById('tvGridTrack');
  if(!el) return;
  tvAutoAssignGridHostAnchors();
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
    if(TV_GRID_HOST_BLOCK_TYPES.includes(b.blockType)){
      return `<div class="tv-grid-item clickable" data-block-id="${b.id}">
        <span class="tv-redak-status-dot status-${tvGridBlockStatus(b)}"></span>
        <span class="tv-grid-item-title">${TV_GRID_FIXED_LABELS[b.blockType] || b.blockType}${b.blockType==='rubric_intro' ? ' — ' + tvRubricLabel(b.rubric) : ''}</span>
        <span class="tv-grid-item-dur">~${b.estimatedDurationSec}с</span>
      </div>`;
    }
    return `<div class="tv-grid-item fixed">
      <span class="tv-grid-item-title">${TV_GRID_FIXED_LABELS[b.blockType] || b.blockType}</span>
      <span class="tv-grid-item-dur">~${b.estimatedDurationSec}с</span>
    </div>`;
  }).join('');
  el.innerHTML = `<div class="gen-hint" style="margin-bottom:10px;">Черновая оценка хронометража: ~${Math.round(totalSec/60)} мин (${totalSec} сек) — уточнится, когда появится реальная озвучка.</div><div class="tv-grid-flow">${rows}</div>`;
  el.querySelectorAll('[data-block-id]').forEach(row=>{
    row.onclick = ()=>{
      const block = tvState.tvGridBlocks.find(b=> b.id===Number(row.dataset.blockId));
      if(block) tvOpenGridBlockEditor(block);
    };
  });
}
// Recomputes tvGridBlocks[].anchorId whenever it's still unset and exactly one null-rubric
// anchor now exists — same "recheck every render" rule as Редакция's story assignment, so
// adding the general host after "Собрать сетку" already ran still fills the gap.
function tvAutoAssignGridHostAnchors(){
  const hostId = tvGeneralHostAnchorId();
  if(!hostId) return;
  let changed = false;
  tvState.tvGridBlocks.forEach(b=>{
    if(TV_GRID_HOST_BLOCK_TYPES.includes(b.blockType) && !b.anchorId){
      b.anchorId = hostId;
      changed = true;
    }
  });
  if(changed) tvSaveSoon();
}
// Plain-text summary of everything actually in this episode — fed to write-block-text so
// the host's intro/outro/rubric-tease lines can reference the real lineup, not guess.
function tvBuildEpisodeSummaryText(){
  const blocks = [...tvState.tvGridBlocks].sort((a,b)=> a.sortOrder-b.sortOrder);
  const lines = [];
  let currentRubric = null;
  blocks.forEach(b=>{
    if(b.blockType==='story'){
      if(b.rubric!==currentRubric){
        currentRubric = b.rubric;
        lines.push(tvRubricLabel(currentRubric) + ':');
      }
      const item = tvState.tvNewsItems.find(n=> n.id===b.newsItemId);
      if(item) lines.push('- ' + item.title);
    }
  });
  return lines.join('\n');
}
// Host/rubric-intro/outro editor — reuses the shared modal. "Сделать ведущему" is a direct,
// un-queued call (unlike article writing, which goes through TASKS with a model picker) —
// this is meant to feel like a quick retake, not a heavyweight job. Whatever's currently in
// the textarea when it's clicked goes as a steering directive, not dictated text; the result
// replaces the textarea but still needs an explicit Save, same as everywhere else in /TV.
function tvOpenGridBlockEditor(block){
  const anchor = tvState.tvAnchors.find(a=> a.id===block.anchorId);
  const body = document.getElementById('tvAnchorModalBody');
  const titleLabel = (TV_GRID_FIXED_LABELS[block.blockType] || block.blockType) + (block.blockType==='rubric_intro' ? ' — ' + tvRubricLabel(block.rubric) : '');
  body.innerHTML = `
    <div class="char-form">
      <h3>${titleLabel}</h3>
      <p class="sub">${anchor ? 'Ведущий: ' + anchor.name : 'Ведущий передачи целиком не назначен — заведите его на вкладке Work.'}</p>
      <div class="cf-field">
        <label>Текст</label>
        <textarea id="tvGridBlockText" style="min-height:120px;" placeholder="Напишите текст сами, или короткую заметку о настроении/контексте — и нажмите «Сделать ведущему»">${block.text || ''}</textarea>
      </div>
      <button class="cf-btn" type="button" id="tvGridBlockMakeBtn" style="width:100%;" ${anchor?'':'disabled'}>Сделать ведущему</button>
      <div class="gen-hint" id="tvGridBlockMakeHint" style="margin-top:6px;"></div>
      <div class="cf-actions" style="margin-top:12px;">
        <button class="cf-btn" id="tvGridBlockBack">Закрыть</button>
        <button class="cf-btn primary" id="tvGridBlockSave">Сохранить текст</button>
      </div>
      <div class="char-card-section-title" style="margin-top:16px;">Озвучка</div>
      <div id="tvGridBlockVoiceArea"></div>
    </div>`;

  function renderVoiceArea(){
    const areaEl = document.getElementById('tvGridBlockVoiceArea');
    if(!areaEl) return;
    if(block.voiceUrl){
      areaEl.innerHTML = `<audio class="tv-mic-audio" controls src="${block.voiceUrl}" style="width:100%;"></audio>`;
    } else if(block.voiceTaskId){
      areaEl.innerHTML = `<div class="gen-hint" style="margin:0;">Отправлено в TASKS</div>`;
    } else {
      areaEl.innerHTML = `<button class="cf-btn" id="tvGridBlockVoiceBtn" style="width:100%;" ${block.text?'':'disabled'}>Отправить на озвучку</button>`;
      const voiceBtn = document.getElementById('tvGridBlockVoiceBtn');
      if(voiceBtn) voiceBtn.onclick = ()=>{
        tvSendGridBlockToVoicing(block.id);
        renderVoiceArea();
      };
    }
  }
  renderVoiceArea();

  document.getElementById('tvGridBlockBack').onclick = tvCloseModal;
  document.getElementById('tvGridBlockSave').onclick = ()=>{
    block.text = document.getElementById('tvGridBlockText').value.trim() || null;
    tvSaveSoon();
    renderTvGrid();
    renderVoiceArea();
  };
  const makeBtn = document.getElementById('tvGridBlockMakeBtn');
  if(makeBtn) makeBtn.onclick = async ()=>{
    if(!anchor) return;
    const hint = document.getElementById('tvGridBlockMakeHint');
    const textarea = document.getElementById('tvGridBlockText');
    const directive = textarea.value.trim();
    makeBtn.disabled = true; makeBtn.textContent = 'Генерация…';
    hint.textContent = ''; hint.style.color = '';
    try{
      const personaContext = tvBuildAnchorVoiceContext(anchor);
      const res = await fetch('/api/tv/write-block-text', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          blockType: block.blockType,
          rubricLabel: block.blockType==='rubric_intro' ? tvRubricLabel(block.rubric) : undefined,
          episodeSummary: tvBuildEpisodeSummaryText(),
          directive,
          personaContext,
        }),
      });
      const data = await res.json().catch(()=> null);
      if(res.status===401) throw new Error('Нужно войти в аккаунт — откройте / и авторизуйтесь, затем вернитесь на /tv.');
      if(!res.ok || !data || !data.text) throw new Error((data && data.message) || 'Не удалось написать текст.');
      textarea.value = data.text;
    } catch(err){
      hint.textContent = err.message;
      hint.style.color = 'var(--danger)';
    } finally {
      makeBtn.disabled = false; makeBtn.textContent = 'Сделать ведущему';
    }
  };
  tvOpenModal();
}
function tvSendGridBlockToVoicing(blockId){
  const block = tvState.tvGridBlocks.find(b=> b.id===blockId);
  if(!block || !block.text || block.voiceUrl || block.voiceTaskId) return;
  const task = { id: tvTaskSeq++, kind:'voice', blockId: block.id, model:null, status:'draft', createdAt: Date.now() };
  tvState.tvTaskQueue.push(task);
  block.voiceTaskId = task.id;
  tvSaveSoon();
  renderTvTasks();
  renderTvGrid();
}

// ---- source-selection checkboxes next to "Собрать новости" — which real sources to pull
// from this run (tvState.tvNewsSourceSelection, see tv-state.js for the default reasoning).
// wayback/computerra are the two week-precise sources (main row); wikipedia and the
// month-wide fallback are opt-in extras that trade precision for volume (secondary row,
// visually set apart). ----
const TV_NEWS_SOURCE_LABELS = [
  { key:'wayback', label:'Wayback Machine' },
  { key:'computerra', label:'Компьютерра' },
  { key:'wikipedia', label:'Wikipedia (год, менее точно)', secondary:true },
  { key:'monthFallback', label:'Расширять до месяца, если рубрика пустая', secondary:true },
];
function renderTvNewsSources(){
  const el = document.getElementById('tvNewsSources');
  if(!el) return;
  const sel = tvState.tvNewsSourceSelection;
  el.innerHTML = '<span class="tv-news-sources-label">Источники:</span>'
    + TV_NEWS_SOURCE_LABELS.map(s=> `
      <label class="tv-news-source-check${s.secondary ? ' secondary' : ''}">
        <input type="checkbox" data-news-source="${s.key}"${sel[s.key] ? ' checked' : ''}>${s.label}
      </label>`).join('');
  el.querySelectorAll('[data-news-source]').forEach(cb=>{
    cb.onchange = ()=>{
      tvState.tvNewsSourceSelection[cb.dataset.newsSource] = cb.checked;
      tvSaveSoon();
    };
  });
}

// ---- Собрать новости — real, sourced items only (Wayback Machine + Компьютерра +
// Wikipedia, see server.js's /api/tv/gather-news/*, gated by tvNewsSourceSelection above)
// for the exact target week (tvComputeTargetWeek, matches the calendar shown above it).
// Still always lands unincluded and 'мало материала' — a real, verifiable STORY isn't the
// same as having real photo/video material for it yet; that's still a separate step, per
// CLAUDE.md's rule.
//
// A single blocking request can't stream progress back mid-flight, so this starts a
// background job server-side (POST .../start) and polls its status (GET .../status/:jobId)
// — same start+poll shape already used for KIE tasks elsewhere in this app. Each poll's log
// array is rendered wholesale into the console panel next to the calendar; "Стоп" cancels
// the running job (POST .../cancel/:jobId). ----
let tvGatherJobId = null;
let tvGatherPollTimer = null;
function tvRenderGatherConsole(lines){
  const el = document.getElementById('tvNewsConsoleBody');
  if(!el || !Array.isArray(lines)) return;
  el.textContent = lines.join('\n');
  el.scrollTop = el.scrollHeight;
}
function tvStopGatherNews(){
  if(!tvGatherJobId) return;
  fetch('/api/tv/gather-news/cancel/' + tvGatherJobId, { method:'POST' }).catch(()=>{});
  const stopBtn = document.getElementById('tvGatherNewsStopBtn');
  if(stopBtn) stopBtn.disabled = true;
}
async function tvGatherNews(){
  const btn = document.getElementById('tvGatherNewsBtn');
  const stopBtn = document.getElementById('tvGatherNewsStopBtn');
  const hint = document.getElementById('tvGatherNewsHint');
  if(btn){ btn.disabled = true; btn.textContent = 'Собираю…'; }
  if(stopBtn){ stopBtn.style.display = ''; stopBtn.disabled = false; }
  if(hint){ hint.textContent = 'Запускаю сбор…'; hint.style.color = ''; }
  tvRenderGatherConsole([]);
  tvGatherJobId = null; // set to the real server job id once /start responds, below
  try{
    const week = tvComputeTargetWeek();
    // Anything still just proposed (not included) from an earlier target week is stale —
    // move it to the archive instead of letting it pile up next to this week's picks.
    tvState.tvNewsItems.forEach(n=>{
      if(!n.included && !n.archived && n.gatheredForWeek && n.gatheredForWeek!==week.start){
        n.archived = true;
        n.archivedAt = Date.now();
      }
    });
    const startRes = await fetch('/api/tv/gather-news/start', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ weekStart: week.start, weekEnd: week.end, sources: tvState.tvNewsSourceSelection }),
    });
    const startData = await startRes.json().catch(()=> null);
    if(!startRes.ok || !startData || !startData.jobId){
      const detail = startData && startData.message ? startData.message : (startRes.ok ? 'сервер вернул неожиданный ответ' : 'сервер не вернул текст ошибки');
      throw new Error('Не удалось запустить сбор (HTTP ' + startRes.status + '): ' + detail);
    }
    const jobId = startData.jobId;
    tvGatherJobId = jobId; // real id now — this is what Стоп's cancel request uses

    const statusData = await new Promise((resolve, reject)=>{
      const poll = async ()=>{
        if(tvGatherJobId !== jobId) return; // a newer run superseded this one
        try{
          const statusRes = await fetch('/api/tv/gather-news/status/' + jobId);
          const sd = await statusRes.json().catch(()=> null);
          if(!statusRes.ok || !sd){
            reject(new Error('Не удалось получить статус сбора (HTTP ' + statusRes.status + ').'));
            return;
          }
          tvRenderGatherConsole(sd.log);
          if(sd.status==='running'){ tvGatherPollTimer = setTimeout(poll, 700); return; }
          resolve(sd);
        } catch(err){ reject(err); }
      };
      poll();
    });
    if(tvGatherJobId !== jobId) return; // superseded while the last poll was in flight

    if(statusData.status==='cancelled'){
      if(hint){ hint.textContent = 'Остановлено пользователем.'; hint.style.color = 'var(--warn)'; }
      return;
    }
    const data = statusData.result;
    if(statusData.status!=='done' || !data || !Array.isArray(data.items)){
      const detail = (data && data.sourceErrors && data.sourceErrors.general) || 'сбор завершился без результата';
      throw new Error('Не удалось собрать новости: ' + detail);
    }

    // Dedup against whatever's still active (not archived) — re-running the gather for
    // the same week shouldn't duplicate what's already there. Must combine sourceUrl AND
    // title, not sourceUrl alone: Компьютерра's sourceUrl is a per-DAY archive index page,
    // shared by every distinct story pulled from that day — keying on sourceUrl alone made
    // the 2nd+ real story from the same day collide with the 1st and get silently dropped
    // as a "duplicate" even though it was a genuinely different item (this is why "гораздо
    // больше новостей на Компьютерре, чем добавилось в Предложено").
    const dedupKey = (n)=> (n.sourceUrl||'') + '||' + (n.title||'').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
    const existingKeys = new Set(tvState.tvNewsItems.filter(n=> !n.archived).map(dedupKey));
    let addedCount = 0, skippedCount = 0;
    data.items.forEach(item=>{
      const key = dedupKey(item);
      if(existingKeys.has(key)){ skippedCount++; return; }
      existingKeys.add(key);
      addedCount++;
      tvState.tvNewsItems.push({
        id: tvNewsItemSeq++,
        rubric: item.rubric,
        title: item.title,
        summary: item.summary,
        extract: item.extract || '',
        sourceDate: item.sourceDate || null,
        sourceUrl: item.sourceUrl || null,
        source: item.source, // 'wayback' | 'wikipedia'
        sourcePrecision: item.sourcePrecision, // 'week' | 'year'
        media: Array.isArray(item.media) ? item.media : [],
        materialStatus: 'мало материала',
        isAnniversary: false,
        included: false,
        archived: false,
        archivedAt: null,
        gatheredForWeek: week.start,
        assignedAnchorId: null,
        approvedForRelease: false,
        sortOrder: 0,
      });
    });
    renderTvNewsPickers();
    renderTvNewsSubTabs();
    tvSaveSoon();
    // Honesty about rubric coverage, per Костян's requirement: say plainly which rubrics
    // needed the month-wide fallback (real items, just not week-precise) and which came
    // back with nothing at all even after widening — never silently leave a gap unexplained.
    const coverageNotes = [];
    if(Array.isArray(data.filledFromFallback) && data.filledFromFallback.length){
      coverageNotes.push('за месяц вместо недели: ' + data.filledFromFallback.map(tvRubricLabel).join(', '));
    }
    if(Array.isArray(data.emptyRubrics) && data.emptyRubrics.length){
      // "даже за месяц" is only true if the month-wide retry actually ran — with the
      // checkbox off (the default, see tvNewsSourceSelection), the server never attempted
      // it at all, so saying so would be a flat lie about what was actually tried.
      const label = tvState.tvNewsSourceSelection.monthFallback ? 'совсем ничего не нашлось (даже за месяц)' : 'ничего не нашлось за эту неделю';
      coverageNotes.push(label + ': ' + data.emptyRubrics.map(tvRubricLabel).join(', '));
    }
    // Surface each source's REAL failure reason (Gemini quota/rate-limit, safety block,
    // network error...) instead of letting it look identical to "genuinely found nothing" —
    // this is exactly the ambiguity that made "может у нас лимиты на gemini?" unanswerable
    // from the screen alone.
    const TV_SOURCE_NAMES = { wayback:'Wayback Machine', wikipedia:'Wikipedia', computerra:'Компьютерра', gemini:'Обработка (Gemini)', monthFallback:'Расширение до месяца' };
    const errorNotes = data.sourceErrors && typeof data.sourceErrors==='object'
      ? Object.keys(data.sourceErrors).map(k=> (TV_SOURCE_NAMES[k]||k) + ': ' + data.sourceErrors[k])
      : [];
    const baseText = data.items.length
      ? 'Добавлено: ' + addedCount + (skippedCount ? ', уже было: ' + skippedCount : '') + ' (реальные источники — проверьте ссылки)'
      : 'За эту неделю ничего не нашлось в реальных источниках. Попробуйте ещё раз позже, или добавьте новость вручную.';
    let fullText = coverageNotes.length ? baseText + '. ' + coverageNotes.join('; ') + '.' : baseText;
    if(errorNotes.length) fullText += ' Ошибки источников — ' + errorNotes.join('; ') + '.';
    hint.textContent = fullText;
    if(errorNotes.length) hint.style.color = 'var(--danger)';
    else if(coverageNotes.length) hint.style.color = 'var(--warn)';
  } catch(err){
    if(hint){ hint.textContent = err.message; hint.style.color = 'var(--danger)'; }
  } finally {
    if(tvGatherPollTimer){ clearTimeout(tvGatherPollTimer); tvGatherPollTimer = null; }
    tvGatherJobId = null;
    if(btn){ btn.disabled = false; btn.textContent = 'Собрать новости'; }
    if(stopBtn){ stopBtn.style.display = 'none'; stopBtn.disabled = true; }
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
  const addStudioBtn = document.getElementById('tvAddStudioBtn');
  if(addStudioBtn) addStudioBtn.onclick = ()=> tvOpenStudioForm(null);
  const modalBackdrop = document.getElementById('tvAnchorModalBackdrop');
  if(modalBackdrop) modalBackdrop.onclick = tvCloseModal;
  const lightboxBackdrop = document.getElementById('tvLightboxBackdrop');
  if(lightboxBackdrop) lightboxBackdrop.onclick = tvCloseLightbox;
  const folderBtn = document.getElementById('tvConnectFolderBtn');
  if(folderBtn) folderBtn.onclick = tvHandleFolderButtonClick;
  const gatherNewsBtn = document.getElementById('tvGatherNewsBtn');
  if(gatherNewsBtn) gatherNewsBtn.onclick = tvGatherNews;
  const gatherNewsStopBtn = document.getElementById('tvGatherNewsStopBtn');
  if(gatherNewsStopBtn) gatherNewsStopBtn.onclick = tvStopGatherNews;
  const addManualNewsBtn = document.getElementById('tvAddManualNewsBtn');
  if(addManualNewsBtn) addManualNewsBtn.onclick = ()=> tvOpenManualNewsForm();
  const clearProposedNewsBtn = document.getElementById('tvClearProposedNewsBtn');
  if(clearProposedNewsBtn) clearProposedNewsBtn.onclick = tvClearProposedNews;
  const autoPopulateGridBtn = document.getElementById('tvAutoPopulateGridBtn');
  if(autoPopulateGridBtn) autoPopulateGridBtn.onclick = tvAutoPopulateGrid;
  const sendToWritingBtn = document.getElementById('tvSendToWritingBtn');
  if(sendToWritingBtn) sendToWritingBtn.onclick = tvSendToWriting;
  document.querySelectorAll('#tvNewsSubTabs .tv-subtab').forEach(tab=>{
    tab.onclick = ()=> tvSwitchNewsSubTab(tab.dataset.subtab);
  });
  const bulkIncludeBtn = document.getElementById('tvNewsBulkIncludeBtn');
  if(bulkIncludeBtn) bulkIncludeBtn.onclick = ()=> tvBulkMoveSelectedNews('included');
  const bulkArchiveBtn = document.getElementById('tvNewsBulkArchiveBtn');
  if(bulkArchiveBtn) bulkArchiveBtn.onclick = ()=> tvBulkMoveSelectedNews('archived');
}

(async function(){
  wireTvPageTabs();
  showTvPage('work');
  tvWireCreditsIndicator();
  await Promise.all([tvLoadModelList(), tvLoadTaskModelLists(), tvLoadWorkspace()]);
  tvStartAutosave();
  tvPruneOldArchive();
  renderTvAnchors();
  renderTvStudios();
  renderTvNewsPickers();
  renderTvRedaktsiya();
  renderTvMic();
  renderTvTasks();
  renderTvGrid();
})();
