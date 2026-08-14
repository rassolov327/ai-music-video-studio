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

// ---- Work tab: anchors + backdrops (placeholders — Character/Object Card flow TBD) ----
function renderTvAnchors(){
  const el = document.getElementById('tvAnchorsGrid');
  if(!el) return;
  el.innerHTML = tvState.tvAnchors.length
    ? tvState.tvAnchors.map(a=> `<div class="tv-card-tile"><div class="tv-card-tile-name">${a.name}</div></div>`).join('')
    : `<div class="tv-empty-hint">Ведущих пока нет — нажмите «+ Ведущий».</div>`;
}
function renderTvBackdrops(){
  const el = document.getElementById('tvBackdropsGrid');
  if(!el) return;
  el.innerHTML = tvState.tvBackdrops.length
    ? tvState.tvBackdrops.map(b=> `<div class="tv-card-tile"><div class="tv-card-tile-name">${b.name}</div></div>`).join('')
    : `<div class="tv-empty-hint">Декораций студии пока нет — нажмите «+ Декорация».</div>`;
}
function addTvAnchor(){
  const name = prompt('Имя ведущего:');
  if(!name) return;
  // Card input/output slots start empty — the actual Character Card build-out (reusing
  // characters.js + object-card.js as the template) is the next planned step, per CLAUDE.md.
  tvState.tvAnchors.push({ id: tvAnchorSeq++, name, cardInputSlots: {}, cardOutputSlots: {}, approved:false });
  renderTvAnchors();
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

// ---- Boot: load whatever /api/tv/* endpoints already exist, defensively — those routes
// are being built out separately, so a 404 here must not break the page. ----
async function tvFetchJson(url){
  try{
    const res = await fetch(url);
    if(!res.ok) return null;
    return await res.json();
  } catch(err){
    console.warn('[tv] could not reach', url, err);
    return null;
  }
}
async function loadTvData(){
  const news = await tvFetchJson('/api/tv/news');
  if(news && Array.isArray(news.items)) tvState.tvNewsItems = news.items;
  const grid = await tvFetchJson('/api/tv/grid');
  if(grid && Array.isArray(grid.blocks)) tvState.tvGridBlocks = grid.blocks;
  const anniversary = await tvFetchJson('/api/tv/anniversary');
  if(anniversary && Array.isArray(anniversary.events)) tvState.tvAnniversaryEvents = anniversary.events;
}

function wireTvPageTabs(){
  document.querySelectorAll('.tv-page-tab').forEach(tab=>{
    tab.onclick = ()=> showTvPage(tab.dataset.tvPage);
  });
  const approveBtn = document.getElementById('tvApproveBtn');
  if(approveBtn) approveBtn.onclick = toggleTvApproval;
  const addAnchorBtn = document.getElementById('tvAddAnchorBtn');
  if(addAnchorBtn) addAnchorBtn.onclick = addTvAnchor;
  const addBackdropBtn = document.getElementById('tvAddBackdropBtn');
  if(addBackdropBtn) addBackdropBtn.onclick = addTvBackdrop;
}

(async function(){
  wireTvPageTabs();
  showTvPage('work');
  renderTvAnchors();
  renderTvBackdrops();
  await loadTvData();
  renderTvNewsPickers();
  renderTvGrid();
})();
