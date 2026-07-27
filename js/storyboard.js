// ---------- STORYBOARD tab ----------
let storyboardCols = 4; // live-view zoom level (how many images per row) — independent of
// the export, which always uses a fixed 4-column/1920px layout as specified.

function collectAllShotsInOrder(){
  const list = [];
  for(const scene of state.scenes){
    for(const shot of scene.shots){
      list.push({ scene, shot });
    }
  }
  return list;
}

function wireStoryboardPage(){
  const exportBtn = document.getElementById('storyboardExportBtn');
  if(exportBtn) exportBtn.onclick = exportStoryboardImage;

  const openBtn = document.getElementById('storyboardOpenBtn');
  if(openBtn) openBtn.onclick = openStoryboardModal;
  const closeBtn = document.getElementById('storyboardModalClose');
  if(closeBtn) closeBtn.onclick = closeStoryboardModal;

  const slider = document.getElementById('sbZoomSlider');
  const outBtn = document.getElementById('sbZoomOutBtn');
  const inBtn = document.getElementById('sbZoomInBtn');
  if(slider){
    slider.value = storyboardCols;
    slider.addEventListener('input', (e)=> setStoryboardZoom(parseInt(e.target.value, 10)));
  }
  if(outBtn) outBtn.addEventListener('click', ()=> setStoryboardZoom(storyboardCols + 1)); // more columns = smaller images = zoomed out
  if(inBtn) inBtn.addEventListener('click', ()=> setStoryboardZoom(storyboardCols - 1)); // fewer columns = bigger images = zoomed in

  window.addEventListener('resize', ()=>{
    const modal = document.getElementById('storyboardModal');
    if(modal && !modal.classList.contains('hidden')) renderStoryboardGrid();
  });
}

function openStoryboardModal(){
  document.getElementById('storyboardModal').classList.remove('hidden');
  renderStoryboardGrid();
}
function closeStoryboardModal(){
  document.getElementById('storyboardModal').classList.add('hidden');
}

function setStoryboardZoom(cols){
  storyboardCols = Math.max(2, Math.min(8, cols));
  const slider = document.getElementById('sbZoomSlider');
  if(slider) slider.value = storyboardCols;
  renderStoryboardGrid();
}

function renderStoryboardGrid(){
  const grid = document.getElementById('storyboardGrid');
  const scroll = document.getElementById('storyboardScroll');
  if(!grid || !scroll) return;
  const entries = collectAllShotsInOrder();
  if(entries.length===0){
    grid.innerHTML = `<div class="gen-hint" style="padding:20px;">No shots yet — add scenes and shots on the WORK timeline first.</div>`;
    return;
  }
  // Explicit pixel sizing (not CSS Grid + aspect-ratio, which has a real row-track-sizing
  // bug — the grid track ends up taller than the cell it holds, showing as a gap) — every
  // cell gets the exact same JS-computed width/height, so rows always butt up edge to edge.
  const containerWidth = scroll.clientWidth || 1920;
  const cellW = Math.floor(containerWidth / storyboardCols);
  const meta = state.projectMeta || { width:1920, height:1080 };
  const cellH = Math.round(cellW * (meta.height / meta.width));

  grid.innerHTML = entries.map(({shot})=>{
    const inner = shot.previewImage
      ? `<img src="${shot.previewImage}">${shot.videoUrl ? '<div class="storyboard-cell-badge" title="Animated"><svg viewBox="0 0 24 24" width="9" height="9" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg></div>' : ''}`
      : `<div class="storyboard-cell-empty">${shot.description ? escapeHtml(shot.description) : '(no description)'}</div>`;
    return `<div class="storyboard-cell" style="width:${cellW}px;height:${cellH}px;">${inner}</div>`;
  }).join('');
}

function loadImageEl(src){
  return new Promise((resolve, reject)=>{
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = ()=> resolve(img);
    img.onerror = ()=> reject(new Error('could not load image'));
    img.src = src;
  });
}

function wrapCanvasText(ctx, text, cx, cy, maxWidth, lineHeight){
  const words = text.split(' ');
  const lines = [];
  let line = '';
  for(const word of words){
    const test = line ? line + ' ' + word : word;
    if(ctx.measureText(test).width > maxWidth && line){
      lines.push(line);
      line = word;
    } else {
      line = test;
    }
  }
  if(line) lines.push(line);
  const maxLines = 6;
  const shown = lines.slice(0, maxLines);
  const startY = cy - (shown.length-1)*lineHeight/2;
  shown.forEach((l, i)=> ctx.fillText(l, cx, startY + i*lineHeight));
}

function drawStoryboardPlaceholder(ctx, x, y, w, h, description){
  ctx.fillStyle = '#000';
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = 'rgba(255,255,255,.15)';
  ctx.strokeRect(x+0.5, y+0.5, w-1, h-1);
  if(description){
    ctx.fillStyle = 'rgba(255,255,255,.55)';
    ctx.font = '13px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    wrapCanvasText(ctx, description, x + w/2, y + h/2, w - 24, 16);
  }
}

async function exportStoryboardImage(){
  const entries = collectAllShotsInOrder();
  if(entries.length===0){ alert('No shots to export yet.'); return; }
  const btn = document.getElementById('storyboardExportBtn');
  btn.disabled = true; btn.textContent = 'Exporting…';
  try{
    const cols = 4;
    const totalWidth = 1920;
    const cellW = totalWidth / cols;
    const meta = state.projectMeta || { width:1920, height:1080 };
    const cellH = cellW * (meta.height / meta.width);
    const rows = Math.ceil(entries.length / cols);
    const canvas = document.createElement('canvas');
    canvas.width = totalWidth;
    canvas.height = Math.round(cellH * rows);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    for(let i=0; i<entries.length; i++){
      const { shot } = entries[i];
      const col = i % cols;
      const row = Math.floor(i / cols);
      const x = col * cellW;
      const y = row * cellH;
      if(shot.previewImage){
        try{
          const img = await loadImageEl(shot.previewImage);
          const scale = Math.max(cellW / img.width, cellH / img.height);
          const dw = img.width * scale, dh = img.height * scale;
          const dx = x + (cellW - dw) / 2, dy = y + (cellH - dh) / 2;
          ctx.save();
          ctx.beginPath();
          ctx.rect(x, y, cellW, cellH);
          ctx.clip();
          ctx.drawImage(img, dx, dy, dw, dh);
          ctx.restore();
        } catch(err){
          drawStoryboardPlaceholder(ctx, x, y, cellW, cellH, shot.description);
        }
      } else {
        drawStoryboardPlaceholder(ctx, x, y, cellW, cellH, shot.description);
      }
    }

    await new Promise((resolve, reject)=>{
      canvas.toBlob((blob)=>{
        if(!blob){ reject(new Error('Canvas export failed.')); return; }
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = (state.projectMeta.name || 'storyboard').replace(/[^a-z0-9]+/gi, '_') + '_storyboard.png';
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(()=> URL.revokeObjectURL(url), 5000);
        resolve();
      }, 'image/png');
    });
  } catch(err){
    alert('Could not export the storyboard: ' + err.message);
  } finally {
    btn.disabled = false; btn.textContent = 'Export as image';
  }
}
