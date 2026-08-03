// ---------- ARCHIVE page — permanent record of every successful generation ----------
let archiveOpenEntryId = null; // which archive entry the preview/new-idea modals are currently about

// Playback state for audio tiles — only one plays at a time, clicking the tile (or its
// play/stop icon) toggles it. A single shared <audio> element is reused rather than
// creating a new one per tile.
let archiveAudioPlayer = null;
let archiveAudioPlayingId = null;
function toggleArchiveAudioPlayback(entryId){
  const entry = (state.archive||[]).find(e=> e.id===entryId);
  if(!entry || !entry.isAudio || !entry.photo) return;
  if(archiveAudioPlayingId === entryId){
    if(archiveAudioPlayer) archiveAudioPlayer.pause();
    archiveAudioPlayingId = null;
    renderArchiveGrid();
    return;
  }
  if(archiveAudioPlayer){ archiveAudioPlayer.pause(); }
  archiveAudioPlayer = new Audio(entry.photo);
  archiveAudioPlayer.play().catch(()=>{});
  archiveAudioPlayingId = entryId;
  archiveAudioPlayer.onended = ()=>{
    if(archiveAudioPlayingId === entryId){ archiveAudioPlayingId = null; renderArchiveGrid(); }
  };
  renderArchiveGrid();
}

function wireArchivePage(){
  const closeArchivePreview = ()=>{
    document.getElementById('archivePreviewModal').classList.add('hidden');
    const videoEl = document.getElementById('archivePreviewVideo');
    if(videoEl) videoEl.pause();
  };
  document.getElementById('archivePreviewClose').onclick = closeArchivePreview;
  document.getElementById('archivePreviewModal').addEventListener('click', (e)=>{
    if(e.target.id==='archivePreviewModal') closeArchivePreview();
  });
  document.getElementById('archiveNewIdeaBtn').onclick = openNewIdeaModal;

  document.getElementById('newIdeaClose').onclick = closeNewIdeaModal;
  document.getElementById('newIdeaCancelBtn').onclick = closeNewIdeaModal;
  document.getElementById('newIdeaModal').addEventListener('click', (e)=>{
    if(e.target.id==='newIdeaModal') closeNewIdeaModal();
  });
  document.getElementById('newIdeaSendBtn').onclick = sendNewIdea;

  document.getElementById('archiveUploadBtn').onclick = ()=> document.getElementById('archiveUploadInput').click();
  document.getElementById('archiveUploadInput').onchange = async ()=>{
    const fileInput = document.getElementById('archiveUploadInput');
    const file = fileInput.files[0];
    if(!file) return;
    try{
      if(file.type && file.type.indexOf('audio/')===0){
        await archiveUploadedAudio(file);
      } else {
        const dataUrl = await loadImageAsDataURL(file);
        await archiveUploadedImage(dataUrl, file.name);
      }
      renderArchiveGrid();
      renderAssets();
    } catch(err){
      alert('Could not add that file: ' + err.message);
    }
    fileInput.value = '';
  };
}

function drawArchiveWaveform(canvas, peaks){
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if(w===0 || h===0) return;
  canvas.width = w*dpr; canvas.height = h*dpr;
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = '#3f6b4f';
  const total = peaks.length;
  const step = 3;
  const bars = Math.floor(w/step);
  for(let i=0; i<bars; i++){
    const idx = Math.floor((i/bars) * total);
    const amp = peaks[Math.min(idx, total-1)] || 0;
    const bh = Math.max(2, amp*h*0.8);
    ctx.fillRect(i*step, (h-bh)/2, 2, bh);
  }
}
function videoModelResolution(modelId){
  if(!modelId) return null;
  return modelId.indexOf('standard')>=0 ? '720p (1280×720)' : '1080p (1920×1080)';
}

