// ---------- init ----------
function goHome(){
  document.querySelectorAll('.item.selected').forEach(el=>el.classList.remove('selected'));
  pausePlayback();
  refreshMainPreview();
}
let currentUser = null;
async function checkAuthAndMaybeGate(){
  try{
    const res = await fetch('/api/me');
    if(res.ok){
      currentUser = await res.json();
      return true;
    }
  } catch(err){}
  showLoginScreen();
  return false;
}
function showLoginScreen(){
  document.getElementById('loginScreen').classList.remove('hidden');
  document.getElementById('loginInput').focus();
  const errHint = document.getElementById('loginErrorHint');
  const submit = async ()=>{
    errHint.style.display = 'none';
    const login = document.getElementById('loginInput').value.trim();
    const password = document.getElementById('loginPasswordInput').value;
    if(!login || !password) return;
    try{
      const res = await fetch('/api/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ login, password }),
      });
      const data = await res.json().catch(()=> null);
      if(!res.ok){
        errHint.textContent = (data && data.message) || 'Could not sign in.';
        errHint.style.display = '';
        return;
      }
      // Simplest, most robust way to resume boot with a fully-authenticated state — a
      // fresh reload re-runs the whole init sequence from a clean slate rather than trying
      // to splice a login in the middle of an already-partially-initialized app.
      // Marked so the boot sequence knows this reload followed a fresh login specifically —
      // it should always land on the project picker, never auto-resume the last project.
      sessionStorage.setItem('justLoggedIn', '1');
      location.reload();
    } catch(err){
      errHint.textContent = 'Could not reach the server.';
      errHint.style.display = '';
    }
  };
  document.getElementById('loginSubmitBtn').onclick = submit;
  document.getElementById('loginPasswordInput').addEventListener('keydown', (e)=>{ if(e.key==='Enter') submit(); });
}
(async function(){
  const authed = await checkAuthAndMaybeGate();
  if(!authed) return; // login screen is showing; boot resumes via a reload after sign-in
  wireNewProjectScreen();
  wireFileMenu();
  wireProjectMenu();
  wireProjectSettingsModal();
  wireToolsMenu();
  wireCheckReport();
  wireFolderButton();
  wirePageTabs();
  wireArchivePage();
  wireCardImageModal();
  wireCreditsIndicator();
  loadModelList();
  wireMoviePage();
  loadVideoModelList();
  loadLipsyncModelList();
  loadPhotoLipsyncModelList();
  loadMotionControlModelList();
  loadVideoEditModelList();
  wireGeminiChat();
  wireScriptPage();
  wireAiGeneratorModal();
  wireMotionPromptModal();
  wireTimelineZoomControl();
  wireStoryboardPage();
  wireRenderPage();
  startBackgroundTaskWatcher();
  const justLoggedIn = sessionStorage.getItem('justLoggedIn');
  if(justLoggedIn) sessionStorage.removeItem('justLoggedIn');
  const restored = justLoggedIn ? false : await initProjectStore();
  if(restored){
    updateProjTitleDisplay();
    return;
  }
  // no last-active project — first-time visitor goes straight to New Project;
  // returning users with existing (but not "last active") projects see the list.
  const projects = await listProjects();
  if(projects.length===0){
    showNewProjectScreen();
  } else {
    showHomeScreen();
  }
})();
document.getElementById('homeBtn').onclick = goHome;
document.getElementById('goToProjectsBtn').onclick = async ()=>{
  pausePlayback();
  if(typeof currentProjectId!=='undefined' && currentProjectId) await saveProjectNow();
  showHomeScreen();
};
document.getElementById('playBtn2').onclick = startPlayback;
document.getElementById('pauseBtn2').onclick = pausePlayback;
document.getElementById('stopBtn2').onclick = stopPlayback;
updateTransportButtons();
if(typeof wirePanelResizers==='function') wirePanelResizers();
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
  } else if(e.code==='ArrowLeft' || e.code==='ArrowRight'){
    if(inField) return;
    e.preventDefault();
    stepPlayheadByFrame(e.code==='ArrowLeft' ? -1 : 1);
  } else if(e.code==='ArrowUp' || e.code==='ArrowDown'){
    if(inField) return;
    e.preventDefault();
    jumpPlayheadToCut(e.code==='ArrowDown' ? 1 : -1);
  } else if(e.key==='+' || e.key==='=' || e.code==='NumpadAdd'){
    if(inField) return;
    e.preventDefault();
    if(typeof zoomTimelineBy==='function') zoomTimelineBy(10);
  } else if(e.key==='-' || e.code==='NumpadSubtract'){
    if(inField) return;
    e.preventDefault();
    if(typeof zoomTimelineBy==='function') zoomTimelineBy(-10);
  }
});
window.addEventListener('resize', drawWave);
window.addEventListener('resize', ()=>{ if(typeof sizePreviewFrame==='function') sizePreviewFrame(); });
