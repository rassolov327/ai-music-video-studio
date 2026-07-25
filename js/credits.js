// ---------- KIE.ai credits indicator (bottom-right, always visible) ----------
let creditsRefreshTimer = null;

function wireCreditsIndicator(){
  const el = document.getElementById('creditsIndicator');
  if(!el) return;
  el.onclick = refreshCredits;
  refreshCredits();
  if(creditsRefreshTimer) clearInterval(creditsRefreshTimer);
  creditsRefreshTimer = setInterval(refreshCredits, 5 * 60 * 1000);
}

async function refreshCredits(){
  const el = document.getElementById('creditsIndicator');
  const dot = document.getElementById('creditsDot');
  const value = document.getElementById('creditsValue');
  const spinner = document.getElementById('creditsSpinner');
  if(!el || !dot || !value || !spinner) return;
  spinner.classList.remove('hidden');
  try{
    const res = await fetch('/api/kie-credits');
    const data = await res.json().catch(()=> null);
    if(!res.ok || !data || typeof data.credits !== 'number'){
      const notConfigured = data && data.error==='not_configured';
      dot.className = 'credits-dot grey';
      value.textContent = notConfigured ? 'not set up' : 'error';
      el.title = (data && data.message) || 'Could not reach KIE.ai — click to retry';
      return;
    }
    const imagesRemaining = data.imagesRemaining;
    let cls = 'grey';
    if(imagesRemaining===0) cls = 'red';
    else if(imagesRemaining!==null && imagesRemaining!==undefined && imagesRemaining < 20) cls = 'yellow';
    else if(imagesRemaining!==null && imagesRemaining!==undefined) cls = 'green';
    dot.className = 'credits-dot ' + cls;
    value.textContent = data.credits + ' cr';
    const usdText = typeof data.usd === 'number' ? '$' + data.usd.toFixed(2) : '';
    const imagesText = (imagesRemaining!==null && imagesRemaining!==undefined) ? (', ~' + imagesRemaining + ' images at the cheapest model') : '';
    el.title = 'KIE.ai: ' + data.credits + ' credits (' + usdText + imagesText + ') — click to refresh';
  } catch(err){
    dot.className = 'credits-dot red';
    value.textContent = 'error';
    el.title = 'Could not reach the server to check credits — click to retry';
  } finally {
    spinner.classList.add('hidden');
  }
}
