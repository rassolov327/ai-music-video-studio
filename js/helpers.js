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

// ---------- paid generation, proxied through our own backend (server.js) ----------
// The browser never sees the KIE.ai key — it only ever calls this same-origin endpoint.
// Task creation is fire-and-forget (see js/tasks.js) — the server tracks progress via
// KIE's webhook (with a polling fallback) and the Tasks tab / background watcher pick up
// the result, so there's no client-side polling loop here anymore.
let _kieConfiguredCache = null;
async function checkPaidGenerationAvailable(){
  if(_kieConfiguredCache !== null) return _kieConfiguredCache;
  try{
    const res = await fetch('/api/health');
    const data = await res.json();
    _kieConfiguredCache = !!(data && data.kieConfigured);
  } catch(err){
    _kieConfiguredCache = false;
  }
  return _kieConfiguredCache;
}

// ---------- free text helper, proxied through our own backend (server.js -> Gemini) ----------
// Same "never expose the key to the browser" pattern as paid image generation. Generic by
// design: any textarea in the app can get an "Improve with AI" button by calling
// wireAiAssistButton() with an instruction — no new server route needed per feature.
let _geminiConfiguredCache = null;
async function checkAssistAvailable(){
  if(_geminiConfiguredCache !== null) return _geminiConfiguredCache;
  try{
    const res = await fetch('/api/health');
    const data = await res.json();
    _geminiConfiguredCache = !!(data && data.geminiConfigured);
  } catch(err){
    _geminiConfiguredCache = false;
  }
  return _geminiConfiguredCache;
}
async function callAiAssist(instruction, input){
  const res = await fetch('/api/assist/text', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ instruction, input }),
  });
  const data = await res.json().catch(()=> null);
  if(!res.ok || !data || !data.text){
    throw new Error((data && data.message) || ('Request failed (HTTP ' + res.status + ')'));
  }
  return data.text;
}
// Shows the button only if Gemini is actually configured on this deployment, and wires it
// to: read the textarea's current (rough) text, send it with `instruction`, and hand the
// result to `onApply` (which should update both the textarea and the underlying data).
function wireAiAssistButton(btnId, textareaId, instruction, onApply){
  checkAssistAvailable().then(available=>{
    const btn = document.getElementById(btnId);
    if(!btn || !available) return;
    btn.style.display = '';
    btn.onclick = async ()=>{
      const textarea = document.getElementById(textareaId);
      const input = textarea ? textarea.value.trim() : '';
      if(!input){
        alert('Write a rough idea first, then click Improve.');
        return;
      }
      const originalLabel = btn.textContent;
      btn.disabled = true;
      btn.textContent = 'Thinking…';
      try{
        const result = await callAiAssist(instruction, input);
        if(textarea) textarea.value = result;
        onApply(result);
        if(typeof saveProjectSoon==='function') saveProjectSoon();
      } catch(err){
        alert('AI assist failed: ' + err.message);
      } finally {
        btn.disabled = false;
        btn.textContent = originalLabel;
      }
    };
  });
}

// General awareness of what already exists in the project, so AI-assist suggestions for
// Looks/Locations/Props read like they belong to this world instead of being generic —
// e.g. it can mention an existing character or prop by its real name instead of inventing
// a new one that never gets used anywhere.
function buildAssetContextSummary(){
  const bandCat = state.categories.find(c=>c.key==='band');
  const characters = (bandCat ? bandCat.items : []);
  const propCat = state.categories.find(c=>c.key==='props');
  const props = (propCat ? propCat.items : []);
  const locCat = state.categories.find(c=>c.key==='locations');
  const locations = (locCat ? locCat.items : []);
  const looksCat = state.categories.find(c=>c.key==='looks');
  const looks = (looksCat ? looksCat.items : []);

  const parts = [];
  if(characters.length) parts.push('Characters already in this project: ' + characters.map(c=> c.name + (c.role ? ' (' + c.role + ')' : '')).join(', ') + '.');
  if(looks.length) parts.push('Looks/outfits already in this project: ' + looks.map(l=> l.name).join(', ') + '.');
  if(locations.length) parts.push('Locations already in this project: ' + locations.map(l=> l.name).join(', ') + '.');
  if(props.length) parts.push('Props already in this project: ' + props.map(p=> p.name).join(', ') + '.');
  if(parts.length===0) return '';
  return 'Context — this project already has: ' + parts.join(' ') + ' Feel free to reference these by name where it genuinely fits; don\'t invent new named characters/props/locations.';
}

