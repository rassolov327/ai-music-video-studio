// ---------- init ----------
function goHome(){
  document.querySelectorAll('.item.selected').forEach(el=>el.classList.remove('selected'));
  pausePlayback();
  refreshMainPreview();
}
(async function(){
  const restored = await initProjectStore();
  if(!restored){
    renderAssets();
    renderTimelineScenes();
    refreshMainPreview();
  }
})();
document.getElementById('homeBtn').onclick = goHome;
document.getElementById('playBtn2').onclick = startPlayback;
document.getElementById('pauseBtn2').onclick = pausePlayback;
document.getElementById('stopBtn2').onclick = stopPlayback;
updateTransportButtons();
document.getElementById('modeAssemblyBtn').onclick = ()=>{
  timelineMode = 'assembly';
  document.getElementById('modeAssemblyBtn').classList.add('active');
  document.getElementById('modeEditBtn').classList.remove('active');
  renderTimelineScenes();
};
document.getElementById('modeEditBtn').onclick = ()=>{
  timelineMode = 'edit';
  document.getElementById('modeEditBtn').classList.add('active');
  document.getElementById('modeAssemblyBtn').classList.remove('active');
  renderTimelineScenes();
};
window.addEventListener('keydown', (e)=>{
  const tag = document.activeElement && document.activeElement.tagName;
  const inField = tag==='INPUT' || tag==='TEXTAREA' || tag==='SELECT' || (document.activeElement && document.activeElement.isContentEditable);
  if(e.code==='Space'){
    if(inField) return;
    e.preventDefault();
    if(isPlaying) pausePlayback(); else startPlayback();
  } else if(e.code==='Escape'){
    if(inField){ document.activeElement.blur(); return; }
    goHome();
  }
});
window.addEventListener('resize', drawWave);
