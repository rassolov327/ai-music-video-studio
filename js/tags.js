// ---------- @Name character tags ----------
// Explicit tags (not automatic name-scanning) — the user picked "A" specifically for
// reliability: no false positives from a character's name happening to appear in
// unrelated text. Typing "@" anywhere in a wired textarea opens an autocomplete list of
// known characters; picking one inserts "@Name " as plain text. A validation row below the
// field shows, for every @mention currently in the text, whether it resolves to a real
// character with a built Character Card — this is the same "orphaned reference" idea Check
// already applies to scene assignments, just extended to free text.

function findCharacterByTagName(name){
  const bandCat = state.categories.find(c=> c.key==='band');
  const characters = bandCat ? bandCat.items : [];
  return characters.find(c=> c.name.toLowerCase()===name.toLowerCase()) || null;
}
function characterHasCard(character){
  return !!(character && character.card && character.card.images && character.card.images.sheet && character.card.images.sheet.url);
}

function wireTagAutocomplete(textareaId){
  const textarea = document.getElementById(textareaId);
  if(!textarea) return;
  let dropdown = null;
  const closeDropdown = ()=>{ if(dropdown){ dropdown.remove(); dropdown = null; } };

  const onInput = ()=>{
    closeDropdown();
    const val = textarea.value;
    const cursorPos = textarea.selectionStart;
    const beforeCursor = val.slice(0, cursorPos);
    const match = beforeCursor.match(/@([^\s@]*)$/);
    renderTagValidationHint(textareaId);
    if(!match) return;
    const query = match[1].toLowerCase();
    const bandCat = state.categories.find(c=> c.key==='band');
    const characters = bandCat ? bandCat.items : [];
    const matches = characters.filter(c=> c.name.toLowerCase().includes(query));

    dropdown = document.createElement('div');
    dropdown.className = 'tag-autocomplete-dropdown';
    if(matches.length===0){
      dropdown.innerHTML = characters.length===0
        ? `<div class="tag-autocomplete-empty">No characters in this project yet — add one in Band / Characters first.</div>`
        : `<div class="tag-autocomplete-empty">No character matches "${match[1]}".</div>`;
    } else {
      dropdown.innerHTML = matches.map(c=>{
        const ok = characterHasCard(c);
        return `<div class="tag-autocomplete-item" data-name="${c.name}"><span>${c.name}${c.role ? ' — ' + c.role : ''}</span>${ok ? '<span class="tag-ok-badge">card ready</span>' : '<span class="tag-warn-badge">no card yet</span>'}</div>`;
      }).join('');
    }
    const wrap = textarea.parentElement;
    wrap.style.position = wrap.style.position || 'relative';
    wrap.appendChild(dropdown);

    dropdown.querySelectorAll('.tag-autocomplete-item').forEach(item=>{
      item.onclick = ()=>{
        const name = item.dataset.name;
        const insertAt = match.index;
        const newVal = val.slice(0, insertAt) + '@' + name + ' ' + val.slice(cursorPos);
        textarea.value = newVal;
        const newCursorPos = insertAt + name.length + 2;
        textarea.focus();
        textarea.setSelectionRange(newCursorPos, newCursorPos);
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
        closeDropdown();
      };
    });
  };
  textarea.addEventListener('input', onInput);
  textarea.addEventListener('blur', ()=> setTimeout(closeDropdown, 150));
  renderTagValidationHint(textareaId);
}

function renderTagValidationHint(textareaId){
  const textarea = document.getElementById(textareaId);
  if(!textarea) return;
  const hintId = textareaId + 'TagHint';
  let hint = document.getElementById(hintId);
  const mentions = Array.from(new Set((textarea.value.match(/@([^\s@]+)/g) || []).map(m=> m.slice(1))));
  if(mentions.length===0){
    if(hint) hint.remove();
    return;
  }
  const chips = mentions.map(name=>{
    const character = findCharacterByTagName(name);
    if(!character) return `<span class="tag-chip tag-chip-broken">@${name} — not found</span>`;
    if(!characterHasCard(character)) return `<span class="tag-chip tag-chip-warn">@${name} — no card yet</span>`;
    return `<span class="tag-chip tag-chip-ok">@${name} ✓</span>`;
  }).join(' ');
  if(!hint){
    hint = document.createElement('div');
    hint.id = hintId;
    hint.className = 'tag-hint-row';
    textarea.insertAdjacentElement('afterend', hint);
  }
  hint.innerHTML = chips;
}

// Turns @Name mentions into (a) plain readable text (the model doesn't understand "@"
// syntax) and (b) a list of that character's card image, uploaded and ready to use as a
// reference for this exact generation. Characters without a built card just become plain
// text — no reference, but nothing breaks either. `skipCharacterIds` lets a caller avoid
// uploading a duplicate reference for a character already covered some other way (e.g. the
// scene's own automatic character-reference gathering) — the @ prefix still gets cleaned
// from the text either way, only the (redundant) upload is skipped.
async function resolveTagsInPrompt(text, skipCharacterIds){
  const mentions = Array.from(new Set((text.match(/@([^\s@]+)/g) || []).map(m=> m.slice(1))));
  let cleanText = text;
  const referenceImageUrls = [];
  for(const name of mentions){
    cleanText = cleanText.split('@' + name).join(name);
    const character = findCharacterByTagName(name);
    if(character && characterHasCard(character) && !(skipCharacterIds && skipCharacterIds.has(character.id))){
      try{
        const url = await uploadReferencePhoto(character.card.images.sheet.url);
        if(url) referenceImageUrls.push(url);
      } catch(err){
        console.warn('[tags] could not upload reference for @' + name + ':', err);
      }
    }
  }
  return { cleanText, referenceImageUrls };
}

// Automatic references for a shot's own scene assignment — every character assigned to the
// scene (with their Character Card) and, when they have one, the specific Look they're
// wearing in this scene too, so the outfit is an actual visual reference and not just text.
// This is the "set once in the scene, every shot inherits it" pattern already used for the
// text side — now extended to the reference-image side.
async function gatherSceneCharacterReferences(scene){
  const localUrls = [];
  const seenCharacterIds = new Set();
  if(scene && scene.characters && scene.characters.length){
    const bandCat = state.categories.find(c=> c.key==='band');
    const characters = bandCat ? bandCat.items : [];
    const looksCat = state.categories.find(c=> c.key==='looks');
    const looks = looksCat ? looksCat.items : [];
    for(const entry of scene.characters){
      const character = characters.find(c=> c.id===entry.characterId);
      if(!character) continue;
      seenCharacterIds.add(character.id);
      if(characterHasCard(character)) localUrls.push(character.card.images.sheet.url);
      if(entry.lookId){
        const look = looks.find(l=> l.id===entry.lookId);
        if(look && look.previewImage) localUrls.push(look.previewImage);
      }
    }
  }
  return { localUrls, seenCharacterIds };
}

