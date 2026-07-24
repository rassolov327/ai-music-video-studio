// ---------- Check Project — consistency/dependency audit ----------
// Read-only: never mutates state. Everything here is checking data that already exists,
// specifically the things that matter once real (paid) AI generation is wired in — a
// missing reference card or a dangling id costs real money on every shot, not just a
// cosmetic gap the way it does with free Pollinations previews.

function runProjectCheck(){
  const findings = []; // { section, name, status: 'ok'|'warn'|'error', message }
  const push = (section, name, status, message)=> findings.push({ section, name, status, message });

  const bandCat = state.categories.find(c=>c.key==='band');
  const characters = bandCat ? bandCat.items : [];
  const locCat = state.categories.find(c=>c.key==='locations');
  const locations = locCat ? locCat.items : [];
  const propCat = state.categories.find(c=>c.key==='props');
  const props = propCat ? propCat.items : [];
  const looksCat = state.categories.find(c=>c.key==='looks');
  const looks = looksCat ? looksCat.items : [];

  // Which characters/props/looks are actually used anywhere, and which characters have at
  // least one look assigned to them in some scene — computed once, used by several checks.
  const usedCharIds = new Set();
  const usedPropIds = new Set();
  const usedLookIds = new Set();
  const charHasAssignedLook = new Set();
  state.scenes.forEach(scene=>{
    (scene.characters||[]).forEach(entry=>{
      usedCharIds.add(entry.characterId);
      if(entry.lookId){ usedLookIds.add(entry.lookId); charHasAssignedLook.add(entry.characterId); }
    });
    (scene.props||[]).forEach(id=> usedPropIds.add(id));
  });

  // ---- Characters ----
  push('Characters', '', 'section', characters.length + ' character(s)');
  if(characters.length===0){
    push('Characters', '—', 'warn', 'No characters created yet.');
  }
  const charNameCounts = {};
  characters.forEach(c=>{ charNameCounts[c.name] = (charNameCounts[c.name]||0)+1; });
  characters.forEach(c=>{
    const usedHere = usedCharIds.has(c.id);
    if(!c.description || !c.role){
      push('Characters', c.name, 'warn', 'Missing role or description — generation prompts will be thinner for this character.');
    }
    const coreDone = typeof filledCoreAngleCount==='function' ? filledCoreAngleCount(c.angleSlots) >= coreAngleCountTotal() : false;
    if(!coreDone){
      push('Characters', c.name, usedHere ? 'error' : 'warn', 'Reference angles incomplete — ' + (usedHere ? 'this character IS used in a scene, so every generated shot risks looking like a different person.' : 'not used in any scene yet, but will need this before it can be used.'));
    } else if(!c.referenceCard){
      push('Characters', c.name, usedHere ? 'error' : 'warn', 'AI reference card not generated yet — open the character and click Generate.');
    } else {
      push('Characters', c.name, 'ok', 'Reference card ready — will stay consistent across shots.');
    }
    if(charNameCounts[c.name] > 1){
      push('Characters', c.name, 'warn', 'Another character shares this exact name — prompts may get confused between them.');
    }
    if(!usedHere){
      push('Characters', c.name, 'warn', 'Not assigned to any scene — sitting unused.');
    }
  });

  // ---- Locations ----
  push('Locations', '', 'section', locations.length + ' location(s)');
  const usedLocNames = new Set(state.scenes.map(s=>s.location).filter(Boolean));
  locations.forEach(l=>{
    const usedHere = usedLocNames.has(l.name);
    if(!l.referenceCard){
      push('Locations', l.name, usedHere ? 'error' : 'warn', 'AI reference card not generated yet' + (usedHere ? ' — this location IS used in a scene.' : '.'));
    } else {
      push('Locations', l.name, 'ok', 'Reference card ready.');
    }
    if(!usedHere) push('Locations', l.name, 'warn', 'Not assigned to any scene — sitting unused.');
  });

  // ---- Props ----
  push('Props', '', 'section', props.length + ' prop(s)');
  props.forEach(p=>{
    const usedHere = usedPropIds.has(p.id);
    if(!p.referenceCard){
      push('Props', p.name, usedHere ? 'error' : 'warn', 'AI reference card not generated yet' + (usedHere ? ' — this prop IS used in a scene.' : '.'));
    } else {
      push('Props', p.name, 'ok', 'Reference card ready.');
    }
    if(!usedHere) push('Props', p.name, 'warn', 'Not assigned to any scene — sitting unused.');
  });

  // ---- Looks ----
  push('Looks', '', 'section', looks.length + ' look(s)');
  looks.forEach(l=>{
    const usedHere = usedLookIds.has(l.id);
    if(!l.approved && usedHere){
      push('Looks', l.name, 'error', 'Assigned in a scene but never approved — approve it or the outfit reference is incomplete.');
    } else if(!l.approved){
      push('Looks', l.name, 'warn', 'Not approved yet.');
    } else if(!usedHere){
      push('Looks', l.name, 'warn', 'Approved but not assigned to any character in any scene.');
    } else {
      push('Looks', l.name, 'ok', 'Approved and in use.');
    }
  });

  // ---- Scenes & shots ----
  push('Scenes', '', 'section', state.scenes.length + ' scene(s)');
  state.scenes.forEach(scene=>{
    if(!scene.location){
      push('Scenes', scene.name, 'warn', 'No location set — each shot may generate a different setting.');
    } else if(!locations.some(l=>l.name===scene.location)){
      push('Scenes', scene.name, 'error', 'Location "' + scene.location + '" no longer exists (deleted after being assigned).');
    }
    (scene.characters||[]).forEach(entry=>{
      const c = characters.find(x=>x.id===entry.characterId);
      if(!c){
        push('Scenes', scene.name, 'error', 'References a character that no longer exists (id ' + entry.characterId + ') — remove and re-add it in Scene settings.');
        return;
      }
      const approvedLooks = looks.filter(l=>l.approved);
      if(!entry.lookId && approvedLooks.length){
        push('Scenes', scene.name, 'warn', c.name + ' has no look assigned here — outfit may drift between shots even though approved looks exist.');
      } else if(entry.lookId && !looks.some(l=>l.id===entry.lookId)){
        push('Scenes', scene.name, 'error', c.name + '\'s assigned look no longer exists (deleted after being assigned).');
      }
    });
    (scene.props||[]).forEach(propId=>{
      if(!props.some(p=>p.id===propId)){
        push('Scenes', scene.name, 'error', 'References a prop that no longer exists (id ' + propId + ') — remove and re-add it in Scene settings.');
      }
    });
    if(!scene.shots || scene.shots.length===0){
      push('Scenes', scene.name, 'warn', 'No shots in this scene yet.');
    } else {
      scene.shots.forEach(shot=>{
        if(!shot.description || !shot.description.trim()){
          push('Scenes', scene.name + ' — ' + shot.name, 'warn', 'No description — generation prompt for this shot will be thin/generic.');
        }
      });
    }
  });

  return findings;
}

