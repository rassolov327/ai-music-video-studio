// ---------- MOVIE (render) tab ----------
let renderDestDirHandle = null;
let renderQuality = 'medium';

const RENDER_QUALITY_PRESETS = {
  low:    { crf: 28, preset: 'veryfast', audioBitrate: '128k', label: 'Low — smaller file, fastest render' },
  medium: { crf: 23, preset: 'medium',   audioBitrate: '192k', label: 'Medium — balanced quality and size' },
  better: { crf: 18, preset: 'slow',     audioBitrate: '320k', label: 'Better — closest to source quality, slowest render' },
};

function wireRenderPage(){
  const fileNameInput = document.getElementById('renderFileNameInput');
  if(fileNameInput && !fileNameInput.value) fileNameInput.value = (state.projectMeta && state.projectMeta.name) || 'Untitled Project';

  document.querySelectorAll('#renderQualityRow .render-quality-btn').forEach(btn=>{
    btn.onclick = ()=>{
      renderQuality = btn.dataset.quality;
      document.querySelectorAll('#renderQualityRow .render-quality-btn').forEach(b=> b.classList.toggle('active', b===btn));
      updateRenderQualityHint();
    };
  });
  updateRenderQualityHint();

  const resSelect = document.getElementById('renderResolutionSelect');
  if(resSelect) resSelect.addEventListener('change', updateRenderResolutionHint);
  updateRenderResolutionHint();

  const folderBtn = document.getElementById('renderFolderBtn');
  if(folderBtn) folderBtn.onclick = pickRenderDestinationFolder;

  const previewTile = document.getElementById('renderPreviewTile');
  if(previewTile) previewTile.onclick = openStoryboardModal;

  const startBtn = document.getElementById('renderStartBtn');
  if(startBtn) startBtn.onclick = startRender;
}

function updateRenderQualityHint(){
  const hint = document.getElementById('renderQualityHint');
  if(hint) hint.textContent = RENDER_QUALITY_PRESETS[renderQuality].label;
}

function updateRenderResolutionHint(){
  const select = document.getElementById('renderResolutionSelect');
  const hint = document.getElementById('renderResolutionHint');
  if(!select || !hint) return;
  const meta = state.projectMeta || { width:1920, height:1080 };
  if(select.value==='project'){ hint.textContent = ''; return; }
  const [w, h] = select.value.split('x').map(Number);
  if(w * h > meta.width * meta.height){
    hint.textContent = 'Higher than your project\'s own resolution (' + meta.width + '×' + meta.height + ') — this will upscale, not add real detail.';
  } else {
    hint.textContent = '';
  }
}

async function pickRenderDestinationFolder(){
  if(!('showDirectoryPicker' in window)){
    alert('Your browser doesn\'t support choosing a folder directly. Try a recent Chrome or Edge.');
    return;
  }
  try{
    const handle = await window.showDirectoryPicker({ mode:'readwrite' });
    renderDestDirHandle = handle;
    document.getElementById('renderFolderHint').textContent = 'Saving to "' + handle.name + '"';
    document.getElementById('renderFolderHint').style.color = '#5fae7a';
  } catch(err){
    // user cancelled the picker — not an error worth surfacing
  }
}

// ---------- live storyboard preview thumbnail ----------
async function renderMoviePreviewThumbnail(){
  const canvas = document.getElementById('renderPreviewCanvas');
  const empty = document.getElementById('renderPreviewEmpty');
  if(!canvas) return;
  const entries = typeof collectAllShotsInOrder==='function' ? collectAllShotsInOrder() : [];
  if(entries.length===0){
    canvas.classList.add('hidden');
    if(empty) empty.classList.remove('hidden');
    return;
  }
  if(empty) empty.classList.add('hidden');
  canvas.classList.remove('hidden');

  const cols = 4;
  const totalWidth = 480; // small — this is just a live reference, not the export itself
  const cellW = totalWidth / cols;
  const meta = state.projectMeta || { width:1920, height:1080 };
  const cellH = Math.round(cellW * (meta.height / meta.width));
  const rows = Math.ceil(entries.length / cols);
  canvas.width = totalWidth;
  canvas.height = cellH * rows;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  for(let i=0; i<entries.length; i++){
    const { shot } = entries[i];
    const col = i % cols, row = Math.floor(i / cols);
    const x = col * cellW, y = row * cellH;
    if(shot.previewImage){
      try{
        const img = await loadImageEl(shot.previewImage);
        const scale = Math.max(cellW / img.width, cellH / img.height);
        const dw = img.width * scale, dh = img.height * scale;
        ctx.save();
        ctx.beginPath();
        ctx.rect(x, y, cellW, cellH);
        ctx.clip();
        ctx.drawImage(img, x + (cellW-dw)/2, y + (cellH-dh)/2, dw, dh);
        ctx.restore();
      } catch(err){
        drawStoryboardPlaceholder(ctx, x, y, cellW, cellH, null);
      }
    } else {
      drawStoryboardPlaceholder(ctx, x, y, cellW, cellH, null);
    }
  }
}

// ---------- render (parameter validation now; actual ffmpeg.wasm pipeline is a follow-up) ----------
async function startRender(){
  const statusEl = document.getElementById('renderStatusHint');
  const entries = typeof collectAllShotsInOrder==='function' ? collectAllShotsInOrder() : [];
  if(entries.length===0){
    statusEl.textContent = 'Nothing on the timeline yet — add scenes and shots first.';
    statusEl.style.color = 'var(--danger)';
    return;
  }
  if(!renderDestDirHandle){
    statusEl.textContent = 'Choose a destination folder first — rendering can\'t start without one.';
    statusEl.style.color = 'var(--danger)';
    return;
  }
  const fileName = (document.getElementById('renderFileNameInput').value || '').trim();
  if(!fileName){
    statusEl.textContent = 'Give the file a name first.';
    statusEl.style.color = 'var(--danger)';
    return;
  }
  // The actual ffmpeg.wasm render pipeline (normalize each shot, then concat, mix in the
  // timeline's music track) is a separate, larger piece of work still to come — this wires
  // up and validates every parameter so that piece has everything it needs to plug into.
  statusEl.style.color = 'var(--text-2)';
  statusEl.textContent = 'All settings ready — the actual render engine isn\'t wired up yet, that\'s next.';
}