function renderArchiveGrid(){
  const grid = document.getElementById('archiveGrid');
  if(!grid) return;
  const entries = (state.archive || []).slice().sort((a,b)=> b.createdAt - a.createdAt);
  if(entries.length===0){
    grid.innerHTML = `<div class="tasks-empty">Nothing generated yet. Successful generations land here permanently, for reuse later.</div>`;
    return;
  }
  grid.innerHTML = entries.map(entry=>{
    const showInsert = true; // every archive entry can be inserted as a shot now, no exceptions
    return `
      <div class="task-tile" data-archive-id="${entry.id}">
        <div class="task-tile-thumb">
          ${entry.isAudio ? `<canvas class="archive-wave-canvas" data-wave-for="${entry.id}"></canvas>`
            : entry.photo ? (entry.isVideo ? `<video src="${entry.photo}" muted loop autoplay playsinline></video>` : `<img src="${entry.photo}">`) : '<div class="task-tile-spin"></div>'}
          ${entry.isAudio ? `<div class="archive-audio-playbtn" data-audio-play="${entry.id}" title="${archiveAudioPlayingId===entry.id ? 'Stop' : 'Play'}">${archiveAudioPlayingId===entry.id
            ? '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="1.5"></rect></svg>'
            : '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><polygon points="6 4 20 12 6 20 6 4"></polygon></svg>'}</div>` : ''}
          ${showInsert ? `<div class="task-tile-insert" title="Insert as a new shot at the playhead"><svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><polyline points="19 12 12 19 5 12"></polyline></svg></div>` : ''}
          ${entry.isVideo ? `<div class="archive-info-icon" title="Video info"><svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="11"></line><circle cx="12" cy="8" r="0.6" fill="currentColor" stroke="none"></circle></svg></div>` : ''}
          <div class="task-tile-trash" title="Remove from archive"><svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"></path><path d="M10 11v6"></path><path d="M14 11v6"></path></svg></div>
        </div>
        <div class="task-tile-body">
          <div class="task-tile-scene">${entry.sourceLabel || ''}</div>
          <div class="task-tile-model">${entry.model || (entry.isAudio ? (entry.duration ? Math.round(entry.duration) + 's audio' : 'audio') : '')}</div>
        </div>
      </div>`;
  }).join('');

  grid.querySelectorAll('[data-wave-for]').forEach(canvas=>{
    const entry = entries.find(e=> e.id===canvas.dataset.waveFor);
    if(entry && entry.peaks) requestAnimationFrame(()=> drawArchiveWaveform(canvas, entry.peaks));
  });

  grid.querySelectorAll('.task-tile').forEach(tile=>{
    const id = tile.dataset.archiveId;
    const entry = entries.find(e=> e.id===id);
    const trashBtn = tile.querySelector('.task-tile-trash');
    if(trashBtn){
      trashBtn.onclick = (e)=>{
        e.stopPropagation();
        deleteArchiveEntry(id);
      };
    }
    const infoIcon = tile.querySelector('.archive-info-icon');
    if(infoIcon && entry){
      infoIcon.onclick = (e)=>{
        e.stopPropagation();
        const existing = tile.querySelector('.archive-meta-popover');
        if(existing){ existing.remove(); return; }
        document.querySelectorAll('.archive-meta-popover').forEach(p=> p.remove());
        const pop = document.createElement('div');
        pop.className = 'archive-meta-popover';
        pop.innerHTML = `
          <div class="row"><span class="k">Model</span><span>${entry.model || '—'}</span></div>
          <div class="row"><span class="k">Resolution</span><span>${videoModelResolution(entry.model) || '—'}</span></div>
          <div class="row"><span class="k">Frame rate</span><span>30 fps</span></div>
          <div class="row"><span class="k">Duration</span><span>${entry.duration ? entry.duration + 's' : '—'}</span></div>`;
        tile.querySelector('.task-tile-thumb').appendChild(pop);
        const closeOnOutside = (ev)=>{
          if(!pop.contains(ev.target) && ev.target!==infoIcon){ pop.remove(); document.removeEventListener('click', closeOnOutside); }
        };
        setTimeout(()=> document.addEventListener('click', closeOnOutside), 0);
      };
    }
    const playBtn = tile.querySelector('.archive-audio-playbtn');
    if(playBtn){
      playBtn.onclick = (e)=>{
        e.stopPropagation();
        toggleArchiveAudioPlayback(id);
      };
    }
    const insertBtn = tile.querySelector('.task-tile-insert');
    if(insertBtn){
      insertBtn.onclick = (e)=>{
        e.stopPropagation();
        if(entry && entry.isAudio){
          insertArchiveAudioToVoiceTrack(id);
          return;
        }
        insertArchiveEntryAtPlayhead(id);
      };
    }
    tile.onclick = ()=>{
      if(entry && entry.isAudio){ toggleArchiveAudioPlayback(id); return; }
      openArchivePreview(id);
    };
  });
}

