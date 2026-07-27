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

// ---------- render engine (ffmpeg.wasm) — loaded lazily, only when Rendering is clicked ----------
let ffmpegInstance = null;
let ffmpegLoadingPromise = null;
let ffmpegFetchFile = null;

async function ensureFFmpegLoaded(onStatus){
  if(ffmpegInstance) return ffmpegInstance;
  if(!ffmpegLoadingPromise){
    ffmpegLoadingPromise = (async ()=>{
      console.log('[render] step 1: importing @ffmpeg/ffmpeg…');
      if(onStatus) onStatus('Loading render engine — step 1 of 4 (fetching library)…');
      const { FFmpeg } = await import('https://cdn.jsdelivr.net/npm/@ffmpeg/ffmpeg@0.12.15/+esm');
      console.log('[render] step 1 done. step 2: importing @ffmpeg/util…');
      if(onStatus) onStatus('Loading render engine — step 2 of 4 (fetching helpers)…');
      const { fetchFile, toBlobURL } = await import('https://cdn.jsdelivr.net/npm/@ffmpeg/util@0.12.2/+esm');
      ffmpegFetchFile = fetchFile;
      console.log('[render] step 2 done. step 3: downloading core+worker (~30MB)…');
      if(onStatus) onStatus('Loading render engine — step 3 of 4 (downloading ~30MB core)…');
      const ffmpeg = new FFmpeg();
      ffmpeg.on('log', ({ message })=> console.log('[ffmpeg]', message));
      const baseURL = 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/umd';
      const ffmpegPkgURL = 'https://cdn.jsdelivr.net/npm/@ffmpeg/ffmpeg@0.12.15/dist/esm';
      const coreURL = await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript');
      console.log('[render] core.js fetched, fetching wasm binary (the big one)…');
      const wasmURL = await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm');
      console.log('[render] wasm fetched, fetching worker script…');
      const classWorkerURL = await toBlobURL(`${ffmpegPkgURL}/worker.js`, 'text/javascript');
      console.log('[render] step 3 done. step 4: starting the engine itself…');
      if(onStatus) onStatus('Loading render engine — step 4 of 4 (starting engine)…');
      await ffmpeg.load({ coreURL, wasmURL, classWorkerURL });
      console.log('[render] engine fully loaded.');
      ffmpegInstance = ffmpeg;
      return ffmpeg;
    })();
  }
  try{
    return await ffmpegLoadingPromise;
  } catch(err){
    console.error('[render] engine load failed at whichever step is last logged above:', err);
    ffmpegLoadingPromise = null; // let a later attempt retry instead of staying stuck on a failed load
    throw err;
  }
}

function evenize(n){ return Math.max(2, Math.round(n / 2) * 2); } // libx264 needs even width/height

function getRenderResolution(){
  const select = document.getElementById('renderResolutionSelect');
  const meta = state.projectMeta || { width:1920, height:1080 };
  if(!select || select.value==='project') return { width: meta.width, height: meta.height };
  const [w, h] = select.value.split('x').map(Number);
  return { width: w, height: h };
}

function setRenderProgress(fraction){
  const wrap = document.getElementById('renderProgressWrap');
  const fill = document.getElementById('renderProgressFill');
  if(wrap) wrap.classList.remove('hidden');
  if(fill) fill.style.width = Math.round(Math.max(0, Math.min(1, fraction)) * 100) + '%';
}
function hideRenderProgress(){
  const wrap = document.getElementById('renderProgressWrap');
  if(wrap) wrap.classList.add('hidden');
}
function setRenderStatus(text, isError){
  const statusEl = document.getElementById('renderStatusHint');
  if(!statusEl) return;
  statusEl.textContent = text;
  statusEl.style.color = isError ? 'var(--danger)' : 'var(--text-2)';
}

