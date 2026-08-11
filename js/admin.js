// ---------- admin panel (stage 3: list / add / delete) ----------
// The "Edit" button per row is rendered now (matching the final table shape) but is a
// placeholder — real editing is stage 4.
async function loadAdminUsers(){
  const body = document.getElementById('adminUsersBody');
  if(!body) return;
  body.innerHTML = `<tr><td colspan="6" style="color:var(--text-3);">Loading…</td></tr>`;
  try{
    const res = await fetch('/api/admin/users');
    const data = await res.json().catch(()=> null);
    if(!res.ok){
      body.innerHTML = `<tr><td colspan="6" style="color:var(--danger);">${(data && data.message) || 'Could not load users.'}</td></tr>`;
      return;
    }
    renderAdminUsers(data.users || []);
  } catch(err){
    body.innerHTML = `<tr><td colspan="6" style="color:var(--danger);">Could not reach the server.</td></tr>`;
  }
}
function renderAdminUsers(users){
  const body = document.getElementById('adminUsersBody');
  if(!body) return;
  if(!users.length){
    body.innerHTML = `<tr><td colspan="6" style="color:var(--text-3);">No users yet.</td></tr>`;
    return;
  }
  body.innerHTML = users.map((u, i)=> `
    <tr data-user-id="${u.id}">
      <td>${i+1}</td>
      <td>${u.name}</td>
      <td>${u.login}${u.is_admin ? ' <span style="color:var(--text-3);">(admin)</span>' : ''}</td>
      <td>${u.tokens}</td>
      <td style="color:var(--text-3);">${u.last_login ? new Date(u.last_login).toLocaleString() : 'never'}</td>
      <td>
        <div class="admin-row-actions">
          <span class="admin-row-btn" data-admin-edit="${u.id}" title="Edit (coming soon)"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"></path><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"></path></svg></span>
          <span class="admin-row-btn danger" data-admin-delete="${u.id}" title="Delete"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"></path></svg></span>
        </div>
      </td>
    </tr>`).join('');

  body.querySelectorAll('[data-admin-delete]').forEach(el=>{
    el.onclick = async ()=>{
      const id = el.dataset.adminDelete;
      const row = users.find(u=> String(u.id)===id);
      if(!confirm('Delete user "' + (row ? row.login : id) + '"? This cannot be undone.')) return;
      try{
        const res = await fetch('/api/admin/users/' + id, { method: 'DELETE' });
        const data = await res.json().catch(()=> null);
        if(!res.ok){
          alert((data && data.message) || 'Could not delete this user.');
          return;
        }
        loadAdminUsers();
      } catch(err){
        alert('Could not reach the server.');
      }
    };
  });
  body.querySelectorAll('[data-admin-edit]').forEach(el=>{
    el.onclick = ()=>{
      const id = el.dataset.adminEdit;
      const row = users.find(u=> String(u.id)===id);
      if(row) openAdminEditModal(row);
    };
  });
}

let adminEditingUserId = null;
function openAdminEditModal(user){
  adminEditingUserId = user.id;
  document.getElementById('adminEditLogin').value = user.login;
  document.getElementById('adminEditPassword').value = '';
  document.getElementById('adminEditTokensCurrent').textContent = user.tokens;
  document.getElementById('adminEditAddTokens').value = '';
  document.getElementById('adminEditAddTokensRow').style.display = user.is_admin ? 'none' : '';
  document.getElementById('adminEditTokensLockedNote').style.display = user.is_admin ? '' : 'none';
  document.getElementById('adminEditErrorHint').style.display = 'none';
  document.getElementById('adminEditModal').classList.remove('hidden');
}
function closeAdminEditModal(){
  document.getElementById('adminEditModal').classList.add('hidden');
  adminEditingUserId = null;
}
function wireAdminEditModal(){
  document.getElementById('adminEditCloseBtn').onclick = closeAdminEditModal;
  document.getElementById('adminEditCancelBtn').onclick = closeAdminEditModal;
  document.getElementById('adminEditAddTokensBtn').onclick = async ()=>{
    const errHint = document.getElementById('adminEditErrorHint');
    errHint.style.display = 'none';
    const addAmt = Number(document.getElementById('adminEditAddTokens').value);
    if(!addAmt){ return; }
    try{
      const res = await fetch('/api/admin/users/' + adminEditingUserId, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ addTokens: addAmt }),
      });
      const data = await res.json().catch(()=> null);
      if(!res.ok){
        errHint.textContent = (data && data.message) || 'Could not add tokens.';
        errHint.style.display = '';
        return;
      }
      document.getElementById('adminEditTokensCurrent').textContent = data.user.tokens;
      document.getElementById('adminEditAddTokens').value = '';
    } catch(err){
      errHint.textContent = 'Could not reach the server.';
      errHint.style.display = '';
    }
  };
  document.getElementById('adminEditSaveBtn').onclick = async ()=>{
    const errHint = document.getElementById('adminEditErrorHint');
    errHint.style.display = 'none';
    const login = document.getElementById('adminEditLogin').value.trim();
    const password = document.getElementById('adminEditPassword').value;
    const body = {};
    if(login) body.login = login;
    if(password) body.password = password;
    if(!Object.keys(body).length){ closeAdminEditModal(); return; }
    try{
      const res = await fetch('/api/admin/users/' + adminEditingUserId, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(()=> null);
      if(!res.ok){
        errHint.textContent = (data && data.message) || 'Could not save changes.';
        errHint.style.display = '';
        return;
      }
      closeAdminEditModal();
      loadAdminUsers();
    } catch(err){
      errHint.textContent = 'Could not reach the server.';
      errHint.style.display = '';
    }
  };
}

function wireAdminScreen(){
  wireAdminEditModal();
  loadAdminUsers();
  document.getElementById('adminAddUserBtn').onclick = ()=>{
    document.getElementById('adminAddUserForm').style.display = '';
    document.getElementById('adminNewName').value = '';
    document.getElementById('adminNewLogin').value = '';
    document.getElementById('adminNewPassword').value = '';
    document.getElementById('adminNewTokens').value = '0';
    document.getElementById('adminAddErrorHint').style.display = 'none';
  };
  document.getElementById('adminAddCancelBtn').onclick = ()=>{
    document.getElementById('adminAddUserForm').style.display = 'none';
  };
  document.getElementById('adminAddSaveBtn').onclick = async ()=>{
    const errHint = document.getElementById('adminAddErrorHint');
    errHint.style.display = 'none';
    const name = document.getElementById('adminNewName').value.trim();
    const login = document.getElementById('adminNewLogin').value.trim();
    const password = document.getElementById('adminNewPassword').value;
    const tokens = Number(document.getElementById('adminNewTokens').value) || 0;
    if(!name || !login || !password){
      errHint.textContent = 'Name, login, and password are all required.';
      errHint.style.display = '';
      return;
    }
    try{
      const res = await fetch('/api/admin/users', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, login, password, tokens }),
      });
      const data = await res.json().catch(()=> null);
      if(!res.ok){
        errHint.textContent = (data && data.message) || 'Could not add this user.';
        errHint.style.display = '';
        return;
      }
      document.getElementById('adminAddUserForm').style.display = 'none';
      loadAdminUsers();
    } catch(err){
      errHint.textContent = 'Could not reach the server.';
      errHint.style.display = '';
    }
  };
}
