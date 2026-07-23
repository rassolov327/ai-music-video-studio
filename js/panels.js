// ---------- resizable panels: Assets / Inspector / Timeline ----------
// Plain pointer-drag, same pattern as the shot-trim handles and mixer fader elsewhere in
// this app — no library, just clientX/clientY deltas applied to inline width/height.

function wirePanelResizers(){
  const assetsEl2 = document.getElementById('assets');
  const inspectorEl = document.querySelector('.inspector');
  const timelineAreaEl = document.getElementById('timelineArea');

  wireColResizer(document.getElementById('resizeAssets'), assetsEl2, { min:160, max:420, side:'left' });
  wireColResizer(document.getElementById('resizeInspector'), inspectorEl, { min:180, max:420, side:'right' });
  wireRowResizer(document.getElementById('resizeTimeline'), timelineAreaEl, { min:120, max:() => Math.round(window.innerHeight*0.8) });
}

function wireColResizer(handle, panelEl, opts){
  if(!handle || !panelEl) return;
  handle.addEventListener('pointerdown', (e)=>{
    e.preventDefault();
    handle.classList.add('dragging');
    handle.setPointerCapture(e.pointerId);
    const startX = e.clientX;
    const startWidth = panelEl.getBoundingClientRect().width / ZOOM;
    const onMove = (ev)=>{
      const deltaVisual = (ev.clientX - startX) / ZOOM;
      const delta = opts.side==='left' ? deltaVisual : -deltaVisual;
      const newWidth = Math.max(opts.min, Math.min(opts.max, startWidth + delta));
      panelEl.style.width = newWidth + 'px';
    };
    const onUp = ()=>{
      handle.classList.remove('dragging');
      handle.removeEventListener('pointermove', onMove);
      handle.removeEventListener('pointerup', onUp);
      if(typeof saveProjectSoon==='function') saveProjectSoon();
    };
    handle.addEventListener('pointermove', onMove);
    handle.addEventListener('pointerup', onUp);
  });
}

function wireRowResizer(handle, panelEl, opts){
  if(!handle || !panelEl) return;
  handle.addEventListener('pointerdown', (e)=>{
    e.preventDefault();
    handle.classList.add('dragging');
    handle.setPointerCapture(e.pointerId);
    const startY = e.clientY;
    const startHeight = panelEl.getBoundingClientRect().height / ZOOM;
    const onMove = (ev)=>{
      const deltaVisual = (ev.clientY - startY) / ZOOM;
      // dragging the handle down should make the timeline taller (it sits above the panel)
      const maxH = typeof opts.max==='function' ? opts.max() : opts.max;
      const newHeight = Math.max(opts.min, Math.min(maxH, startHeight - deltaVisual));
      panelEl.style.height = newHeight + 'px';
    };
    const onUp = ()=>{
      handle.classList.remove('dragging');
      handle.removeEventListener('pointermove', onMove);
      handle.removeEventListener('pointerup', onUp);
      if(typeof saveProjectSoon==='function') saveProjectSoon();
    };
    handle.addEventListener('pointermove', onMove);
    handle.addEventListener('pointerup', onUp);
  });
}