function showCheckReport(){
  const findings = runProjectCheck();
  const log = document.getElementById('checkLog');
  const summary = document.getElementById('checkSummary');
  const screen = document.getElementById('checkReportScreen');
  if(!log || !screen) return;

  log.innerHTML = '';
  let okCount=0, warnCount=0, errorCount=0;
  findings.forEach(f=>{
    if(f.status==='ok') okCount++;
    else if(f.status==='warn') warnCount++;
    else if(f.status==='error') errorCount++;
    const line = document.createElement('div');
    line.className = 'loading-line ' + f.status;
    const dotChar = f.status==='section' ? '' : f.status==='ok' ? '✓' : f.status==='warn' ? '!' : '✗';
    const label = f.status==='section' ? f.message : (f.name ? f.name + ' — ' : '') + f.message;
    line.innerHTML = '<span class="dot3">' + dotChar + '</span><span class="msg"></span>';
    line.querySelector('.msg').textContent = label;
    log.appendChild(line);
  });
  if(findings.length===0){
    log.innerHTML = '<div class="loading-line ok"><span class="dot3">✓</span><span class="msg">Nothing to check yet — the project is empty.</span></div>';
  }
  summary.innerHTML = `
    <span class="cs-item cs-ok"><span class="cs-count">${okCount}</span> ready</span>
    <span class="cs-item cs-warn"><span class="cs-count">${warnCount}</span> warnings</span>
    <span class="cs-item cs-error"><span class="cs-count">${errorCount}</span> errors</span>
  `;
  screen.classList.remove('hidden');
}

function wireCheckReport(){
  const btn = document.getElementById('checkCloseBtn');
  if(btn) btn.onclick = ()=> document.getElementById('checkReportScreen').classList.add('hidden');
}
