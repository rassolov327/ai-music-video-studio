// ---------- Script Breakdown (standalone /script tool) ----------
// Entirely separate from the main take:one app — no state.js, no persistence.js, no shared
// globals. It shares the login/session system with take:one (same /api/me, /api/login,
// /api/logout, /api/my-balance) and the styles.css theme. Scripts themselves are stored in
// Postgres (script_documents, scoped by user_id) so a user's scripts follow them across
// devices — the one place in this app where real user content lives server-side.

let sbModels = [];
let sbDocsList = [];       // [{id,title,updatedAt,sceneCount}] — sorted newest first
let sbCurrentDoc = null;   // { id, title, rawText, structuredHtml, model, scenes }
let sbSelectedItem = null; // {type:'character'|'location'|'prop'|'weapon'|'vehicle'|'timeOfDay', name} or {type:'scene', sceneIdx}
let sbSaveTimer = null;
let sbAnalyzeCooldownUntil = 0;
let sbCollapsedCats = new Set(); // category keys collapsed in the tree

function sbPencilSvg(size) {
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4Z"></path></svg>`;
}
function sbTrashSvg(size) {
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"></path><path d="M10 11v6"></path><path d="M14 11v6"></path></svg>`;
}
function sbEscapeHtml(s) {
  return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ---------- server-backed document storage (Postgres, scoped to the logged-in user) ----------
async function sbLoadAllDocs() {
  const res = await fetch('/api/script-breakdown/documents');
  if (!res.ok) return [];
  const data = await res.json().catch(() => null);
  return (data && data.documents) || [];
}
async function sbGetDoc(id) {
  const res = await fetch('/api/script-breakdown/documents/' + encodeURIComponent(id));
  if (!res.ok) return null;
  const data = await res.json().catch(() => null);
  return (data && data.document) || null;
}
async function sbSaveDoc(doc) {
  const res = await fetch('/api/script-breakdown/documents/' + encodeURIComponent(doc.id), {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(doc),
  });
  if (!res.ok) throw new Error('Could not save this script.');
}
async function sbDeleteDoc(id) {
  await fetch('/api/script-breakdown/documents/' + encodeURIComponent(id), { method: 'DELETE' });
}

// ---------- auth gate ----------
(async function () {
  function showLogin() {
    document.getElementById('sbLoginScreen').classList.remove('hidden');
    document.getElementById('sbHomeScreen').classList.add('hidden');
    document.getElementById('app').classList.add('hidden');
  }
  async function enterHome() {
    document.getElementById('sbLoginScreen').classList.add('hidden');
    document.getElementById('app').classList.add('hidden');
    document.getElementById('sbHomeScreen').classList.remove('hidden');
    if (!window.__sbInited) { window.__sbInited = true; await initSbApp(); }
    else await showSbHome();
  }
  async function tryEnter() {
    let res;
    try { res = await fetch('/api/me'); } catch (err) { showLogin(); return; }
    if (!res.ok) { showLogin(); return; }
    await enterHome();
  }
  document.getElementById('sbLoginSubmitBtn').onclick = async () => {
    const errHint = document.getElementById('sbLoginErrorHint');
    errHint.style.display = 'none';
    const login = document.getElementById('sbLoginInput').value.trim();
    const password = document.getElementById('sbPasswordInput').value;
    if (!login || !password) return;
    try {
      const res = await fetch('/api/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ login, password }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        errHint.textContent = (data && data.message) || 'Could not sign in.';
        errHint.style.display = '';
        return;
      }
      tryEnter();
    } catch (err) {
      errHint.textContent = 'Could not reach the server.';
      errHint.style.display = '';
    }
  };
  document.getElementById('sbPasswordInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') document.getElementById('sbLoginSubmitBtn').click();
  });
  document.getElementById('sbHomeLogoutBtn').onclick = async () => {
    try { await fetch('/api/logout', { method: 'POST' }); } catch (err) {}
    location.reload();
  };
  tryEnter();
})();

// ---------- bootstrap ----------
async function initSbApp() {
  wireSbTabs();
  wireSbMobileNav();
  wireSbUpload();
  wireSbTextInput();
  wireSbTreeCollapse();
  document.getElementById('sbAnalyzeBtn').onclick = onSbAnalyzeBtnClick;
  document.getElementById('sbClearBtn').onclick = clearSbScript;
  document.getElementById('sbModelSelect').onchange = updateSbCostHint;
  document.getElementById('sbBackHomeBtn').onclick = showSbHome;
  document.getElementById('sbHomeNewBtn').onclick = () => { newSbDoc(); openSbTool(); };
  document.getElementById('sbExportPdfBtn').onclick = exportSbSummaryToPdf;
  document.getElementById('sbSheetBackdrop').onclick = closeAllSbSheets;
  wireSbAnalyzeModal();
  document.getElementById('sbAnalyzeBtnMobile').onclick = () => { closeAllSbSheets(); openSbAnalyzeModal(); };
  wireSbSettingsSheet();
  wireSbSearch();
  sbLoadTheme();

  await loadSbModels();
  wireCreditsIndicator();
  await showSbHome();
}

async function loadSbModels() {
  try {
    const res = await fetch('/api/script-breakdown/models');
    const data = await res.json();
    sbModels = (data && data.models) || [];
  } catch (err) {
    sbModels = [{ id: 'gemini', label: 'Gemini (бесплатно)', free: true }];
  }
  const optionsHtml = sbModels.map(m => `<option value="${m.id}">${sbEscapeHtml(m.label)}</option>`).join('');
  document.getElementById('sbModelSelect').innerHTML = optionsHtml;
  document.getElementById('sbAnalyzeModalModelSelect').innerHTML = optionsHtml;
}