// Places an archive audio entry as a new block on a voice track, positioned at the current
// playhead — the first voice track is used (auto-created if none exists yet); picking a
// specific track when several exist is left for later, since nothing yet distinguishes
// which track the user "means."
function insertArchiveAudioToVoiceTrack(entryId){
  const entry = (state.archive||[]).find(e=> e.id===entryId);
  if(!entry || !entry.isAudio || !entry.photo) return;
  state.voiceTracks = state.voiceTracks || [];
  if(state.voiceTracks.length === 0){
    if(typeof addVoiceTrack==='function') addVoiceTrack();
    else state.voiceTracks.push({ id:'vt'+(voiceBlockSeq), name:'Voice 1', volume:1, blocks:[] });
  }
  const track = state.voiceTracks[0];
  track.blocks = track.blocks || [];
  const startSec = (typeof playheadX==='number' && typeof PX_PER_SEC==='number' && PX_PER_SEC>0) ? playheadX / PX_PER_SEC : 0;
  track.blocks.push({
    id: 'vb' + (voiceBlockSeq++),
    archiveEntryId: entry.id,
    startSec,
    durationSec: entry.duration || 5,
    trimIn: 0,
    volume: 1,
  });
  if(typeof renderTimeline==='function') renderTimeline();
  if(typeof saveProjectSoon==='function') saveProjectSoon();
}

async function deleteArchiveEntry(entryId){
  const entry = (state.archive||[]).find(e=> e.id===entryId);
  if(!entry) return;
  if(typeof deleteGeneratedAssetImage==='function') await deleteGeneratedAssetImage(entry, 'archive', 'photo');
  state.archive = (state.archive||[]).filter(e=> e.id!==entryId);
  renderArchiveGrid();
  if(typeof saveProjectSoon==='function') saveProjectSoon();
}

function openArchivePreview(entryId){
  const entry = (state.archive||[]).find(a=> a.id===entryId);
  if(!entry || !entry.photo) return;
  if(entry.isAudio) return; // preview modal is image/video-only for now; audio has no preview yet
  archiveOpenEntryId = entryId;
  const imgEl = document.getElementById('archivePreviewImg');
  const videoEl = document.getElementById('archivePreviewVideo');
  const newIdeaBtn = document.getElementById('archiveNewIdeaBtn');
  if(entry.isVideo){
    videoEl.src = entry.photo;
    videoEl.classList.remove('hidden');
    imgEl.classList.add('hidden');
    imgEl.src = '';
    newIdeaBtn.style.display = 'none'; // built around using an image as a reference, not a video
  } else {
    imgEl.src = entry.photo;
    imgEl.classList.remove('hidden');
    videoEl.classList.add('hidden');
    videoEl.pause();
    videoEl.src = '';
    newIdeaBtn.style.display = '';
  }
  document.getElementById('archivePreviewModal').classList.remove('hidden');
}

// "New idea" — take an already-generated image as a reference and ask for a variation
// (e.g. a wide shot already exists, now generate a close-up of the same character) without
// creating a brand new shot to hold the request.
async function openNewIdeaModal(){
  const entry = (state.archive||[]).find(a=> a.id===archiveOpenEntryId);
  if(!entry) return;
  document.getElementById('archivePreviewModal').classList.add('hidden');
  document.getElementById('newIdeaRefImg').src = entry.photo;
  document.getElementById('newIdeaPromptInput').value = '';

  const select = document.getElementById('newIdeaModelSelect');
  const refModels = modelOptions.filter(m=> m.supportsReferenceImage);
  const hint = document.getElementById('newIdeaModelHint');
  if(refModels.length===0){
    select.innerHTML = `<option>No reference-capable model available</option>`;
    select.disabled = true;
    hint.textContent = 'None of the connected models currently support generating from a reference image.';
  } else {
    select.disabled = false;
    select.innerHTML = refModels.map(m=> `<option value="${m.id}">${m.label}${m.costUsd?' — '+formatCost(m.costUsd):''}</option>`).join('');
    hint.textContent = 'This always uses the image above as a reference, so only reference-capable models are offered.';
  }

  document.getElementById('newIdeaModal').classList.remove('hidden');
  wireAiAssistButton('newIdeaAssistBtn', 'newIdeaPromptInput',
    'Rewrite this rough idea into a vivid, specific instruction for an AI image editor that will use the earlier image as a reference — describe only what should change (e.g. framing, angle, action). Reply with only the rewritten instruction, nothing else.',
    ()=>{});
  if(typeof wireTagAutocomplete==='function') wireTagAutocomplete('newIdeaPromptInput');
}

