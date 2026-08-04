// ---------- Lip-sync: audio segment extraction (stage 2) ----------

let motionControlModelOptions = []; // [{id, label, costUsd, blurb}]
async function loadMotionControlModelList(){
  try{
    const res = await fetch('/api/motion-control-models');
    const data = await res.json();
    motionControlModelOptions = (data && data.models) || [];
  } catch(err){
    motionControlModelOptions = [];
  }
}
function motionControlModelSelectHtml(selectedId){
  const fallback = motionControlModelOptions[0] && motionControlModelOptions[0].id;
  const opts = motionControlModelOptions.map(m=>
    `<option value="${m.id}" title="${m.blurb || ''}" ${m.id===(selectedId||fallback)?'selected':''}>${m.label}${m.costUsd?' — '+formatCost(m.costUsd):''}</option>`
  ).join('');
  return `<select class="task-tile-model-select">${opts || '<option>No model available</option>'}</select>`;
}

// Queues a Motion Control generation — the reference video was already added to the
// Archive (as its own full-length entry) when the user picked it via the Capture flow; the
// draft just needs to remember which archive entry to pull it from at send time.
function queueMotionControlGeneration(scene, shot, archiveEntryId){
  state.taskQueue = state.taskQueue || [];
  state.taskQueue.push({
    id: 'dt' + (draftTaskSeq++), kind: 'motion-control',
    sceneId: scene.id, shotId: shot.id, sceneName: scene.name, shotName: shot.name,
    archiveEntryId,
    model: (motionControlModelOptions[0] && motionControlModelOptions[0].id) || null,
    createdAt: Date.now(),
  });
  if(typeof saveProjectSoon==='function') saveProjectSoon();
  if(typeof refreshTasks==='function') refreshTasks();
}

// The captured reference video is kept in Archive at its original, full length (it might
// get reused on a different, differently-timed shot later) — this trims a copy to exactly
// match a specific shot's duration right before sending, the same way extractShotAudioSegment
// already trims music/voice to a shot's window rather than storing pre-cut copies.
async function trimVideoToDuration(videoUrl, durationSec, onStatus){
  if(onStatus) onStatus('Loading render engine…');
  const ffmpeg = await ensureFFmpegLoaded(onStatus);
  if(onStatus) onStatus('Trimming reference video…');
  await ffmpeg.writeFile('motion_src_video', await ffmpegFetchFile(videoUrl));
  try{
    // Real re-encoding, not a stream copy — the source could be almost any format the
    // user's camera/phone produced (.mov, .webm, odd codecs), and stream-copying that
    // straight into an .mp4 container can produce a file that LOOKS like an mp4 but has a
    // codec inside the provider can't actually decode ("file format not support"). Also
    // gives frame-accurate trimming, unlike stream-copy which can only cut at keyframes.
    await ffmpeg.exec([
      '-i', 'motion_src_video', '-t', String(durationSec),
      '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2', // libx264 needs even width/height
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'fast', '-crf', '20',
      '-c:a', 'aac', '-b:a', '128k',
      '-movflags', '+faststart', // moves the mp4 metadata to the front — needed when a
      // server fetches the file by URL (our case) rather than receiving a direct upload,
      // since some backends can't read the file structure without it up front
      'motion_trimmed.mp4',
    ]);
    const data = await ffmpeg.readFile('motion_trimmed.mp4');
    return new Blob([data.buffer], { type: 'video/mp4' });
  } finally {
    try{ await ffmpeg.deleteFile('motion_src_video'); } catch(err){}
    try{ await ffmpeg.deleteFile('motion_trimmed.mp4'); } catch(err){}
  }
}
let photoLipsyncModelOptions = []; // [{id, label, costUsd, blurb}]
async function loadPhotoLipsyncModelList(){
  try{
    const res = await fetch('/api/photo-lipsync-models');
    const data = await res.json();
    photoLipsyncModelOptions = (data && data.models) || [];
  } catch(err){
    photoLipsyncModelOptions = [];
  }
}
function photoLipsyncModelSelectHtml(selectedId){
  const fallback = photoLipsyncModelOptions[0] && photoLipsyncModelOptions[0].id;
  const opts = photoLipsyncModelOptions.map(m=>
    `<option value="${m.id}" title="${m.blurb || ''}" ${m.id===(selectedId||fallback)?'selected':''}>${m.label}${m.costUsd?' — '+formatCost(m.costUsd):''}</option>`
  ).join('');
  return `<select class="task-tile-model-select">${opts || '<option>No model available</option>'}</select>`;
}