// ---------- home screen (per-user script list — take:one's project picker, same idea) ----------
async function showSbHome() {
  document.getElementById('app').classList.add('hidden');
  document.getElementById('sbHomeScreen').classList.remove('hidden');
  await renderSbHomeList();
}
function openSbTool() {
  document.getElementById('sbHomeScreen').classList.add('hidden');
  document.getElementById('app').classList.remove('hidden');
}
async function renderSbHomeList() {
  const list = document.getElementById('sbHomeList');
  sbDocsList = await sbLoadAllDocs();
  if (!sbDocsList.length) {
    list.innerHTML = `<div class="home-empty">Пока нет ни одного сценария — создайте первый.</div>`;
    return;
  }
  list.innerHTML = sbDocsList.map(d => {
    const dateStr = d.updatedAt ? new Date(d.updatedAt).toLocaleDateString() : '';
    return `
      <div class="proj-card" data-id="${d.id}">
        <div class="proj-card-thumb"><i class="ti ti-file-text" style="font-size:22px;color:var(--text-2);"></i></div>
        <div class="proj-card-body">
          <div class="proj-card-name">${sbEscapeHtml(d.title || 'Untitled')}</div>
          <div class="proj-card-meta">${d.sceneCount ? d.sceneCount + ' сцен(а)' : 'ещё не разобран'}</div>
          <div class="proj-card-date">${dateStr ? 'Изменён ' + dateStr : ''}</div>
        </div>
        <div class="proj-card-actions">
          <span class="proj-card-btn" data-action="rename" title="Rename">${sbPencilSvg(13)}</span>
          <span class="proj-card-btn" data-action="delete" title="Delete">${sbTrashSvg(13)}</span>
        </div>
      </div>`;
  }).join('');

  list.querySelectorAll('.proj-card').forEach(card => {
    const id = card.dataset.id;
    card.onclick = (e) => {
      if (e.target.closest('.proj-card-btn')) return;
      openSbDoc(id).then(openSbTool);
    };
    card.querySelector('[data-action="rename"]').onclick = async (e) => {
      e.stopPropagation();
      const current = card.querySelector('.proj-card-name').textContent;
      const title = prompt('Название сценария:', current);
      if (title === null) return;
      const doc = await sbGetDoc(id);
      if (!doc) return;
      doc.title = title.trim() || 'Untitled script';
      await sbSaveDoc(doc);
      renderSbHomeList();
    };
    card.querySelector('[data-action="delete"]').onclick = async (e) => {
      e.stopPropagation();
      const current = card.querySelector('.proj-card-name').textContent;
      if (!confirm(`Удалить сценарий "${current}" безвозвратно?`)) return;
      await sbDeleteDoc(id);
      if (sbCurrentDoc && sbCurrentDoc.id === id) sbCurrentDoc = null;
      renderSbHomeList();
    };
  });
}

// ---------- document management ----------
function sbNewDocObject() {
  return {
    id: 'sb' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
    title: 'Untitled script', rawText: '', structuredHtml: null, model: 'gemini', scenes: null,
  };
}
function newSbDoc() {
  sbCurrentDoc = sbNewDocObject();
  sbSelectedItem = null;
  sbCollapsedCats = new Set();
  renderSbAll();
  sbSaveDocNow();
}
async function openSbDoc(id) {
  const doc = await sbGetDoc(id);
  if (!doc) { newSbDoc(); return; }
  sbCurrentDoc = doc;
  sbSelectedItem = null;
  // Every category starts collapsed — a fresh script shouldn't dump its whole cast/prop
  // list open before the user has asked to see any of it.
  sbCollapsedCats = new Set(['character', 'location', 'prop', 'weapon', 'vehicle', 'timeOfDay', 'scene']);
  renderSbAll();
}
function sbSaveSoon() {
  clearTimeout(sbSaveTimer);
  sbSaveTimer = setTimeout(sbSaveDocNow, 800);
}
async function sbSaveDocNow() {
  if (!sbCurrentDoc) return;
  setSbSaveStatus('Saving…');
  try {
    await sbSaveDoc(sbCurrentDoc);
    setSbSaveStatus('Saved');
  } catch (err) {
    setSbSaveStatus('Error');
  }
}
function setSbSaveStatus(text) {
  const el = document.getElementById('sbSaveStatus');
  if (el) el.textContent = text;
}

// ---------- script text input (editable only while drafting — locked once scenes exist) ----------
function wireSbTextInput() {
  const el = document.getElementById('sbTextInput');
  el.addEventListener('paste', (e) => {
    e.preventDefault();
    const text = (e.clipboardData || window.clipboardData).getData('text/plain');
    document.execCommand('insertText', false, text);
  });
  el.addEventListener('input', () => {
    if (sbCurrentDoc.scenes) return; // locked — shouldn't fire, but never trust contenteditable=false alone
    sbCurrentDoc.rawText = el.innerText;
    updateSbCostHint();
    sbSaveSoon();
  });
}
function clearSbScript() {
  if (!sbCurrentDoc) return;
  if (((sbCurrentDoc.rawText || '').trim() || sbCurrentDoc.scenes) && !confirm('Очистить текст и разбор? Это затронет только этот документ.')) return;
  sbCurrentDoc.rawText = '';
  sbCurrentDoc.structuredHtml = null;
  sbCurrentDoc.scenes = null;
  sbSelectedItem = null;
  renderSbAll();
  sbSaveDocNow();
}

