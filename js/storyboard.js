// ---------- STORYBOARD tab ----------
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
  const btn = document.getElementById('storyboardExportBtn');
  if(btn) btn.onclick = exportStoryboardImage;
}

function renderStoryboardGrid(){
  const grid = document.getElementById('storyboardGrid');
  if(!grid) return;
  const entries = collectAllShotsInOrder();
  if(entries.length===0){
    grid.innerHTML = `<div class="gen-hint" style="padding:20px;grid-column:1/-1;">No shots yet — add scenes and shots on the WORK timeline first.</div>`;
    return;
  }
  grid.innerHTML = entries.map(({shot})=>{
    if(shot.previewImage){
      const badge = shot.videoUrl
        ? '<div class="storyboard-cell-badge" title="Animated"><svg viewBox="0 0 24 24" width="9" height="9" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg></div>'
        : '';
      return `<div class="storyboard-cell"><img src="${shot.previewImage}">${badge}</div>`;
    }
    const desc = shot.description ? escapeHtml(shot.description) : '(no description)';
    return `<div class="storyboard-cell"><div class="storyboard-cell-empty">${desc}</div></div>`;
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