// Real entry point for the photo->singing pipeline — called the instant the timeline
// toggle is switched on (queuing happens together with reserving, per the agreed design,
// not as a separate step). Both models are queued as the SAME draft's dropdown choices —
// the user has already narrowed candidates to these two, no need for a separate pick step
// here beyond the one already in the TASKS tile itself.
function queuePhotoLipsyncGeneration(scene, shot){
  state.taskQueue = state.taskQueue || [];
  state.taskQueue.push({
    id: 'dt' + (draftTaskSeq++), kind: 'photo-lipsync',
    sceneId: scene.id, shotId: shot.id, sceneName: scene.name, shotName: shot.name,
    model: (photoLipsyncModelOptions[0] && photoLipsyncModelOptions[0].id) || null,
    createdAt: Date.now(),
  });
  if(typeof saveProjectSoon==='function') saveProjectSoon();
  if(typeof refreshTasks==='function') refreshTasks();
}
async function loadLipsyncModelList(){
  try{
    const res = await fetch('/api/lipsync-models');
    const data = await res.json();
    lipsyncModelOptions = (data && data.models) || [];
  } catch(err){
    lipsyncModelOptions = [];
  }
}
function lipsyncModelSelectHtml(selectedId){
  const fallback = lipsyncModelOptions[0] && lipsyncModelOptions[0].id;
  const opts = lipsyncModelOptions.map(m=>
    `<option value="${m.id}" title="${m.blurb || ''}" ${m.id===(selectedId||fallback)?'selected':''}>${m.label}${m.costUsd?' — '+formatCost(m.costUsd):''}</option>`
  ).join('');
  return `<select class="task-tile-model-select">${opts || '<option>No lip-sync model available</option>'}</select>`;
}

// Real stage-3 entry point — queues a lip-sync generation in TASKS (the extraction itself
// happens at send time, not here, since that's where the model gets chosen).
function queueLipsyncGeneration(scene, shot){
  state.taskQueue = state.taskQueue || [];
  state.taskQueue.push({
    id: 'dt' + (draftTaskSeq++), kind: 'lipsync',
    sceneId: scene.id, shotId: shot.id, sceneName: scene.name, shotName: shot.name,
    model: (lipsyncModelOptions[0] && lipsyncModelOptions[0].id) || null,
    createdAt: Date.now(),
  });
  if(typeof saveProjectSoon==='function') saveProjectSoon();
  if(typeof refreshTasks==='function') refreshTasks();
}