// ---------- file upload (PDF / DOCX / TXT) ----------
// Two trigger buttons share one hidden file input: the inline one (desktop) and the one
// inside the mobile settings sheet (where it relocates to on narrow screens).
function wireSbUpload() {
  const input = document.getElementById('sbFileInput');
  const btn = document.getElementById('sbUploadBtn');
  const mobileBtn = document.getElementById('sbUploadBtnMobile');
  btn.onclick = () => input.click();
  mobileBtn.onclick = () => { closeAllSbSheets(); input.click(); };
  input.onchange = async () => {
    const file = input.files[0];
    input.value = '';
    if (!file) return;
    const ext = file.name.toLowerCase().split('.').pop();
    if (!['pdf', 'docx', 'txt'].includes(ext)) { alert('Поддерживаются только PDF, DOCX и TXT.'); return; }
    const originalLabel = btn.textContent;
    [btn, mobileBtn].forEach(b => { b.disabled = true; b.textContent = 'Загрузка…'; });
    try {
      const dataUrl = await sbFileToDataUrl(file);
      const res = await fetch('/api/script-breakdown/extract-text', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dataUrl, filename: file.name }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data || typeof data.text !== 'string') throw new Error((data && data.message) || 'Не удалось прочитать файл.');
      sbCurrentDoc.rawText = data.text;
      sbCurrentDoc.structuredHtml = data.structuredHtml || null;
      document.getElementById('sbTextInput').innerText = data.text;
      if (!sbCurrentDoc.title || sbCurrentDoc.title === 'Untitled script') {
        sbCurrentDoc.title = file.name.replace(/\.[^.]+$/, '');
        document.getElementById('sbAppTitle').textContent = sbCurrentDoc.title;
      }
      updateSbCostHint();
      sbSaveDocNow();
    } catch (err) {
      alert('Ошибка: ' + err.message);
    } finally {
      [btn, mobileBtn].forEach(b => { b.disabled = false; b.textContent = originalLabel; });
    }
  };
}
function sbFileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

// ---------- cost estimate (mirrors the server's rough estimate — no network round-trip
// needed just to update a label on every keystroke) ----------
function sbCostHintText(modelId) {
  const modelDef = sbModels.find(m => m.id === modelId);
  if (!modelDef || modelDef.free) return 'Бесплатно';
  const text = sbCurrentDoc ? (sbCurrentDoc.rawText || '') : '';
  if (!text) return '';
  const inputTok = Math.ceil(text.length / 3) + 400;
  const outputTok = Math.ceil((text.length / 3) * 0.7) + 1500;
  const credits = (inputTok / 1e6) * modelDef.inputCreditsPerM + (outputTok / 1e6) * modelDef.outputCreditsPerM;
  return '≈ ' + Math.ceil(credits) + ' кр KIE';
}
function updateSbCostHint() {
  const hintEl = document.getElementById('sbCostHint');
  const sel = document.getElementById('sbModelSelect');
  if (!hintEl || !sel) return;
  hintEl.textContent = sbCostHintText(sel.value);
}

// ---------- Analyze ----------
// On mobile there's no room for an inline model select, so Analyze opens a small confirm
// modal instead; on desktop the inline select next to the button is already the picker, so
// the button just runs the analysis directly, same as before.
function onSbAnalyzeBtnClick() {
  if (window.matchMedia('(max-width:760px)').matches) openSbAnalyzeModal();
  else runSbAnalysis();
}
function wireSbAnalyzeModal() {
  const modal = document.getElementById('sbAnalyzeModal');
  document.getElementById('sbAnalyzeModalCloseBtn').onclick = closeSbAnalyzeModal;
  modal.onclick = (e) => { if (e.target === modal) closeSbAnalyzeModal(); };
  document.getElementById('sbAnalyzeModalModelSelect').onchange = updateSbAnalyzeModalCostHint;
  document.getElementById('sbAnalyzeModalConfirmBtn').onclick = () => {
    document.getElementById('sbModelSelect').value = document.getElementById('sbAnalyzeModalModelSelect').value;
    updateSbCostHint();
    closeSbAnalyzeModal();
    runSbAnalysis();
  };
}
function updateSbAnalyzeModalCostHint() {
  const sel = document.getElementById('sbAnalyzeModalModelSelect');
  document.getElementById('sbAnalyzeModalCostHint').textContent = sbCostHintText(sel.value);
}
function openSbAnalyzeModal() {
  const modalSel = document.getElementById('sbAnalyzeModalModelSelect');
  modalSel.value = document.getElementById('sbModelSelect').value;
  updateSbAnalyzeModalCostHint();
  document.getElementById('sbAnalyzeModal').classList.remove('hidden');
}
function closeSbAnalyzeModal() {
  document.getElementById('sbAnalyzeModal').classList.add('hidden');
}
async function runSbAnalysis() {
  if (!sbCurrentDoc) return;
  const text = (sbCurrentDoc.scenes ? sbCurrentDoc.rawText : (document.getElementById('sbTextInput').innerText || '')).trim();
  if (!text) { alert('Вставьте или загрузите сценарий сначала.'); return; }
  if (Date.now() < sbAnalyzeCooldownUntil) { alert('Подождите пару секунд перед повторным анализом.'); return; }
  const btn = document.getElementById('sbAnalyzeBtn');
  btn.disabled = true; btn.textContent = 'Анализ…';
  try {
    const modelId = document.getElementById('sbModelSelect').value;
    const res = await fetch('/api/script-breakdown/analyze', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scriptText: text, model: modelId }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data || !Array.isArray(data.scenes)) throw new Error((data && data.message) || 'Не удалось разобрать сценарий.');
    sbCurrentDoc.rawText = text;
    sbCurrentDoc.model = modelId;
    sbCurrentDoc.scenes = data.scenes;
    sbSelectedItem = null;
    sbCollapsedCats = new Set(['character', 'location', 'prop', 'weapon', 'vehicle', 'timeOfDay', 'scene']);
    renderSbAll();
    sbSaveDocNow();
    sbAnalyzeCooldownUntil = Date.now() + 4000;
    refreshCredits();
  } catch (err) {
    alert('Ошибка анализа: ' + err.message);
  } finally {
    btn.disabled = false; btn.textContent = 'Analyze';
  }
}

