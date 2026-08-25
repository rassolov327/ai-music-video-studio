// ---------- Script Breakdown (standalone /script tool) ----------
// Entirely separate from the main take:one app — no state.js, no persistence.js, no shared
// globals. The only things it shares with take:one are the login/session system (same
// /api/me, /api/login, /api/logout cookies) and the styles.css theme. Everything else
// (the script text, the breakdown, the summary) lives in its own IndexedDB database.

const SB_DB_NAME = 'script_breakdown_db';
const SB_STORE = 'documents';

let sbDb = null;
let sbModels = [];
let sbDocsList = [];       // [{id,title,updatedAt}] — sorted newest first
let sbCurrentDoc = null;   // { id, title, createdAt, updatedAt, rawText, model, scenes }
let sbSelectedItem = null; // {type:'character'|'location'|'prop'|'weapon'|'vehicle'|'timeOfDay', name} or {type:'scene', sceneIdx}
let sbSaveTimer = null;
let sbAnalyzeCooldownUntil = 0;

// ---------- tiny IndexedDB wrapper ----------
function sbOpenDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(SB_DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(SB_STORE)) db.createObjectStore(SB_STORE, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function sbGetDb() {
  if (!sbDb) sbDb = await sbOpenDb();
  return sbDb;
}
async function sbTx(mode) {
  const db = await sbGetDb();
  return db.transaction(SB_STORE, mode).objectStore(SB_STORE);
}
async function sbSaveDoc(doc) {
  const store = await sbTx('readwrite');
  return new Promise((resolve, reject) => {
    const req = store.put(doc);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}
async function sbLoadAllDocs() {
  const store = await sbTx('readonly');
  return new Promise((resolve, reject) => {
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}
async function sbGetDoc(id) {
  const store = await sbTx('readonly');
  return new Promise((resolve, reject) => {
    const req = store.get(id);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}
async function sbDeleteDoc(id) {
  const store = await sbTx('readwrite');
  return new Promise((resolve, reject) => {
    const req = store.delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

function sbEscapeHtml(s) {
  return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ---------- auth gate (same pattern as panel_r2d2.html) ----------
(async function () {
  function showLogin() {
    document.getElementById('sbLoginScreen').classList.remove('hidden');
    document.getElementById('app').classList.add('hidden');
  }
  function showApp() {
    document.getElementById('sbLoginScreen').classList.add('hidden');
    document.getElementById('app').classList.remove('hidden');
  }
  async function tryEnter() {
    let res;
    try { res = await fetch('/api/me'); } catch (err) { showLogin(); return; }
    if (!res.ok) { showLogin(); return; }
    showApp();
    if (!window.__sbInited) { window.__sbInited = true; await initSbApp(); }
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
  document.getElementById('sbLogoutBtn').onclick = async () => {
    try { await fetch('/api/logout', { method: 'POST' }); } catch (err) {}
    location.reload();
  };
  tryEnter();
})();

// ---------- bootstrap ----------
async function initSbApp() {
  wireSbTabs();
  wireSbUpload();
  wireSbTextInput();
  wireSbDocButtons();
  document.getElementById('sbAnalyzeBtn').onclick = runSbAnalysis;
  document.getElementById('sbClearBtn').onclick = clearSbScript;
  document.getElementById('sbModelSelect').onchange = updateSbCostHint;

  await loadSbModels();
  await refreshSbDocsList();
  if (sbDocsList.length) await openSbDoc(sbDocsList[0].id);
  else newSbDoc();
}

async function loadSbModels() {
  try {
    const res = await fetch('/api/script-breakdown/models');
    const data = await res.json();
    sbModels = (data && data.models) || [];
  } catch (err) {
    sbModels = [{ id: 'gemini', label: 'Gemini (бесплатно)', free: true }];
  }
  const sel = document.getElementById('sbModelSelect');
  sel.innerHTML = sbModels.map(m => `<option value="${m.id}">${sbEscapeHtml(m.label)}</option>`).join('');
}

// ---------- document management ----------
function sbNewDocObject() {
  return {
    id: 'sb' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
    title: 'Untitled script', createdAt: Date.now(), updatedAt: Date.now(),
    rawText: '', model: 'gemini', scenes: null,
  };
}
function newSbDoc() {
  sbCurrentDoc = sbNewDocObject();
  sbSelectedItem = null;
  renderSbAll();
  sbSaveDocNow();
}
async function openSbDoc(id) {
  const doc = await sbGetDoc(id);
  if (!doc) { newSbDoc(); return; }
  sbCurrentDoc = doc;
  sbSelectedItem = null;
  renderSbAll();
}
function sbSaveSoon() {
  clearTimeout(sbSaveTimer);
  sbSaveTimer = setTimeout(sbSaveDocNow, 800);
}
async function sbSaveDocNow() {
  if (!sbCurrentDoc) return;
  sbCurrentDoc.updatedAt = Date.now();
  setSbSaveStatus('Saving…');
  try {
    await sbSaveDoc(sbCurrentDoc);
    setSbSaveStatus('Saved');
    await refreshSbDocsList();
  } catch (err) {
    setSbSaveStatus('Error');
  }
}
function setSbSaveStatus(text) {
  const el = document.getElementById('sbSaveStatus');
  if (el) el.textContent = text;
}
async function refreshSbDocsList() {
  const docs = await sbLoadAllDocs();
  docs.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  sbDocsList = docs;
  const sel = document.getElementById('sbDocsSelect');
  sel.innerHTML = docs.map(d => `<option value="${d.id}" ${sbCurrentDoc && d.id === sbCurrentDoc.id ? 'selected' : ''}>${sbEscapeHtml(d.title || 'Untitled')}</option>`).join('');
}
function wireSbDocButtons() {
  document.getElementById('sbDocsSelect').onchange = (e) => openSbDoc(e.target.value);
  document.getElementById('sbNewDocBtn').onclick = () => {
    if (sbCurrentDoc && ((sbCurrentDoc.rawText || '').trim() || sbCurrentDoc.scenes) && !confirm('Начать новый сценарий? Текущий уже сохранён и останется в списке слева.')) return;
    newSbDoc();
  };
  document.getElementById('sbRenameDocBtn').onclick = () => {
    if (!sbCurrentDoc) return;
    const title = prompt('Название сценария:', sbCurrentDoc.title || '');
    if (title === null) return;
    sbCurrentDoc.title = title.trim() || 'Untitled script';
    sbSaveDocNow();
  };
  document.getElementById('sbDeleteDocBtn').onclick = async () => {
    if (!sbCurrentDoc) return;
    if (!confirm('Удалить этот сценарий безвозвратно?')) return;
    await sbDeleteDoc(sbCurrentDoc.id);
    await refreshSbDocsList();
    if (sbDocsList.length) await openSbDoc(sbDocsList[0].id);
    else newSbDoc();
  };
}

// ---------- script text input ----------
function wireSbTextInput() {
  const el = document.getElementById('sbTextInput');
  el.addEventListener('paste', (e) => {
    e.preventDefault();
    const text = (e.clipboardData || window.clipboardData).getData('text/plain');
    document.execCommand('insertText', false, text);
  });
  el.addEventListener('input', () => {
    sbCurrentDoc.rawText = el.innerText;
    updateSbCostHint();
    sbSaveSoon();
  });
}
function clearSbScript() {
  if (!sbCurrentDoc) return;
  if (((sbCurrentDoc.rawText || '').trim() || sbCurrentDoc.scenes) && !confirm('Очистить текст и разбор? Это затронет только этот документ.')) return;
  sbCurrentDoc.rawText = '';
  sbCurrentDoc.scenes = null;
  sbSelectedItem = null;
  document.getElementById('sbTextInput').innerText = '';
  renderSbAll();
  sbSaveDocNow();
}

// ---------- file upload (PDF / DOCX / TXT) ----------
function wireSbUpload() {
  const btn = document.getElementById('sbUploadBtn');
  const input = document.getElementById('sbFileInput');
  btn.onclick = () => input.click();
  input.onchange = async () => {
    const file = input.files[0];
    input.value = '';
    if (!file) return;
    const ext = file.name.toLowerCase().split('.').pop();
    if (!['pdf', 'docx', 'txt'].includes(ext)) { alert('Поддерживаются только PDF, DOCX и TXT.'); return; }
    const originalLabel = btn.textContent;
    btn.disabled = true; btn.textContent = 'Загрузка…';
    try {
      const dataUrl = await sbFileToDataUrl(file);
      const res = await fetch('/api/script-breakdown/extract-text', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dataUrl, filename: file.name }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data || typeof data.text !== 'string') throw new Error((data && data.message) || 'Не удалось прочитать файл.');
      document.getElementById('sbTextInput').innerText = data.text;
      sbCurrentDoc.rawText = data.text;
      if (!sbCurrentDoc.title || sbCurrentDoc.title === 'Untitled script') {
        sbCurrentDoc.title = file.name.replace(/\.[^.]+$/, '');
      }
      updateSbCostHint();
      sbSaveDocNow();
    } catch (err) {
      alert('Ошибка: ' + err.message);
    } finally {
      btn.disabled = false; btn.textContent = originalLabel;
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
function updateSbCostHint() {
  const hintEl = document.getElementById('sbCostHint');
  const sel = document.getElementById('sbModelSelect');
  if (!hintEl || !sel) return;
  const modelDef = sbModels.find(m => m.id === sel.value);
  if (!modelDef || modelDef.free) { hintEl.textContent = 'Бесплатно'; return; }
  const text = sbCurrentDoc ? (sbCurrentDoc.rawText || '') : '';
  if (!text) { hintEl.textContent = ''; return; }
  const inputTok = Math.ceil(text.length / 3) + 400;
  const outputTok = Math.ceil((text.length / 3) * 0.7) + 1500;
  const credits = (inputTok / 1e6) * modelDef.inputCreditsPerM + (outputTok / 1e6) * modelDef.outputCreditsPerM;
  hintEl.textContent = '≈ ' + Math.ceil(credits) + ' кр KIE';
}

// ---------- Analyze ----------
async function runSbAnalysis() {
  if (!sbCurrentDoc) return;
  const text = (document.getElementById('sbTextInput').innerText || '').trim();
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
    renderSbAll();
    sbSaveDocNow();
    sbAnalyzeCooldownUntil = Date.now() + 4000;
  } catch (err) {
    alert('Ошибка анализа: ' + err.message);
  } finally {
    btn.disabled = false; btn.textContent = 'Analyze';
  }
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

// ---------- tree ----------
function renderSbTree() {
  const tree = document.getElementById('sbTree');
  const scenes = sbCurrentDoc && sbCurrentDoc.scenes;
  if (!scenes || !scenes.length) {
    tree.innerHTML = `<div class="gen-hint" style="padding:14px;">Вставьте сценарий слева и нажмите Analyze — разбор появится здесь.</div>`;
    return;
  }
  function catBlock(title, list, type) {
    if (!list.length) return '';
    return `<div class="script-cat-title">${title}</div>` + list.map(it => `
      <div class="script-tree-item${sbSelectedItem && sbSelectedItem.type === type && sbSelectedItem.name === it.name ? ' active' : ''}" data-cat-type="${type}" data-cat-name="${sbEscapeHtml(it.name)}">
        <span>${sbEscapeHtml(it.name)}</span>
        <span class="sb-scene-count">${it.sceneIdxs.length}</span>
      </div>`).join('');
  }
  let html = '';
  html += catBlock('Персонажи', sbAggregateArrayField(scenes, 'characters'), 'character');
  html += catBlock('Локации', sbAggregateSingularField(scenes, 'location'), 'location');
  html += catBlock('Реквизит', sbAggregateArrayField(scenes, 'props'), 'prop');
  const weapons = sbAggregateArrayField(scenes, 'weapons');
  if (weapons.length) html += `<div class="script-tree-shots">${catBlock('Оружие', weapons, 'weapon')}</div>`;
  html += catBlock('Транспорт', sbAggregateArrayField(scenes, 'vehicles'), 'vehicle');
  html += catBlock('Режим', sbAggregateTimeOfDay(scenes), 'timeOfDay');
  html += `<div class="script-cat-title">Сцены</div>` + scenes.map((sc, idx) => `
    <div class="script-tree-item${sbSelectedItem && sbSelectedItem.type === 'scene' && sbSelectedItem.sceneIdx === idx ? ' active' : ''}" data-scene-idx="${idx}">
      <span>${idx + 1}. ${sbEscapeHtml(sc.title || '')}</span>
    </div>`).join('');
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
}
function selectSbScene(idx) {
  sbSelectedItem = { type: 'scene', sceneIdx: idx };
  renderSbTree();
  renderSbInspectorForScene(idx);
  sbJumpToScene(idx);
}

// Searches the ORIGINAL text for the scene's verbatim headingText rather than trusting the
// model to report exact character positions (positions can't survive re-typing anyway, and
// this mirrors the same "search, don't trust offsets" approach already used in the
// in-project SCRIPT tab for highlighting character names).
function sbJumpToScene(idx) {
  const el = document.getElementById('sbTextInput');
  if (!el || !sbCurrentDoc) return;
  const scene = sbCurrentDoc.scenes[idx];
  const plainText = el.innerText;
  const escapedHtml = sbEscapeHtml(plainText);
  if (!scene || !scene.headingText) { el.innerHTML = escapedHtml; return; }
  const needle = scene.headingText.trim();
  const pos = needle ? plainText.indexOf(needle) : -1;
  if (pos === -1) { el.innerHTML = escapedHtml; return; }
  const before = sbEscapeHtml(plainText.slice(0, pos));
  const match = sbEscapeHtml(plainText.slice(pos, pos + needle.length));
  const after = sbEscapeHtml(plainText.slice(pos + needle.length));
  el.innerHTML = before + '<mark class="script-highlight" id="sbJumpMark">' + match + '</mark>' + after;
  const mark = document.getElementById('sbJumpMark');
  if (mark) mark.scrollIntoView({ block: 'center', behavior: 'smooth' });
}

// ---------- inspector ----------
function sbInspectorShell(inner) {
  return `<div class="insp-tabs"><div class="insp-tab" style="cursor:default;">Inspector</div></div>${inner}`;
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
      <div style="font-size:13px;font-weight:600;color:var(--text-1);margin-bottom:8px;">${idx + 1}. ${sbEscapeHtml(sc.title || '')}</div>
      <div class="cf-field"><label>Локация</label><div class="gen-hint" style="margin:0;">${sbEscapeHtml(sc.location || '—')}</div></div>
      <div class="cf-field"><label>Время суток</label><div class="gen-hint" style="margin:0;">${sbEscapeHtml(sc.timeOfDay || '—')}</div></div>
      ${field('Персонажи', sc.characters)}
      ${field('Реквизит', sc.props)}
      ${field('Оружие', sc.weapons)}
      ${field('Транспорт', sc.vehicles)}
    </div>`);
}
function renderSbInspectorEmpty() {
  document.getElementById('sbInspector').innerHTML = sbInspectorShell(`<div class="gen-hint" style="padding:14px;">Кликните на сцену или элемент слева, чтобы увидеть детали здесь.</div>`);
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
}

// ---------- full re-render ----------
function updateSbStatusHint() {
  const hint = document.getElementById('sbStatusHint');
  const scenes = sbCurrentDoc && sbCurrentDoc.scenes;
  hint.textContent = scenes && scenes.length ? (scenes.length + ' сцен(а)') : '';
}
function renderSbAll() {
  const textEl = document.getElementById('sbTextInput');
  if (textEl.innerText !== (sbCurrentDoc.rawText || '') && document.activeElement !== textEl) {
    textEl.innerText = sbCurrentDoc.rawText || '';
  }
  document.getElementById('sbModelSelect').value = sbCurrentDoc.model || 'gemini';
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
