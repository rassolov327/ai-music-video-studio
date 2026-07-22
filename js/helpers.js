// ---------- helpers: image loading (with TIFF decode support) ----------
function loadImageAsDataURL(file){
  return new Promise((resolve, reject)=>{
    const isTiff = /\.tiff?$/i.test(file.name) || file.type==='image/tiff' || file.type==='image/tif';
    if(isTiff && window.UTIF){
      const reader = new FileReader();
      reader.onload = ()=>{
        try{
          const buffer = reader.result;
          const ifds = UTIF.decode(buffer);
          UTIF.decodeImage(buffer, ifds[0]);
          const rgba = UTIF.toRGBA8(ifds[0]);
          const canvas = document.createElement('canvas');
          canvas.width = ifds[0].width;
          canvas.height = ifds[0].height;
          const ctx = canvas.getContext('2d');
          const imgData = ctx.createImageData(ifds[0].width, ifds[0].height);
          imgData.data.set(rgba);
          ctx.putImageData(imgData, 0, 0);
          resolve(canvas.toDataURL('image/png'));
        } catch(err){
          // fall back to a plain data URL if decoding fails
          const fr2 = new FileReader();
          fr2.onload = ()=> resolve(fr2.result);
          fr2.onerror = reject;
          fr2.readAsDataURL(file);
        }
      };
      reader.onerror = reject;
      reader.readAsArrayBuffer(file);
    } else {
      const reader = new FileReader();
      reader.onload = ()=> resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    }
  });
}
function applyNaturalAspect(el, dataUrl){
  if(!dataUrl) return;
  const img = new Image();
  img.onload = ()=>{
    if(img.naturalWidth && img.naturalHeight){
      el.style.aspectRatio = img.naturalWidth + ' / ' + img.naturalHeight;
    }
  };
  img.src = dataUrl;
}

// ---------- AI reference card (mocked KIE generation) ----------
const GEN_MODEL_LABEL = 'KIE · GPT-Image-1';
const GEN_COST_LABEL = '$0.03';
const SHOT_GEN_MODEL_LABEL = 'Pollinations.ai (free)';
const SHOT_GEN_COST_LABEL = 'Free';

// ---------- free rough-preview generation via Pollinations.ai (no key required) ----------
function buildPollinationsUrl(prompt, w, h){
  const seed = Math.floor(Math.random()*1000000);
  return `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=${w}&height=${h}&nologo=true&seed=${seed}`;
}
function tryLoadImage(url, timeoutMs){
  return new Promise((resolve, reject)=>{
    const img = new Image();
    let done = false;
    const timer = setTimeout(()=>{ if(!done){ done=true; reject(new Error('timeout')); } }, timeoutMs || 20000);
    img.onload = ()=>{ if(!done){ done=true; clearTimeout(timer); resolve(url); } };
    img.onerror = ()=>{ if(!done){ done=true; clearTimeout(timer); reject(new Error('load failed')); } };
    img.referrerPolicy = 'no-referrer';
    img.src = url;
  });
}
function buildShotPrompt(shot, scene){
  const parts = [];

  // characters (and their assigned looks) now live on the scene, inherited by every shot
  if(scene && scene.characters && scene.characters.length){
    const bandCat = state.categories.find(c=>c.key==='band');
    const chars = bandCat ? bandCat.items : [];
    const looksCat = state.categories.find(c=>c.key==='looks');
    const looks = looksCat ? looksCat.items : [];
    scene.characters.forEach(entry=>{
      const c = chars.find(x=>x.id===entry.characterId);
      if(!c) return;
      let piece = c.name;
      if(c.description) piece += ' (' + c.description + ')';
      if(entry.lookId){
        const look = looks.find(l=>l.id===entry.lookId);
        if(look && look.description) piece += ', wearing ' + look.description;
      }
      parts.push('featuring ' + piece);
    });
  }

  if(shot.description) parts.push(shot.description);
  if(shot.shotSize) parts.push(shot.shotSize.toLowerCase());
  if(shot.cameraMove && shot.cameraMove!=='Static') parts.push(shot.cameraMove.toLowerCase()+' camera movement');
  if(shot.lighting) parts.push(shot.lighting);

  // location — pull its saved description too, not just the name
  if(scene && scene.location){
    const locCat = state.categories.find(c=>c.key==='locations');
    const loc = locCat ? locCat.items.find(l=>l.name===scene.location) : null;
    parts.push('in ' + scene.location + (loc && loc.description ? ', ' + loc.description : ''));
  }
  if(scene && scene.timeOfDay) parts.push('during the ' + scene.timeOfDay.toLowerCase());

  parts.push('cinematic still frame, film grain, music video');
  return parts.join(', ');
}