// ---------- screenplay text rendering ----------
// Read-only, locked once a script has been analyzed — editing afterward could silently break
// scene navigation (headings are matched against this text) and undermine the whole point of
// a formatted, non-editable "document" view.
function sbSetTextLocked(locked) {
  const el = document.getElementById('sbTextInput');
  el.contentEditable = locked ? 'false' : 'true';
}
// Heuristic classifier for text with no known structure (PDF, TXT, pasted text, or a DOCX
// that didn't use recognized screenplay styles). Splits on blank lines, then guesses each
// block's role the way most screenplay parsers do: a short all-caps line is a character
// cue, "(...)"-wrapped is a parenthetical, INT./EXT./scene-number lines are headings, and
// everything else is either dialogue (if it follows a cue) or action.
function sbClassifyScriptText(text) {
  const blocks = (text || '').split(/\n\s*\n+/).map(b => b.trim()).filter(Boolean);
  const out = [];
  let prevType = null;
  for (const block of blocks) {
    const singleLine = !block.includes('\n');
    const hasLetters = /[a-zA-Zа-яА-ЯёЁ]/.test(block);
    const isAllCaps = hasLetters && block === block.toUpperCase();
    const isHeading = /^(\d+[-.]?\d*\.?\s*)?(ИНТ|НАТ|INT|EXT)[.\s]/i.test(block);
    const isParenthetical = /^\(.*\)$/.test(block);
    let type;
    if (isHeading) type = 'heading';
    else if (isParenthetical) type = 'paren';
    else if (singleLine && isAllCaps && block.length <= 40) type = 'character';
    else if (prevType === 'character' || prevType === 'paren') type = 'dialogue';
    else type = 'action';
    out.push({ type, text: block });
    prevType = type;
  }
  return out;
}
function sbRenderClassifiedHtml(text) {
  const classFor = { heading: 'scr-heading', character: 'scr-character', dialogue: 'scr-dialogue', action: 'scr-action', paren: 'scr-paren' };
  return sbClassifyScriptText(text).map(b => `<p class="${classFor[b.type]}">${sbEscapeHtml(b.text).replace(/\n/g, '<br>')}</p>`).join('');
}
function sbRenderScriptText() {
  const el = document.getElementById('sbTextInput');
  const locked = !!(sbCurrentDoc && sbCurrentDoc.scenes);
  sbSetTextLocked(locked);
  if (!locked) {
    if (document.activeElement !== el && el.innerText !== (sbCurrentDoc.rawText || '')) {
      el.innerText = sbCurrentDoc.rawText || '';
    }
    return;
  }
  el.innerHTML = sbCurrentDoc.structuredHtml || sbRenderClassifiedHtml(sbCurrentDoc.rawText);
}

// ---------- aggregation (the asset tree is always DERIVED from the per-scene tags the
// model returned — never a separate top-level list — so it can never drift out of sync
// with what each scene actually says, and it keeps the model's JSON output smaller) ----------
function sbAggregateArrayField(scenes, field) {
  const map = new Map();
  scenes.forEach((sc, idx) => {
    (sc[field] || []).forEach(raw => {
      const key = (raw || '').trim();
      if (!key) return;
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(idx);
    });
  });
  return Array.from(map.entries()).map(([name, sceneIdxs]) => ({ name, sceneIdxs }));
}
function sbAggregateSingularField(scenes, field) {
  const map = new Map();
  scenes.forEach((sc, idx) => {
    const key = (sc[field] || '').trim();
    if (!key) return;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(idx);
  });
  return Array.from(map.entries()).map(([name, sceneIdxs]) => ({ name, sceneIdxs }));
}
function sbAggregateTimeOfDay(scenes) {
  const order = ['Утро', 'День', 'Вечер', 'Ночь', 'Не указано'];
  const map = new Map();
  scenes.forEach((sc, idx) => {
    const key = sc.timeOfDay || 'Не указано';
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(idx);
  });
  return order.filter(k => map.has(k)).map(k => ({ name: k, sceneIdxs: map.get(k) }));
}