// For a SHOT specifically: everything the scene already fixes (which character, which
// look they're wearing, which location, which props) has to stay untouched — those get
// woven into the final generation prompt separately (see buildShotPrompt), so if the
// AI-assisted description also describes them, the two can contradict each other and the
// shot stops looking like the rest of the project. This tells the assist exactly what's
// off-limits to redescribe, by name, rather than trusting a generic instruction alone.
function buildShotFixedElementsContext(scene){
  const bandCat = state.categories.find(c=>c.key==='band');
  const characters = (bandCat ? bandCat.items : []);
  const looksCat = state.categories.find(c=>c.key==='looks');
  const looks = (looksCat ? looksCat.items : []);
  const propCat = state.categories.find(c=>c.key==='props');
  const props = (propCat ? propCat.items : []);

  const lines = [];
  (scene.characters||[]).forEach(entry=>{
    const c = characters.find(x=> x.id===entry.characterId);
    if(!c) return;
    const look = entry.lookId ? looks.find(l=> l.id===entry.lookId) : null;
    lines.push('- Character "' + c.name + '"' + (look ? ', wearing the look "' + look.name + '"' : ''));
  });
  if(scene.location) lines.push('- Location: "' + scene.location + '"');
  (scene.props||[]).forEach(propId=>{
    const p = props.find(x=> x.id===propId);
    if(p) lines.push('- Prop present: "' + p.name + '"');
  });
  if(lines.length===0) return '';
  return 'This shot already has these FIXED elements, locked in separately:\n' + lines.join('\n')
    + '\nDo not describe what any of them look like, wear, or the environment\'s appearance — that would risk contradicting what\'s already locked in. Describe only the action, pose, and moment happening in this shot.';
}

// Same prompt style already used for each asset type's free-generation flow (Pollinations),
// reused here so the paid path produces a comparable result, not a differently-worded one.
function buildAssetGenPrompt(catKey, item){
  const desc = (item.description || item.name || '').trim();
  if(catKey==='looks') return (typeof buildLookPrompt==='function') ? buildLookPrompt(desc) : desc;
  if(catKey==='locations') return desc + ', location establishing shot, cinematic';
  if(catKey==='props') return desc + ', product reference photo, plain neutral background, studio lighting';
  return desc;
}

const SHOT_SIZE_FRAMING = {
  'Detail Shot': 'extreme macro detail shot — frame only a small specific detail (hands, an object, a texture), filling the entire frame',
  'Extreme Close-Up': 'extreme close-up shot — frame only the eyes and immediate face, filling the entire frame',
  'Close-Up': 'close-up shot — tightly framed on the face and shoulders only, no more of the body visible',
  'Medium Close-Up': 'medium close-up shot — framed from the chest up',
  'Medium Shot': 'medium shot — framed from the waist up',
  'Medium Wide Shot': 'medium wide shot — framed from the knees up',
  'Wide Shot': 'wide shot — full body visible within the environment',
  'Extreme Wide Shot': 'extreme wide shot — the subject small within a large environment',
};

function buildShotPrompt(shot, scene){
  const parts = [];

  // Framing goes first — earlier position in the prompt gets more weight from the model —
  // and is spelled out explicitly rather than left as a single bare word, with an explicit
  // instruction to override the framing shown in any reference images (a character card is
  // a wide multi-panel turnaround sheet, which can otherwise pull the model toward a wide
  // shot regardless of what the text says).
  if(shot.shotSize){
    const framing = SHOT_SIZE_FRAMING[shot.shotSize] || shot.shotSize.toLowerCase();
    parts.push('SHOT FRAMING (follow exactly — this overrides whatever framing any reference image shows): ' + framing);
  }

  if(shot.description) parts.push(shot.description);

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

  if(shot.cameraMove && shot.cameraMove!=='Static') parts.push(shot.cameraMove.toLowerCase()+' camera movement');
  const effectiveLighting = (shot.lightingSameAsScene !== false) ? (scene && scene.lighting) : shot.lighting;
  if(effectiveLighting) parts.push(effectiveLighting);

  // props assigned to the scene — present in every shot of it, not tied to a character
  if(scene && scene.props && scene.props.length){
    const propCat = state.categories.find(c=>c.key==='props');
    const props = propCat ? propCat.items : [];
    scene.props.forEach(propId=>{
      const p = props.find(x=>x.id===propId);
      if(!p) return;
      parts.push('with ' + p.name + (p.description ? ' (' + p.description + ')' : '') + ' present');
    });
  }

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

