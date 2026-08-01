// ---------- Lip-sync: audio segment extraction (stage 2) ----------

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
async function extractShotAudioSegment(scene, shot, onStatus){
  const track = typeof getActiveTrack==='function' ? getActiveTrack() : null;
  if(!track) throw new Error('No music track on the timeline.');
  let audioUrl = track.audioUrl;
  if(!audioUrl && typeof loadAudioAsset==='function'){
    const blob = await loadAudioAsset(track.id, track.diskFileName);
    if(blob) audioUrl = URL.createObjectURL(blob);
  }
  if(!audioUrl) throw new Error('Could not load the music track\'s audio.');

  const shotStartSec = getShotStartSec(scene.id, shot.id);
  const trimIn = (state.timelineAudio && state.timelineAudio.trimIn) || 0;
  const sourceOffsetSec = trimIn + shotStartSec;
  const duration = shot.duration;

  if(onStatus) onStatus('Loading render engine…');
  const ffmpeg = await ensureFFmpegLoaded(onStatus);
  if(onStatus) onStatus('Cutting audio segment…');

  await ffmpeg.writeFile('lipsync_src_audio', await ffmpegFetchFile(audioUrl));
  try{
    await ffmpeg.exec([
      '-ss', String(sourceOffsetSec), '-i', 'lipsync_src_audio', '-t', String(duration),
      '-c:a', 'libmp3lame', '-q:a', '2', 'lipsync_segment.mp3',
    ]);
    const data = await ffmpeg.readFile('lipsync_segment.mp3');
    return new Blob([data.buffer], { type: 'audio/mp3' });
  } finally {
    try{ await ffmpeg.deleteFile('lipsync_src_audio'); } catch(err){}
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