// ---------- tree (collapsible categories, chevron matches the main app's asset panel) ----------
function wireSbTreeCollapse() {
  document.getElementById('sbTree').addEventListener('click', (e) => {
    const head = e.target.closest('.sb-cat-head');
    if (!head) return;
    const key = head.dataset.catKey;
    if (sbCollapsedCats.has(key)) sbCollapsedCats.delete(key);
    else sbCollapsedCats.add(key);
    head.classList.toggle('collapsed');
    const items = head.nextElementSibling;
    if (items) items.classList.toggle('hidden');
  });
}
function renderSbTree() {
  const tree = document.getElementById('sbTree');
  const scenes = sbCurrentDoc && sbCurrentDoc.scenes;
  if (!scenes || !scenes.length) {
    tree.innerHTML = `<div class="gen-hint" style="padding:14px;">Вставьте сценарий слева и нажмите Analyze — разбор появится здесь.</div>`;
    return;
  }
  const chev = `<svg class="chev" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>`;
  function catBlock(key, title, list, type) {
    if (!list.length) return '';
    const collapsed = sbCollapsedCats.has(key);
    const rows = list.map(it => `
      <div class="script-tree-item${sbSelectedItem && sbSelectedItem.type === type && sbSelectedItem.name === it.name ? ' active' : ''}" data-cat-type="${type}" data-cat-name="${sbEscapeHtml(it.name)}">
        <span>${sbEscapeHtml(it.name)}</span>
        <span class="sb-scene-count">${it.sceneIdxs.length}</span>
      </div>`).join('');
    return `<div class="sb-cat-head${collapsed ? ' collapsed' : ''}" data-cat-key="${key}">${chev}<span class="sb-cat-name">${title}</span><span class="sb-scene-count">${list.length}</span></div>` +
      `<div class="sb-cat-items${collapsed ? ' hidden' : ''}">${rows}</div>`;
  }
  let html = '';
  html += catBlock('character', 'Персонажи', sbAggregateArrayField(scenes, 'characters'), 'character');
  html += catBlock('location', 'Локации', sbAggregateSingularField(scenes, 'location'), 'location');
  html += catBlock('prop', 'Реквизит', sbAggregateArrayField(scenes, 'props'), 'prop');
  html += catBlock('weapon', 'Оружие', sbAggregateArrayField(scenes, 'weapons'), 'weapon');
  html += catBlock('vehicle', 'Транспорт', sbAggregateArrayField(scenes, 'vehicles'), 'vehicle');
  html += catBlock('timeOfDay', 'Режим', sbAggregateTimeOfDay(scenes), 'timeOfDay');

  const scenesCollapsed = sbCollapsedCats.has('scene');
  const sceneRows = scenes.map((sc, idx) => `
    <div class="script-tree-item${sbSelectedItem && sbSelectedItem.type === 'scene' && sbSelectedItem.sceneIdx === idx ? ' active' : ''}" data-scene-idx="${idx}">
      <span>${idx + 1}. ${sbEscapeHtml(sc.title || '')}</span>
    </div>`).join('');
  html += `<div class="sb-cat-head${scenesCollapsed ? ' collapsed' : ''}" data-cat-key="scene">${chev}<span class="sb-cat-name">Сцены</span><span class="sb-scene-count">${scenes.length}</span></div>` +
    `<div class="sb-cat-items${scenesCollapsed ? ' hidden' : ''}">${sceneRows}</div>`;

  tree.innerHTML = html;

  tree.querySelectorAll('[data-cat-type]').forEach(el => {
    el.onclick = () => selectSbCategoryItem(el.dataset.catType, el.dataset.catName);
  });
  tree.querySelectorAll('[data-scene-idx]').forEach(el => {
    el.onclick = () => selectSbScene(Number(el.dataset.sceneIdx));
  });
}

function selectSbCategoryItem(type, name) {
  sbSelectedItem = { type, name };
  renderSbTree();
  renderSbInspectorForCategory(type, name);
  openSbSheet();
}
function selectSbScene(idx) {
  sbSelectedItem = { type: 'scene', sceneIdx: idx };
  renderSbTree();
  renderSbInspectorForScene(idx);
  sbJumpToScene(idx);
  openSbSheet();
  if (window.matchMedia('(max-width:760px)').matches) switchSbMobilePane('text');
}

// Jump-to-scene only ever runs once a script is analyzed — the text is always in its locked,
// rendered (structured or heuristic) form at that point, so this looks for the DOM element
// whose text matches the scene's heading rather than searching raw characters.
function sbJumpToScene(idx) {
  const el = document.getElementById('sbTextInput');
  if (!el || !sbCurrentDoc) return;
  el.querySelectorAll('.sb-jump-highlight').forEach(n => n.classList.remove('sb-jump-highlight'));
  const scene = sbCurrentDoc.scenes[idx];
  const needle = scene && scene.headingText ? scene.headingText.trim() : '';
  if (!needle) return;
  const nodes = el.querySelectorAll('p, div');
  let target = null;
  for (const node of nodes) {
    const t = (node.textContent || '').trim();
    if (t && (t === needle || t.includes(needle) || needle.includes(t))) { target = node; break; }
  }
  if (!target) return;
  target.classList.add('sb-jump-highlight');
  target.scrollIntoView({ block: 'center', behavior: 'smooth' });
}

// ---------- inspector ----------
function sbInspectorShell(inner) {
  return `<div class="insp-tabs"><div class="insp-tab" style="cursor:default;">Inspector</div><span class="np-close sb-sheet-close" id="sbSheetCloseBtn" style="margin-left:auto;"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg></span></div>${inner}`;
}
function renderSbInspectorForCategory(type, name) {
  const insp = document.getElementById('sbInspector');
  const scenes = sbCurrentDoc.scenes;
  const idxs = [];
  scenes.forEach((sc, idx) => {
    let has = false;
    if (type === 'character') has = (sc.characters || []).includes(name);
    else if (type === 'location') has = sc.location === name;
    else if (type === 'prop') has = (sc.props || []).includes(name);
    else if (type === 'weapon') has = (sc.weapons || []).includes(name);
    else if (type === 'vehicle') has = (sc.vehicles || []).includes(name);
    else if (type === 'timeOfDay') has = (sc.timeOfDay || 'Не указано') === name;
    if (has) idxs.push(idx);
  });
  const listHtml = idxs.map(idx => `<div class="script-tree-item" data-jump-scene="${idx}"><span>${idx + 1}. ${sbEscapeHtml(scenes[idx].title || '')}</span></div>`).join('');
  insp.innerHTML = sbInspectorShell(`
    <div style="padding:14px;">
      <div style="font-size:13px;font-weight:600;color:var(--text-1);margin-bottom:4px;">${sbEscapeHtml(name)}</div>
      <div class="gen-hint" style="margin:0 0 10px;">Сцен: ${idxs.length} — кликните, чтобы перейти в тексте</div>
    </div>
    ${listHtml}`);
  wireSbInspectorShell();
  insp.querySelectorAll('[data-jump-scene]').forEach(el => {
    el.onclick = () => selectSbScene(Number(el.dataset.jumpScene));
  });
}
function renderSbInspectorForScene(idx) {
  const insp = document.getElementById('sbInspector');
  const sc = sbCurrentDoc.scenes[idx];
  if (!sc) return;
  const field = (label, list) => (list && list.length) ? `<div class="cf-field"><label>${label}</label><div class="gen-hint" style="margin:0;">${list.map(sbEscapeHtml).join(', ')}</div></div>` : '';
  insp.innerHTML = sbInspectorShell(`
    <div style="padding:14px;">
      <div class="sb-insp-scene-title" data-jump-self="${idx}" style="font-size:13px;font-weight:600;color:var(--text-1);margin-bottom:8px;" title="Перейти к этой сцене в тексте">${idx + 1}. ${sbEscapeHtml(sc.title || '')}</div>
      <div class="cf-field"><label>Локация</label><div class="gen-hint" style="margin:0;">${sbEscapeHtml(sc.location || '—')}</div></div>
      <div class="cf-field"><label>Время суток</label><div class="gen-hint" style="margin:0;">${sbEscapeHtml(sc.timeOfDay || '—')}</div></div>
      ${field('Персонажи', sc.characters)}
      ${field('Реквизит', sc.props)}
      ${field('Оружие', sc.weapons)}
      ${field('Транспорт', sc.vehicles)}
    </div>`);
  wireSbInspectorShell();
}
function renderSbInspectorEmpty() {
  document.getElementById('sbInspector').innerHTML = sbInspectorShell(`<div class="gen-hint" style="padding:14px;">Кликните на сцену или элемент слева, чтобы увидеть детали здесь.</div>`);
  wireSbInspectorShell();
}
function wireSbInspectorShell() {
  const closeBtn = document.getElementById('sbSheetCloseBtn');
  if (closeBtn) closeBtn.onclick = closeSbSheet;
  const jumpTitle = document.querySelector('.sb-insp-scene-title');
  if (jumpTitle) jumpTitle.onclick = () => sbGoToSceneInText(Number(jumpTitle.dataset.jumpSelf));
}
// Jumping to a scene from a link INSIDE the Inspector (as opposed to selecting the scene in
// the tree, which already jumps as part of selection) — re-runs the highlight/scroll and, on
// mobile, gets the sheet out of the way so the text is actually visible afterward.
function sbGoToSceneInText(idx) {
  sbJumpToScene(idx);
  if (window.matchMedia('(max-width:760px)').matches) {
    switchSbMobilePane('text');
    closeSbSheet();
  }
}