async function startRender(){
  const entries = typeof collectAllShotsInOrder==='function' ? collectAllShotsInOrder() : [];
  if(entries.length===0){ setRenderStatus('Nothing on the timeline yet — add scenes and shots first.', true); return; }
  if(!renderDestDirHandle){ setRenderStatus('Choose a destination folder first — rendering can\'t start without one.', true); return; }
  const rawFileName = (document.getElementById('renderFileNameInput').value || '').trim();
  if(!rawFileName){ setRenderStatus('Give the file a name first.', true); return; }
  const missing = entries.find(e=> !e.shot.previewImage);
  if(missing){
    setRenderStatus('"' + missing.shot.name + '" in ' + missing.scene.name + ' has no generated picture yet — every shot needs one before rendering.', true);
    return;
  }
  const fileName = rawFileName.replace(/\.mp4$/i, '');

  const startBtn = document.getElementById('renderStartBtn');
  startBtn.disabled = true;
  const quality = RENDER_QUALITY_PRESETS[renderQuality];
  const { width, height } = getRenderResolution();
  const evenW = evenize(width), evenH = evenize(height);
  const fps = (state.projectMeta && state.projectMeta.fps) || 25;

  try{
    setRenderProgress(0);
    const ffmpeg = await ensureFFmpegLoaded((msg)=> setRenderStatus(msg));
    setRenderStatus('Normalizing ' + entries.length + ' shot(s)…');

    // Every shot gets scaled/padded to the SAME resolution+fps+codec first (a still image
    // extended to its own duration, a video clip trimmed to its in-point+duration) — doing
    // this per-shot keeps each ffmpeg call small and light on memory, rather than one giant
    // filter graph across everything at once, which is what tends to crash or crawl.
    const scaleFilter = `scale=${evenW}:${evenH}:force_original_aspect_ratio=decrease,pad=${evenW}:${evenH}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1`;
    const segFiles = [];
    for(let i=0; i<entries.length; i++){
      const { shot } = entries[i];
      const segName = 'seg' + i + '.mp4';
      if(shot.videoUrl){
        await ffmpeg.writeFile('src.mp4', await ffmpegFetchFile(shot.videoUrl));
        await ffmpeg.exec([
          '-ss', String(shot.trimInSec || 0), '-i', 'src.mp4', '-t', String(shot.duration),
          '-vf', scaleFilter, '-r', String(fps),
          '-c:v', 'libx264', '-crf', String(quality.crf), '-preset', quality.preset,
          '-pix_fmt', 'yuv420p', '-an', segName,
        ]);
        await ffmpeg.deleteFile('src.mp4');
      } else {
        await ffmpeg.writeFile('src.png', await ffmpegFetchFile(shot.previewImage));
        await ffmpeg.exec([
          '-loop', '1', '-i', 'src.png', '-t', String(shot.duration),
          '-vf', scaleFilter, '-r', String(fps),
          '-c:v', 'libx264', '-crf', String(quality.crf), '-preset', quality.preset,
          '-pix_fmt', 'yuv420p', segName,
        ]);
        await ffmpeg.deleteFile('src.png');
      }
      segFiles.push(segName);
      setRenderProgress((i + 1) / (entries.length + 2) * 0.85);
      setRenderStatus('Normalizing shot ' + (i + 1) + ' of ' + entries.length + '…');
    }

    setRenderStatus('Joining shots…');
    await ffmpeg.writeFile('concat.txt', segFiles.map(f=> "file '" + f + "'").join('\n'));
    await ffmpeg.exec(['-f', 'concat', '-safe', '0', '-i', 'concat.txt', '-c', 'copy', 'joined.mp4']);
    setRenderProgress(0.9);

    // Audio comes only from the timeline's own music track — nothing baked into any video
    // shot is used, per the plan.
    let finalName = 'joined.mp4';
    const track = typeof getActiveTrack==='function' ? getActiveTrack() : null;
    if(track && track.audioUrl){
      setRenderStatus('Mixing in the music track…');
      await ffmpeg.writeFile('music.src', await ffmpegFetchFile(track.audioUrl));
      const trimIn = (state.timelineAudio && state.timelineAudio.trimIn) || 0;
      const volume = (state.timelineAudio && typeof state.timelineAudio.volume==='number') ? state.timelineAudio.volume : 1;
      const audioArgs = ['-i', 'joined.mp4'];
      if(trimIn) audioArgs.push('-ss', String(trimIn));
      audioArgs.push('-i', 'music.src',
        '-map', '0:v', '-map', '1:a',
        '-c:v', 'copy', '-af', 'volume=' + volume, '-c:a', 'aac', '-b:a', quality.audioBitrate,
        'final.mp4');
      await ffmpeg.exec(audioArgs);
      finalName = 'final.mp4';
    }
    setRenderProgress(0.97);

    setRenderStatus('Saving to disk…');
    const data = await ffmpeg.readFile(finalName);
    const outHandle = await renderDestDirHandle.getFileHandle(fileName + '.mp4', { create:true });
    const writable = await outHandle.createWritable();
    await writable.write(data.buffer);
    await writable.close();

    setRenderProgress(1);
    setRenderStatus('Done — saved "' + fileName + '.mp4" to "' + renderDestDirHandle.name + '".');
  } catch(err){
    console.error('[render] failed:', err);
    setRenderStatus('Render failed: ' + (err && err.message || err), true);
  } finally {
    startBtn.disabled = false;
    setTimeout(hideRenderProgress, 4000);
  }
}