function generateShotPreviewImage(shot, scene){
  const col = sceneColor(scene);
  const canvas = document.createElement('canvas');
  canvas.width = 640; canvas.height = 360;
  const ctx = canvas.getContext('2d');
  const grad = ctx.createLinearGradient(0, 0, 640, 360);
  grad.addColorStop(0, col.hexA);
  grad.addColorStop(1, col.hexB);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 640, 360);
  // a few soft abstract shapes so every generation looks a little different
  let seed = shot.id.split('').reduce((a,c)=>a+c.charCodeAt(0),0) + shot.duration*97;
  function rnd(){ seed = (seed*9301+49297)%233280; return seed/233280; }
  for(let i=0;i<5;i++){
    ctx.beginPath();
    const r = 40 + rnd()*120;
    ctx.fillStyle = `rgba(255,255,255,${0.03+rnd()*0.05})`;
    ctx.arc(rnd()*640, rnd()*360, r, 0, Math.PI*2);
    ctx.fill();
  }
  ctx.fillStyle = 'rgba(0,0,0,0.28)';
  ctx.fillRect(0, 300, 640, 60);
  ctx.fillStyle = '#fff';
  ctx.font = '600 20px Inter, sans-serif';
  ctx.fillText(shot.name, 16, 335);
  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  ctx.font = '12px "JetBrains Mono", monospace';
  ctx.fillText(scene.name + ' · ' + shot.duration + 's', 16, 352);
  return canvas.toDataURL('image/png');
}

function buildReferenceCardText(it, kind){
  kind = kind || 'character';
  const lines = [];
  lines.push(kind==='location' ? '# LOCATION REFERENCE CARD' : '# CHARACTER REFERENCE CARD');
  lines.push('name: ' + it.name);
  if(it.role) lines.push('role: ' + it.role);
  lines.push('primary_photo: ' + (it.photo ? 'attached (1)' : 'none'));
  if(kind==='character' && it.angleSlots){
    const filled = CHAR_ANGLE_SLOTS.filter(s=>it.angleSlots[s.key]).map(s=>s.label);
    lines.push('angle_refs: ' + filled.length + ' attached (' + (filled.join(', ') || 'none') + ')');
  } else {
    lines.push('angle_refs: ' + ((it.angles && it.angles.length) || 0) + ' attached');
  }
  if(it.description) lines.push('description: ' + it.description);
  lines.push('');
  lines.push('consistency_rule:');
  if(kind==='location'){
    lines.push('  Always render this location matching the geometry, layout,');
    lines.push('  furniture and lighting style captured above. Only deviate when');
    lines.push('  a shot explicitly overrides a detail (e.g. "after the fight",');
    lines.push('  "smoke-filled", "red lighting") — those overrides apply to');
    lines.push('  that shot only and reset on the next one unless carried forward.');
  } else {
    lines.push('  Always render this character matching the face, hair, build');
    lines.push('  and wardrobe captured above. Only deviate when a shot');
    lines.push('  explicitly overrides a detail (e.g. "wet", "no jacket",');
    lines.push('  "bloodied lip") — those overrides apply to that shot only');
    lines.push('  and reset on the next one unless carried forward.');
  }
  return lines.join('\n');
}