// ---------- mobile bottom sheets (Inspector + Settings share one backdrop; opening one
// closes the other, same as any bottom-sheet stack) ----------
function openSbSheet() {
  if (!window.matchMedia('(max-width:760px)').matches) return;
  closeSbSettingsSheet();
  document.getElementById('sbInspector').classList.add('sb-sheet-open');
  document.getElementById('sbSheetBackdrop').classList.add('show');
}
function closeSbSheet() {
  document.getElementById('sbInspector').classList.remove('sb-sheet-open');
  document.getElementById('sbSheetBackdrop').classList.remove('show');
}
function wireSbSettingsSheet() {
  document.getElementById('sbSettingsGearBtn').onclick = openSbSettingsSheet;
  document.getElementById('sbSettingsCloseBtn').onclick = closeSbSettingsSheet;
}
function openSbSettingsSheet() {
  closeSbSheet();
  document.getElementById('sbSettingsSheet').classList.add('sb-sheet-open');
  document.getElementById('sbSheetBackdrop').classList.add('show');
  refreshCredits();
}
function closeSbSettingsSheet() {
  document.getElementById('sbSettingsSheet').classList.remove('sb-sheet-open');
  document.getElementById('sbSheetBackdrop').classList.remove('show');
}
function closeAllSbSheets() {
  closeSbSheet();
  closeSbSettingsSheet();
}

// ---------- theme (mobile settings sheet only — a per-viewer preference, so localStorage
// is the right place for it rather than saving it onto the document) ----------
function sbApplyTheme(theme) {
  if (theme === 'light') document.documentElement.dataset.sbTheme = 'light';
  else delete document.documentElement.dataset.sbTheme;
  document.getElementById('sbThemeDarkBtn').classList.toggle('active', theme !== 'light');
  document.getElementById('sbThemeLightBtn').classList.toggle('active', theme === 'light');
  try { localStorage.setItem('sb_theme', theme); } catch (err) {}
}
function sbLoadTheme() {
  let saved = 'dark';
  try { saved = localStorage.getItem('sb_theme') || 'dark'; } catch (err) {}
  sbApplyTheme(saved);
  document.getElementById('sbThemeDarkBtn').onclick = () => sbApplyTheme('dark');
  document.getElementById('sbThemeLightBtn').onclick = () => sbApplyTheme('light');
}

// ---------- search-in-text (mobile settings sheet) ----------
// Works over the rendered <p class="scr-*"> elements, same as scene jump — meaning it only
// finds anything once a script is locked (analyzed). Searching the draft/editable text isn't
// really the point of "find in the script you're reading", so it's not supported there.
let sbSearchMatches = [];
let sbSearchIndex = -1;
function wireSbSearch() {
  const input = document.getElementById('sbSearchInput');
  input.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    if (input.value.trim() !== sbSearchQuery) sbRunSearch(input.value);
    else sbSearchNext();
  });
}
let sbSearchQuery = '';
function sbRunSearch(query) {
  sbSearchQuery = (query || '').trim();
  const hint = document.getElementById('sbSearchHint');
  document.querySelectorAll('.sb-jump-highlight').forEach(n => n.classList.remove('sb-jump-highlight'));
  sbSearchMatches = [];
  sbSearchIndex = -1;
  if (!sbSearchQuery) { hint.textContent = ''; return; }
  if (!sbCurrentDoc || !sbCurrentDoc.scenes) { hint.textContent = 'Сначала сделайте Analyze.'; return; }
  const needle = sbSearchQuery.toLowerCase();
  const nodes = document.getElementById('sbTextInput').querySelectorAll('p, div');
  sbSearchMatches = Array.from(nodes).filter(n => (n.textContent || '').toLowerCase().includes(needle));
  if (!sbSearchMatches.length) { hint.textContent = 'Ничего не найдено.'; return; }
  sbSearchIndex = 0;
  sbGoToSearchMatch();
}
function sbSearchNext() {
  if (!sbSearchMatches.length) return;
  sbSearchIndex = (sbSearchIndex + 1) % sbSearchMatches.length;
  sbGoToSearchMatch();
}
function sbGoToSearchMatch() {
  document.querySelectorAll('.sb-jump-highlight').forEach(n => n.classList.remove('sb-jump-highlight'));
  const node = sbSearchMatches[sbSearchIndex];
  if (!node) return;
  document.getElementById('sbSearchHint').textContent = `${sbSearchIndex + 1} из ${sbSearchMatches.length} — Enter для следующего`;
  node.classList.add('sb-jump-highlight');
  switchSbMobilePane('text');
  closeSbSettingsSheet();
  node.scrollIntoView({ block: 'center', behavior: 'smooth' });
}

