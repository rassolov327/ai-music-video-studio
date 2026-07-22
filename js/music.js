// ---------- Music: gallery, upload, decoding ----------
function showMusicGallery(cat){
  pausePlayback();
  previewEl.classList.add('align-tl');
  previewEl.onclick = null;
  previewBarEl.textContent = 'Music';

  const tiles = cat.items.map((it,idx)=>`
    <div class="char-tile" data-idx="${idx}">
      <div class="char-tile-photo">
        ${noteSvg(26)}
        ${it.id && state.timelineAudio && state.timelineAudio.trackId===it.id ? '<div class="char-tile-status status-green" title="On timeline"></div>' : ''}
        <div class="char-tile-del" data-del-idx="${idx}" title="Remove">${trashSvg(13)}</div>
      </div>
      <div class="char-tile-name">${it.name}</div>
      <div class="char-tile-role">${it.fullDuration ? formatTimecode(it.fullDuration) : ''}</div>
    </div>
  `).join('');

  previewEl.innerHTML = `
    <div class="char-gallery">
      <div class="char-grid">
        ${tiles}
        <div class="char-tile char-tile-add" id="addMusicTile">
          <div class="char-tile-photo">${plusSvg(26)}</div>
          <div class="char-tile-name">Add track</div>
        </div>
      </div>
    </div>`;

  previewEl.querySelectorAll('[data-del-idx]').forEach(btn=>{
    btn.onclick = (e)=>{
      e.stopPropagation();
      const idx = parseInt(e.target.closest('[data-del-idx]').dataset.delIdx, 10);
      const removed = cat.items[idx];
      if(removed && removed.id && state.timelineAudio && state.timelineAudio.trackId===removed.id){
        state.timelineAudio = null;
      }
      if(removed && removed.audioUrl) URL.revokeObjectURL(removed.audioUrl);
      cat.items.splice(idx,1);
      renderAssets();
      renderTimeline();
      showMusicGallery(cat);
    };
  });
  document.getElementById('addMusicTile').onclick = ()=> showMusicUploadForm(cat);
}

function showMusicUploadForm(cat){
  pausePlayback();
  previewEl.classList.remove('align-tl');
  previewEl.onclick = null;
  previewBarEl.textContent = 'Add asset — Music';
  previewEl.innerHTML = `
    <div class="char-form">
      <h3>Add music track</h3>
      <p class="sub">Upload an audio file from your computer (MP3, WAV, M4A, AAC, OGG, FLAC).</p>

      <label class="photo-drop" id="musicDrop" for="musicFileInput" style="aspect-ratio:3/1;max-height:110px;">
        <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"></path><circle cx="6" cy="18" r="3"></circle><circle cx="18" cy="16" r="3"></circle></svg>
        <span id="musicDropLabel">Choose audio file</span>
      </label>
      <input type="file" id="musicFileInput" accept="audio/*,.mp3,.wav,.m4a,.aac,.ogg,.flac" style="position:absolute;width:1px;height:1px;opacity:0;overflow:hidden;">

      <label class="char-row" style="margin:4px 0 16px;">
        <input type="checkbox" id="musicAutoAdd" checked>Add to timeline automatically
      </label>

      <div id="musicUploadStatus" class="gen-hint"></div>

      <div class="cf-actions">
        <button class="cf-btn" id="musicCancel">Cancel</button>
      </div>
    </div>
  `;

  document.getElementById('musicCancel').onclick = ()=> showMusicGallery(cat);

  const fileInput = document.getElementById('musicFileInput');
  const statusEl = document.getElementById('musicUploadStatus');
  const dropLabel = document.getElementById('musicDropLabel');
  fileInput.onchange = async ()=>{
    const file = fileInput.files[0];
    if(!file) return;
    dropLabel.textContent = file.name;
    statusEl.textContent = 'Decoding audio…';
    try{
      const track = await buildMusicTrack(file);
      statusEl.textContent = 'Added — ' + formatTimecode(track.fullDuration) + ' long.';
      cat.items.push(track);
      if(document.getElementById('musicAutoAdd').checked){
        setTimelineAudioTrack(track.id);
      }
      renderAssets();
      setTimeout(()=> showMusicGallery(cat), 400);
    } catch(err){
      statusEl.textContent = 'Could not read this audio file — try a different format.';
    }
  };
}

async function buildMusicTrack(file){
  const buffer = await file.arrayBuffer();
  const AC = window.AudioContext || window.webkitAudioContext;
  const ctx = new AC();
  const decoded = await ctx.decodeAudioData(buffer.slice(0));
  const peaks = computeWavePeaks(decoded, 2000);
  const audioUrl = URL.createObjectURL(file);
  ctx.close && ctx.close();
  return {
    id: 't' + (trackSeq++),
    name: file.name,
    icon: 'ti-file-music',
    audioUrl,
    fullDuration: decoded.duration,
    peaks,
  };
}

function computeWavePeaks(audioBuffer, resolution){
  const ch0 = audioBuffer.getChannelData(0);
  const total = ch0.length;
  const bucketSize = Math.max(1, Math.floor(total/resolution));
  const peaks = new Array(Math.ceil(total/bucketSize));
  for(let i=0, p=0; i<total; i+=bucketSize, p++){
    let max = 0;
    const end = Math.min(i+bucketSize, total);
    for(let j=i; j<end; j++){
      const v = Math.abs(ch0[j]);
      if(v>max) max = v;
    }
    peaks[p] = max;
  }
  return peaks;
}