function closeNewIdeaModal(){
  document.getElementById('newIdeaModal').classList.add('hidden');
}

async function sendNewIdea(){
  const entry = (state.archive||[]).find(a=> a.id===archiveOpenEntryId);
  const select = document.getElementById('newIdeaModelSelect');
  const prompt = document.getElementById('newIdeaPromptInput').value.trim();
  if(!entry || select.disabled) return;
  if(!prompt){ alert('Describe what should be different first.'); return; }

  state.taskQueue = state.taskQueue || [];
  state.taskQueue.push({
    id: 'dt' + (draftTaskSeq++),
    kind: 'archive-derive',
    archiveEntryId: entry.id,
    assetName: 'New idea from ' + (entry.sourceLabel || 'archive'),
    promptOverride: prompt,
    model: select.value,
    createdAt: Date.now(),
  });
  if(typeof saveProjectSoon==='function') saveProjectSoon();
  closeNewIdeaModal();
  showPage('tasks');
}

// Drops an archived image straight onto the timeline as a brand-new shot, inserted right
// where the playhead currently sits in its scene.
// Grabs an early frame from a video as a data: URL, purely for the timeline thumbnail — a
// normally-animated shot always has both a still (from its original generation) and a video
// (from MOVIE), so a shot inserted straight from an archived video should look the same,
// not show up blank on the timeline.
function extractVideoFrameAsDataUrl(videoSrc){
  return new Promise((resolve, reject)=>{
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';
    video.src = videoSrc;
    const onReady = ()=>{
      try{
        const canvas = document.createElement('canvas');
        canvas.width = video.videoWidth || 640;
        canvas.height = video.videoHeight || 360;
        canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', 0.85));
      } catch(err){ reject(err); }
    };
    video.addEventListener('loadeddata', onReady, { once:true });
    video.addEventListener('error', ()=> reject(new Error('Could not load the video to grab a thumbnail.')), { once:true });
  });
}

async function insertArchiveEntryAtPlayhead(entryId){
  const entry = (state.archive||[]).find(a=> a.id===entryId);
  if(!entry || !entry.photo) return;
  if(!focus.sceneId){
    alert('Select a scene on the timeline first — the new shot needs somewhere to go.');
    return;
  }
  const scene = state.scenes.find(s=> s.id===focus.sceneId);
  if(!scene){ alert('That scene no longer exists.'); return; }
  const currentIdx = focus.shotId ? scene.shots.findIndex(sh=> sh.id===focus.shotId) : -1;
  const insertIdx = currentIdx>=0 ? currentIdx+1 : scene.shots.length;

  showPage('work');
  addShotAt(scene.id, insertIdx);
  const newShot = scene.shots.find(sh=> sh.id===focus.shotId);
  if(!newShot) return;

  if(entry.isVideo){
    // Same rule MOVIE already enforces: a clip's slot on the timeline can never exceed the
    // clip's own length.
    newShot.duration = typeof MOVIE_CLIP_DURATION_SEC!=='undefined' ? MOVIE_CLIP_DURATION_SEC : 5;
    try{
      const frameDataUrl = await extractVideoFrameAsDataUrl(entry.photo);
      await persistShotPreviewImage(newShot, frameDataUrl);
    } catch(err){
      console.warn('[archive] could not grab a thumbnail frame from the video, inserting without one:', err);
    }
    await persistShotVideo(newShot, entry.photo);
  } else {
    await persistShotPreviewImage(newShot, entry.photo);
  }
  renderTimelineScenes();
  refreshMainPreview();
  if(typeof saveProjectSoon==='function') saveProjectSoon();
}