// ---------- mobile sub-nav (Text / Assets, inside BREAKDOWN) ----------
function wireSbMobileNav() {
  document.querySelectorAll('.sb-subtab').forEach(tab => {
    tab.onclick = () => switchSbMobilePane(tab.dataset.pane);
  });
}
function switchSbMobilePane(pane) {
  document.querySelectorAll('.sb-subtab').forEach(t => t.classList.toggle('active', t.dataset.pane === pane));
  document.getElementById('sbBreakdownView').dataset.mobilePane = pane;
}

// ---------- summary tab ----------
function renderSbSummary() {
  const wrap = document.getElementById('sbSummaryContent');
  const badge = document.getElementById('sbSummaryBadge');
  const scenes = sbCurrentDoc && sbCurrentDoc.scenes;
  if (!scenes || !scenes.length) {
    wrap.innerHTML = `<div class="sb-empty">Сначала сделайте Analyze во вкладке BREAKDOWN.</div>`;
    badge.style.display = 'none';
    return;
  }
  badge.style.display = '';
  badge.textContent = scenes.length;
  wrap.innerHTML = scenes.map((sc, idx) => `
    <div class="sb-summary-scene">
      <h3 data-scene-idx="${idx}">${idx + 1}. ${sbEscapeHtml(sc.title || '')}</h3>
      <div class="sb-summary-meta">
        <span>${sbEscapeHtml(sc.location || '—')}</span>
        <span>${sbEscapeHtml(sc.timeOfDay || '—')}</span>
        ${sc.characters && sc.characters.length ? `<span>${sc.characters.map(sbEscapeHtml).join(', ')}</span>` : ''}
      </div>
      <div class="sb-summary-text">${sbEscapeHtml(sc.condensedText || '')}</div>
    </div>`).join('');
  wrap.querySelectorAll('[data-scene-idx]').forEach(el => {
    el.onclick = () => {
      switchSbView('breakdown');
      selectSbScene(Number(el.dataset.sceneIdx));
    };
  });
}

// ---------- PDF export (pdfmake, lazy-loaded — its default Roboto font covers Cyrillic out
// of the box, so this produces a real, selectable-text PDF via a normal "Save File" prompt,
// no print dialog involved) ----------
let sbPdfMakeLoading = null;
function sbLoadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error('Could not load ' + src));
    document.head.appendChild(s);
  });
}
async function ensurePdfMakeLoaded() {
  if (window.pdfMake && window.pdfMake.vfs) return window.pdfMake;
  if (!sbPdfMakeLoading) {
    sbPdfMakeLoading = (async () => {
      await sbLoadScript('https://cdnjs.cloudflare.com/ajax/libs/pdfmake/0.2.10/pdfmake.min.js');
      await sbLoadScript('https://cdnjs.cloudflare.com/ajax/libs/pdfmake/0.2.10/vfs_fonts.js');
      return window.pdfMake;
    })();
  }
  return sbPdfMakeLoading;
}
async function exportSbSummaryToPdf() {
  const scenes = sbCurrentDoc && sbCurrentDoc.scenes;
  if (!scenes || !scenes.length) { alert('Сначала сделайте Analyze.'); return; }
  const btn = document.getElementById('sbExportPdfBtn');
  const originalLabel = btn.textContent;
  btn.disabled = true; btn.textContent = 'Готовим PDF…';
  try {
    const pdfMake = await ensurePdfMakeLoaded();
    const content = [
      { text: sbCurrentDoc.title || 'Script Breakdown', fontSize: 16, bold: true, margin: [0, 0, 0, 14] },
    ];
    scenes.forEach((sc, idx) => {
      const metaParts = [sc.location || '—', sc.timeOfDay || '—'];
      if (sc.characters && sc.characters.length) metaParts.push(sc.characters.join(', '));
      content.push({ text: `${idx + 1}. ${sc.title || ''}`, fontSize: 13, bold: true, margin: [0, idx ? 14 : 0, 0, 3] });
      content.push({ text: metaParts.join('   •   '), fontSize: 9, color: '#888888', margin: [0, 0, 0, 6] });
      content.push({ text: sc.condensedText || '', fontSize: 10.5, margin: [0, 0, 0, 4] });
    });
    const docDefinition = {
      content,
      defaultStyle: { font: 'Roboto' },
      pageMargins: [40, 40, 40, 40],
    };
    const filename = (sbCurrentDoc.title || 'script-breakdown').replace(/[^\p{L}\p{N}\-_ ]/gu, '').trim() || 'script-breakdown';
    pdfMake.createPdf(docDefinition).download(filename + '.pdf');
  } catch (err) {
    alert('Не удалось собрать PDF: ' + err.message);
  } finally {
    btn.disabled = false; btn.textContent = originalLabel;
  }
}

