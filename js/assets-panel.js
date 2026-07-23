function renderAssets(){
  if(typeof markProjectDirty==='function') markProjectDirty();
  assetsEl.innerHTML='';
  state.categories.forEach(cat=>{
    const isScenes = cat.key==='scenes';
    const displayItems = isScenes ? state.scenes : cat.items;

    const catEl = document.createElement('div');
    catEl.className='cat';

    const head = document.createElement('div');
    head.className='cat-head' + (cat.collapsed ? ' collapsed' : '');
    head.innerHTML = `
      <svg class="chev" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>
      <i class="ti ${cat.icon} folder"></i>
      <span class="cat-name">${cat.name}</span>
      <span class="cat-count">${displayItems.length || ''}</span>
      <span class="cat-add" title="Open editor"><svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4Z"></path></svg></span>
    `;

    const itemsEl = document.createElement('div');
    itemsEl.className='cat-items' + (cat.collapsed ? ' hidden' : '');

    if(displayItems.length===0){
      const empty = document.createElement('div');
      empty.className='empty-cat';
      empty.textContent = 'No assets yet';
      itemsEl.appendChild(empty);
    } else if(isScenes){
      state.scenes.forEach((scene)=>{
        const row = document.createElement('div');
        row.className='item';
        const col = sceneColor(scene);
        row.innerHTML = `<span class="scene-color-dot" style="background:${col.dot};margin-right:1px;"></span><span class="item-name">${scene.name}</span>
          <span class="item-del" title="Remove"><svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"></path><path d="M10 11v6"></path><path d="M14 11v6"></path></svg></span>`;
        row.onclick = (e)=>{
          if(e.target.closest('.item-del')) return;
          document.querySelectorAll('.item.selected').forEach(el=>el.classList.remove('selected'));
          row.classList.add('selected');
          showSceneGallery(scene.id);
        };
        row.querySelector('.item-del').onclick = (e)=>{
          e.stopPropagation();
          deleteScene(scene.id);
        };
        itemsEl.appendChild(row);
      });
    } else {
      cat.items.forEach((it,idx)=>{
        const row = document.createElement('div');
        row.className='item';
        const isChar = cat.addType==='character';
        const isLoc = cat.addType==='location';
        const isMusic = cat.addType==='music';
        const isLook = cat.addType==='look';
        const statusDot = isChar ? `<span class="item-status-dot status-${characterStatus(it)}"></span>`
          : isLoc ? `<span class="item-status-dot status-${locationStatus(it)}"></span>`
          : isLook ? `<span class="item-status-dot status-${lookStatus(it)}"></span>` : '';
        const iconHtml = it.photo
          ? `<span class="item-avatar-wrap"><span class="item-avatar" style="background-image:url(${it.photo})"></span>${statusDot}</span>`
          : isMusic
            ? `<span class="item-avatar-wrap" style="color:var(--text-3);">${noteSvg(14)}</span>`
            : isLook
              ? `<span class="item-avatar-wrap" style="color:var(--text-3);position:relative;">${it.previewImage ? `<span class="item-avatar" style="background-image:url(${it.previewImage})"></span>` : shirtSvg(14)}${statusDot}</span>`
              : `<span class="item-avatar-wrap"><i class="ti ${it.icon} itype"></i>${statusDot}</span>`;
        row.innerHTML = `${iconHtml}<span class="item-name">${it.name}</span>
          <span class="item-del" title="Remove"><svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"></path><path d="M10 11v6"></path><path d="M14 11v6"></path></svg></span>`;
        if(isMusic && it.id){
          row.draggable = true;
          row.title = 'Drag onto the timeline';
          row.addEventListener('dragstart', (e)=>{
            e.dataTransfer.setData('text/plain', it.id);
            e.dataTransfer.effectAllowed = 'copy';
          });
        }
        row.onclick = (e)=>{
          if(e.target.closest('.item-del')) return;
          document.querySelectorAll('.item.selected').forEach(el=>el.classList.remove('selected'));
          row.classList.add('selected');
          if(cat.addType==='character'){
            showCharacterCard(cat, idx);
          } else if(cat.addType==='location'){
            showLocationCard(cat, idx);
          } else if(cat.addType==='look'){
            showLookForm(cat, idx);
          }
        };
        row.querySelector('.item-del').onclick = (e)=>{
          e.stopPropagation();
          if(isMusic && state.timelineAudio && state.timelineAudio.trackId===it.id){
            state.timelineAudio = null;
          }
          if(isMusic && it.audioUrl) URL.revokeObjectURL(it.audioUrl);
          if(isMusic && typeof deleteAudioAsset==='function') deleteAudioAsset(it.id);
          if(isChar && typeof deleteCharacterImages==='function') deleteCharacterImages(it);
          if(isLoc && typeof deleteLocationImages==='function') deleteLocationImages(it);
          cat.items.splice(idx,1);
          renderAssets();
          renderTimeline();
          if(typeof saveProjectSoon==='function') saveProjectSoon();
        };
        itemsEl.appendChild(row);
      });
    }

    head.addEventListener('click', (e)=>{
      if(e.target.closest('.cat-add')) return;
      cat.collapsed = !cat.collapsed;
      head.classList.toggle('collapsed');
      itemsEl.classList.toggle('hidden');
    });
    head.querySelector('.cat-add').addEventListener('click', (e)=>{
      e.stopPropagation();
      if(cat.addType==='character'){
        showCharacterGallery(cat);
      } else if(cat.addType==='scene'){
        showScenesOverview();
      } else if(cat.addType==='location'){
        showLocationGallery(cat);
      } else if(cat.addType==='music'){
        showMusicGallery(cat);
      } else if(cat.addType==='look'){
        showLookGallery(cat);
      } else {
        showGenericPlaceholder(cat);
      }
    });

    catEl.appendChild(head);
    catEl.appendChild(itemsEl);
    assetsEl.appendChild(catEl);
  });
}