// Cuts out the slice of the timeline's music track that plays under a given shot — from
// the moment that shot starts on the timeline, for exactly its own duration — regardless
// of how long the whole song is. The track's own trimIn (where in the SOURCE file its
// timeline-position-0 begins) is folded in, so the result is always the correct absolute
// offset into the actual music file, not just the timeline-relative one.
// Gathers every audio source that's actually audible during a shot's window on the
// timeline — the music track's segment (as before) plus any voice block, on any voice
// track, whose own span overlaps the shot at all (even partially). This is stage 8 of the
// multi-track audio plan: lip-sync needs the FULL mix under a shot, not just the music.
async function extractShotAudioSegment(scene, shot, onStatus){
  const shotStartSec = getShotStartSec(scene.id, shot.id);
  const duration = shot.duration;
  const shotEndSec = shotStartSec + duration;
  const sources = []; // { url, sourceOffsetSec, clipDurationSec, delaySec, volume }

  const track = typeof getActiveTrack==='function' ? getActiveTrack() : null;
  if(track && state.timelineAudio){
    let audioUrl = track.audioUrl;
    if(!audioUrl && typeof loadAudioAsset==='function'){
      const blob = await loadAudioAsset(track.id, track.diskFileName);
      if(blob) audioUrl = URL.createObjectURL(blob);
    }
    if(audioUrl){
      const trimIn = state.timelineAudio.trimIn || 0;
      sources.push({
        url: audioUrl, sourceOffsetSec: trimIn + shotStartSec, clipDurationSec: duration,
        delaySec: 0, volume: state.timelineAudio.volume!=null ? state.timelineAudio.volume : 1,
      });
    }
  }

  (state.voiceTracks || []).forEach(vt=>{
    (vt.blocks || []).forEach(b=>{
      const bStart = b.startSec, bEnd = b.startSec + b.durationSec;
      const overlapStart = Math.max(bStart, shotStartSec);
      const overlapEnd = Math.min(bEnd, shotEndSec);
      if(overlapEnd <= overlapStart) return; // this block doesn't play during this shot
      const entry = (state.archive||[]).find(e=> e.id===b.archiveEntryId);
      if(!entry || !entry.photo) return;
      sources.push({
        url: entry.photo,
        sourceOffsetSec: (b.trimIn||0) + (overlapStart - bStart),
        clipDurationSec: overlapEnd - overlapStart,
        delaySec: overlapStart - shotStartSec, // where within the shot this block starts
        volume: b.volume!=null ? b.volume : 1,
      });
    });
  });

  if(sources.length===0) throw new Error('No music or voice audio found under this shot.');

  if(onStatus) onStatus('Loading render engine…');
  const ffmpeg = await ensureFFmpegLoaded(onStatus);
  if(onStatus) onStatus(sources.length>1 ? 'Mixing audio for this shot…' : 'Cutting audio segment…');

  // Common case — just the music track, nothing to actually mix. Same simple path as
  // before, so this can never behave differently than it already did.
  if(sources.length===1){
    const s = sources[0];
    await ffmpeg.writeFile('lipsync_src_audio', await ffmpegFetchFile(s.url));
    try{
      await ffmpeg.exec([
        '-ss', String(s.sourceOffsetSec), '-i', 'lipsync_src_audio', '-t', String(s.clipDurationSec),
        '-af', `volume=${s.volume}`,
        '-c:a', 'libmp3lame', '-q:a', '2', 'lipsync_segment.mp3',
      ]);
      const data = await ffmpeg.readFile('lipsync_segment.mp3');
      return new Blob([data.buffer], { type: 'audio/mp3' });
    } finally {
      try{ await ffmpeg.deleteFile('lipsync_src_audio'); } catch(err){}
      try{ await ffmpeg.deleteFile('lipsync_segment.mp3'); } catch(err){}
    }
  }

  // Multiple sources — build a filter graph: trim each one to its own relevant slice,
  // apply its own volume, delay it to land at the right spot within the shot, then mix
  // everything together into one output track.
  const inputArgs = [];
  const filterParts = [];
  for(let i=0; i<sources.length; i++){
    const s = sources[i];
    const fname = 'lipsync_src_' + i;
    await ffmpeg.writeFile(fname, await ffmpegFetchFile(s.url));
    inputArgs.push('-ss', String(s.sourceOffsetSec), '-t', String(s.clipDurationSec), '-i', fname);
    const delayMs = Math.max(0, Math.round(s.delaySec*1000));
    filterParts.push(`[${i}:a]volume=${s.volume},adelay=${delayMs}:all=1[a${i}]`);
  }
  const mixInputs = sources.map((_,i)=> `[a${i}]`).join('');
  const filterComplex = filterParts.join(';') + `;${mixInputs}amix=inputs=${sources.length}:duration=first:dropout_transition=0:normalize=0[mixed]`;

  try{
    await ffmpeg.exec([
      ...inputArgs,
      '-filter_complex', filterComplex,
      '-map', '[mixed]', '-t', String(duration),
      '-c:a', 'libmp3lame', '-q:a', '2', 'lipsync_segment.mp3',
    ]);
    const data = await ffmpeg.readFile('lipsync_segment.mp3');
    return new Blob([data.buffer], { type: 'audio/mp3' });
  } finally {
    for(let i=0; i<sources.length; i++){
      try{ await ffmpeg.deleteFile('lipsync_src_'+i); } catch(err){}
    }
    try{ await ffmpeg.deleteFile('lipsync_segment.mp3'); } catch(err){}
  }
}

// Stage-2 test entry point — cuts the segment for a shot and downloads it directly, so the
// extraction itself can be verified in isolation before it's wired into an actual
// lip-sync generation call.
async function testExtractShotAudioSegment(sceneId, shotId){
  const scene = state.scenes.find(s=> s.id===sceneId);
  const shot = scene && scene.shots.find(sh=> sh.id===shotId);
  if(!scene || !shot) return;
  try{
    showBgStatus('Preparing audio segment…');
    const blob = await extractShotAudioSegment(scene, shot, (msg)=> showBgStatus(msg));
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = (scene.name + '_' + shot.name).replace(/[^a-z0-9]+/gi, '_') + '_audio.mp3';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(()=> URL.revokeObjectURL(url), 5000);
    hideBgStatus();
  } catch(err){
    console.error('[lipsync] audio extraction failed:', err);
    hideBgStatus();
    alert('Could not extract the audio segment: ' + err.message);
  }
}