// ---------- tabs ----------
function wireSbTabs() {
  document.querySelectorAll('.page-tabs .page-tab').forEach(tab => {
    tab.onclick = () => switchSbView(tab.dataset.view);
  });
}
function switchSbView(view) {
  document.querySelectorAll('.page-tabs .page-tab').forEach(t => t.classList.toggle('active', t.dataset.view === view));
  document.getElementById('sbBreakdownView').classList.toggle('hidden', view !== 'breakdown');
  document.getElementById('sbSummaryViewWrap').classList.toggle('hidden', view !== 'summary');
  document.getElementById('sbMobileSubtabs').classList.toggle('sb-hidden', view !== 'breakdown');
  if (view !== 'breakdown') closeSbSheet();
}

// ---------- full re-render ----------
function updateSbStatusHint() {
  const scenes = sbCurrentDoc && sbCurrentDoc.scenes;
  const text = scenes && scenes.length ? (scenes.length + ' сцен(а)') : '';
  document.getElementById('sbStatusHint').textContent = text;
  document.getElementById('sbAppSceneCount').textContent = text;
}
function renderSbAll() {
  sbRenderScriptText();
  document.getElementById('sbModelSelect').value = sbCurrentDoc.model || 'gemini';
  document.getElementById('sbAppTitle').textContent = sbCurrentDoc.title || '';
  updateSbCostHint();
  updateSbStatusHint();
  renderSbTree();
  renderSbSummary();
  if (sbSelectedItem && sbSelectedItem.type === 'scene' && sbCurrentDoc.scenes && sbCurrentDoc.scenes[sbSelectedItem.sceneIdx]) {
    renderSbInspectorForScene(sbSelectedItem.sceneIdx);
  } else if (sbSelectedItem && sbCurrentDoc.scenes) {
    renderSbInspectorForCategory(sbSelectedItem.type, sbSelectedItem.name);
  } else {
    renderSbInspectorEmpty();
  }
}

// ---------- credits indicator (ported as-is from take:one's js/credits.js — same
// /api/my-balance endpoint, same two-indicator admin behavior) ----------
let sbCreditsRefreshTimer = null;
function wireCreditsIndicator() {
  const el = document.getElementById('creditsIndicator');
  if (!el) return;
  el.onclick = refreshCredits;
  const personalEl = document.getElementById('personalBalanceIndicator');
  if (personalEl) personalEl.onclick = refreshCredits;
  refreshCredits();
  if (sbCreditsRefreshTimer) clearInterval(sbCreditsRefreshTimer);
  sbCreditsRefreshTimer = setInterval(refreshCredits, 5 * 60 * 1000);
}
async function refreshCredits() {
  const el = document.getElementById('creditsIndicator');
  const dot = document.getElementById('creditsDot');
  const value = document.getElementById('creditsValue');
  const spinner = document.getElementById('creditsSpinner');
  if (!el || !dot || !value || !spinner) return;
  el.classList.remove('hidden');
  spinner.classList.remove('hidden');
  try {
    const res = await fetch('/api/my-balance');
    const data = await res.json().catch(() => null);
    if (!res.ok || !data || typeof data.credits !== 'number') {
      const notConfigured = data && data.error === 'not_configured';
      dot.className = 'credits-dot grey';
      value.textContent = notConfigured ? 'not set up' : 'error';
      el.title = (data && data.message) || 'Could not reach the server — click to retry';
      renderSbSettingsCredits(null);
      return;
    }
    renderSbSettingsCredits(data);
    const imagesRemaining = data.imagesRemaining;
    let cls = 'grey';
    if (imagesRemaining === 0) cls = 'red';
    else if (imagesRemaining !== null && imagesRemaining !== undefined && imagesRemaining < 20) cls = 'yellow';
    else if (imagesRemaining !== null && imagesRemaining !== undefined) cls = 'green';
    dot.className = 'credits-dot ' + cls;
    const unit = data.isAdmin ? ' cr' : ' tokens';
    value.textContent = data.credits + unit;
    el.title = data.isAdmin ? ('KIE.ai: ' + data.credits + ' credits — click to refresh') : ('Your balance: ' + data.credits + ' tokens — click to refresh');

    const personalEl = document.getElementById('personalBalanceIndicator');
    const personalDot = document.getElementById('personalBalanceDot');
    const personalValue = document.getElementById('personalBalanceValue');
    if (personalEl && personalDot && personalValue) {
      if (data.isAdmin && typeof data.personalBalance === 'number') {
        personalEl.classList.remove('hidden');
        personalDot.className = 'credits-dot green';
        personalValue.textContent = data.personalBalance + ' cr (yours)';
        personalEl.title = 'Your personal balance (KIE credits minus what\'s owed to users): ' + data.personalBalance + ' — click to refresh';
      } else {
        personalEl.classList.add('hidden');
      }
    }
  } catch (err) {
    dot.className = 'credits-dot red';
    value.textContent = 'error';
    el.title = 'Could not reach the server to check your balance — click to retry';
    renderSbSettingsCredits(null);
  } finally {
    spinner.classList.add('hidden');
  }
}
// Mirrors the floating credit badges into the mobile settings sheet — same data, one fetch.
function renderSbSettingsCredits(data) {
  const wrap = document.getElementById('sbSettingsCredits');
  if (!wrap) return;
  if (!data || typeof data.credits !== 'number') {
    wrap.innerHTML = `<div class="gen-hint">Не удалось получить баланс.</div>`;
    return;
  }
  const unit = data.isAdmin ? ' cr' : ' tokens';
  let html = `<div class="sb-settings-credit-row"><span class="credits-dot green"></span><span>${data.credits}${unit}</span></div>`;
  if (data.isAdmin && typeof data.personalBalance === 'number') {
    html += `<div class="sb-settings-credit-row"><span class="credits-dot green"></span><span>${data.personalBalance} cr (yours)</span></div>`;
  }
  wrap.innerHTML = html;
}