// Composites the filled angle slots into one "turnaround sheet" image — entirely local
// (canvas), no network call. This is the same asset a real KIE call would later send as
// the reference image(s) to Kling Elements / GPT-Image-1 / Nano Banana etc.
function buildTurnaroundSheet(data){
  const slots = data.angleSlots;
  if(!slots) return Promise.resolve(null);
  const present = CHAR_ANGLE_SLOTS.filter(s=>slots[s.key]);
  if(present.length===0) return Promise.resolve(null);

  const cellW = 220, cellH = 220, labelH = 24, pad = 10;
  const cols = Math.min(4, present.length);
  const rows = Math.ceil(present.length/cols);
  const canvas = document.createElement('canvas');
  canvas.width = cols*cellW + (cols+1)*pad;
  canvas.height = rows*(cellH+labelH) + (rows+1)*pad;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#15171b';
  ctx.fillRect(0,0,canvas.width,canvas.height);

  const loads = present.map((slotDef, i)=> new Promise((resolve)=>{
    const img = new Image();
    img.onload = ()=>{
      const col = i % cols, row = Math.floor(i/cols);
      const x = pad + col*(cellW+pad), y = pad + row*(cellH+labelH+pad);
      const scale = Math.max(cellW/img.naturalWidth, cellH/img.naturalHeight);
      const sw = cellW/scale, sh = cellH/scale;
      const sx = (img.naturalWidth-sw)/2, sy = (img.naturalHeight-sh)/2;
      ctx.drawImage(img, sx, sy, sw, sh, x, y, cellW, cellH);
      ctx.fillStyle = '#9498a0';
      ctx.font = '13px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(slotDef.label, x+cellW/2, y+cellH+17);
      resolve();
    };
    img.onerror = resolve;
    img.src = slots[slotDef.key];
  }));

  return Promise.all(loads).then(()=> canvas.toDataURL('image/png'));
}

function renderGenBlock(sectionEl, data, refText, onGenerate, opts){
  if(!sectionEl) return;
  opts = opts || {};
  const kind = opts.kind || 'character';
  const requireRole = opts.requireRole !== false;
  const hasBasics = !!(data.name && data.photo && data.description && (!requireRole || data.role));

  let anglesOk = true, angleHint = '';
  if(opts.requireCoreAngles){
    const filled = filledCoreAngleCount(data.angleSlots);
    const total = coreAngleCountTotal();
    anglesOk = filled >= total;
    angleHint = `${filled}/${total} core angles`;
  }

  if(!hasBasics || !anglesOk){
    const missing = [];
    if(!hasBasics) missing.push(`photo${requireRole?', role':''} and description`);
    if(!anglesOk) missing.push(`all core reference angles (${angleHint})`);
    sectionEl.innerHTML = `<div class="gen-hint">Add ${missing.join(' and ')} to generate this ${kind}'s AI reference card.</div>`;
    return;
  }

  const sheet = opts.existingSheet;
  const sheetHtml = sheet ? `<img class="turnaround-sheet-preview" src="${sheet}">` : '';

  if(refText){
    sectionEl.innerHTML = `
      <div class="ref-status"><span class="dot2"></span>Reference card generated</div>
      ${sheetHtml}
      <div class="ref-card-box">${refText}</div>
      <div class="ref-actions">
        <button class="cf-btn" id="genRegenBtn">Regenerate <span class="gen-cost">${GEN_COST_LABEL}</span></button>
      </div>`;
    sectionEl.querySelector('#genRegenBtn').onclick = ()=> runGenBlock(sectionEl, data, onGenerate, opts);
  } else {
    sectionEl.innerHTML = `
      <button class="gen-btn" id="genBtn">Generate this ${kind} for AI use <span class="gen-cost">${GEN_COST_LABEL}</span></button>
      <div class="gen-hint">Builds a turnaround sheet from your reference photos plus a structured text card (no paid API yet — this runs locally). Future shot generations will point to this so ${kind==='location'?'the location':'this character'} stays consistent from shot to shot.</div>`;
    sectionEl.querySelector('#genBtn').onclick = ()=> runGenBlock(sectionEl, data, onGenerate, opts);
  }
}

function runGenBlock(sectionEl, data, onGenerate, opts){
  if(!sectionEl) return;
  const kind = (opts && opts.kind) || 'character';
  sectionEl.innerHTML = `<button class="gen-btn" disabled><span class="gen-spin"></span>Generating…</button>`;
  // simulated/local for now — once a paid backend (KIE) is wired up, this is where the real
  // API call goes, sending the same turnaround sheet + text this already builds.
  setTimeout(async ()=>{
    const text = buildReferenceCardText(data, kind);
    let sheet = null;
    if(opts && opts.buildSheet){
      try{ sheet = await opts.buildSheet(data); }catch(err){}
    }
    onGenerate(text, sheet);
  }, 1200);
}

function renderGenSection(cat, idx){
  const it = cat.items[idx];
  renderGenBlock(document.getElementById('genSection'), it, it.referenceCard, (text, sheet)=>{
    it.referenceCard = text;
    if(sheet) it.turnaroundSheet = sheet;
    renderAssets();
    renderGenSection(cat, idx);
  }, {
    kind:'character',
    requireCoreAngles:true,
    buildSheet: buildTurnaroundSheet,
    existingSheet: it.turnaroundSheet,
  });
}

