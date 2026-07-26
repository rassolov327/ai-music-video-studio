// ---------- Gemini quick-assistant chat popup ----------
let geminiChatHistory = []; // [{role:'user'|'model', text}]

function escapeHtml(str){
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function wireGeminiChat(){
  const btn = document.getElementById('geminiAssistBtn');
  if(!btn) return;
  btn.onclick = ()=> setGeminiChatOpen(document.getElementById('geminiChatModal').classList.contains('hidden'));
  document.getElementById('geminiChatClose').addEventListener('click', ()=> setGeminiChatOpen(false));
  document.getElementById('geminiChatSendBtn').onclick = sendGeminiChatMessage;
  document.addEventListener('keydown', (e)=>{
    if(e.key==='Escape' && !document.getElementById('geminiChatModal').classList.contains('hidden')){
      setGeminiChatOpen(false);
    }
  });
  const input = document.getElementById('geminiChatInput');
  input.addEventListener('keydown', (e)=>{
    if(e.key==='Enter' && !e.shiftKey){
      e.preventDefault();
      sendGeminiChatMessage();
    }
  });
  input.addEventListener('input', ()=>{
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 70) + 'px';
  });
}

function setGeminiChatOpen(open){
  document.getElementById('geminiChatModal').classList.toggle('hidden', !open);
  if(open) document.getElementById('geminiChatInput').focus();
}

function renderGeminiChatMessages(){
  const container = document.getElementById('geminiChatMessages');
  if(geminiChatHistory.length===0){
    container.innerHTML = `<div class="gemini-chat-empty">Ask anything — e.g. tips for writing this shot's prompt.</div>`;
    return;
  }
  container.innerHTML = geminiChatHistory.map(m=>
    `<div class="gemini-chat-msg ${m.role==='user' ? 'user' : 'model'}">${escapeHtml(m.text)}</div>`
  ).join('');
  container.scrollTop = container.scrollHeight;
}

async function sendGeminiChatMessage(){
  const input = document.getElementById('geminiChatInput');
  const text = input.value.trim();
  if(!text) return;
  const priorHistory = geminiChatHistory.slice();
  geminiChatHistory.push({ role:'user', text });
  input.value = '';
  input.style.height = 'auto';
  renderGeminiChatMessages();

  const container = document.getElementById('geminiChatMessages');
  const pendingEl = document.createElement('div');
  pendingEl.className = 'gemini-chat-msg pending';
  pendingEl.textContent = 'Thinking…';
  container.appendChild(pendingEl);
  container.scrollTop = container.scrollHeight;

  try{
    const body = priorHistory.length===0
      ? { instruction: 'You are a helpful assistant inside an AI music video production tool (characters, locations, props, looks, shots, image/video generation). Be concise and practical. The user may ask for advice on writing prompts, or general questions.', input: text }
      : { input: text, history: priorHistory };
    const res = await fetch('/api/assist/text', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(()=> null);
    if(!res.ok || !data || !data.text) throw new Error((data && data.message) || 'Could not reach Gemini.');
    geminiChatHistory.push({ role:'model', text: data.text });
  } catch(err){
    geminiChatHistory.push({ role:'model', text: 'Sorry — ' + err.message });
  }
  renderGeminiChatMessages();
}
