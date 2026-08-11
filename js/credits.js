// ---------- KIE.ai credits indicator (bottom-right, always visible) ----------
let creditsRefreshTimer = null;

function wireCreditsIndicator(){
  const el = document.getElementById('creditsIndicator');
  if(!el) return;
  el.onclick = refreshCredits;
  const personalEl = document.getElementById('personalBalanceIndicator');
  if(personalEl) personalEl.onclick = refreshCredits;
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
    const res = await fetch('/api/my-balance');
    const data = await res.json().catch(()=> null);
    if(!res.ok || !data || typeof data.credits !== 'number'){
      const notConfigured = data && data.error==='not_configured';
      dot.className = 'credits-dot grey';
      value.textContent = notConfigured ? 'not set up' : 'error';
      el.title = (data && data.message) || 'Could not reach the server — click to retry';
      return;
    }
    const imagesRemaining = data.imagesRemaining;
    let cls = 'grey';
    if(imagesRemaining===0) cls = 'red';
    else if(imagesRemaining!==null && imagesRemaining!==undefined && imagesRemaining < 20) cls = 'yellow';
    else if(imagesRemaining!==null && imagesRemaining!==undefined) cls = 'green';
    dot.className = 'credits-dot ' + cls;
    const unit = data.isAdmin ? ' cr' : ' tokens';
    value.textContent = data.credits + unit;
    if(data.isAdmin){
      const usdText = typeof data.usd === 'number' ? '$' + data.usd.toFixed(2) : '';
      const imagesText = (imagesRemaining!==null && imagesRemaining!==undefined) ? (', ~' + imagesRemaining + ' images at the cheapest model') : '';
      el.title = 'KIE.ai: ' + data.credits + ' credits (' + usdText + imagesText + ') — click to refresh';
    } else {
      const imagesText = (imagesRemaining!==null && imagesRemaining!==undefined) ? (' (~' + imagesRemaining + ' images at the cheapest model)') : '';
      el.title = 'Your balance: ' + data.credits + ' tokens' + imagesText + ' — click to refresh';
    }

    // Second indicator, admin only — the personal balance actually available for HIS OWN
    // generations (KIE credits minus everything currently promised to users).
    const personalEl = document.getElementById('personalBalanceIndicator');
    const personalDot = document.getElementById('personalBalanceDot');
    const personalValue = document.getElementById('personalBalanceValue');
    if(personalEl && personalDot && personalValue){
      if(data.isAdmin && typeof data.personalBalance === 'number'){
        personalEl.classList.remove('hidden');
        const pImagesRemaining = data.personalImagesRemaining;
        let pCls = 'grey';
        if(pImagesRemaining===0) pCls = 'red';
        else if(pImagesRemaining!==null && pImagesRemaining!==undefined && pImagesRemaining < 20) pCls = 'yellow';
        else if(pImagesRemaining!==null && pImagesRemaining!==undefined) pCls = 'green';
        personalDot.className = 'credits-dot ' + pCls;
        personalValue.textContent = data.personalBalance + ' cr (yours)';
        const pUsdText = typeof data.personalUsd === 'number' ? '$' + data.personalUsd.toFixed(2) : '';
        personalEl.title = 'Your personal balance (KIE credits minus what\'s owed to users): ' + data.personalBalance + ' (' + pUsdText + ') — click to refresh';
      } else {
        personalEl.classList.add('hidden');
      }
    }
  } catch(err){
    dot.className = 'credits-dot red';
    value.textContent = 'error';
    el.title = 'Could not reach the server to check your balance — click to retry';
  } finally {
    spinner.classList.add('hidden');
  }
}