// ---------- preview: default empty state ----------
function showEmptyPreview(){
  previewEl.classList.remove('align-tl');
  previewEl.onclick = null;
  previewBarEl.textContent = 'Preview';
  previewEl.innerHTML = `
    <div class="empty-preview">
      <i class="ti ti-clapperboard"></i>
      <div class="t1">Empty project</div>
      <div class="t2">Add band members, then build out locations and scenes to start storyboarding.</div>
    </div>`;
}

// ---------- preview: generic placeholder for not-yet-built asset types ----------
function showGenericPlaceholder(cat){
  pausePlayback();
  previewEl.classList.remove('align-tl');
  previewEl.onclick = null;
  previewBarEl.textContent = 'Add asset — ' + cat.name;
  previewEl.innerHTML = `
    <div class="empty-preview">
      <i class="ti ti-tools"></i>
      <div class="t1">${cat.name} creation isn't built yet</div>
      <div class="t2">This asset type will get its own creation form next.</div>
    </div>`;
}

// ---------- preview: characters gallery (tile grid) ----------
function characterStatus(it){
  if(!it.name || !it.photo || !it.role || !it.description) return 'red';
  const coreDone = filledCoreAngleCount(it.angleSlots) >= coreAngleCountTotal();
  if(!coreDone || !it.referenceCard) return 'yellow';
  return 'green';
}

function locationStatus(it){
  if(!it.name || !it.photo || !it.description) return 'red';
  if(!it.referenceCard) return 'yellow';
  return 'green';
}

function showCharacterGallery(cat){
  pausePlayback();
  previewEl.classList.add('align-tl');
  previewEl.onclick = null;
  previewBarEl.textContent = 'Characters';

  const tiles = cat.items.map((it,idx)=>`
    <div class="char-tile" data-idx="${idx}">
      <div class="char-tile-photo" style="${it.photo ? `background-image:url(${it.photo})` : ''}">
        ${it.photo ? '' : '<i class="ti ti-user"></i>'}
        <div class="char-tile-status status-${characterStatus(it)}" title="${characterStatus(it)==='green'?'AI reference generated':characterStatus(it)==='yellow'?'Character complete, reference not generated':'Missing required fields'}"></div>
        <div class="char-tile-del" title="Remove"><svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"></path><path d="M10 11v6"></path><path d="M14 11v6"></path></svg></div>
      </div>
      <div class="char-tile-name">${it.name}</div>
      <div class="char-tile-role">${it.role || ''}</div>
    </div>
  `).join('');

  previewEl.innerHTML = `
    <div class="char-gallery">
      <div class="char-grid">
        ${tiles}
        <div class="char-tile char-tile-add" id="charAddTile">
          <div class="char-tile-photo"><svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg></div>
          <div class="char-tile-name">Add member</div>
        </div>
      </div>
    </div>`;

  previewEl.querySelectorAll('.char-tile-del').forEach(btn=>{
    btn.onclick = (e)=>{
      e.stopPropagation();
      const idx = parseInt(e.target.closest('.char-tile').dataset.idx, 10);
      if(typeof deleteCharacterImages==='function') deleteCharacterImages(cat.items[idx]);
      cat.items.splice(idx,1);
      renderAssets();
      showCharacterGallery(cat);
      if(typeof saveProjectSoon==='function') saveProjectSoon();
    };
  });

  previewEl.querySelectorAll('.char-tile:not(.char-tile-add)').forEach(tile=>{
    tile.onclick = (e)=>{
      if(e.target.closest('.char-tile-del')) return;
      const idx = parseInt(tile.dataset.idx, 10);
      showCharacterCard(cat, idx);
    };
  });

  document.getElementById('charAddTile').onclick = ()=>{
    showCharacterForm(cat);
  };
}

