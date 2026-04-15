//  Guard: must be logged in as admin
const userData   = sessionStorage.getItem('ls_user');
const _user      = userData ? JSON.parse(userData) : null;
if (!_user || _user.role !== 'admin') {
  window.location.href = 'login.html';
}
const adminToken = _user.token;

// Admin info in sidebar
const adminName = _user.username || 'Admin';
document.getElementById('adminName').textContent   = adminName;
document.getElementById('adminAvatar').textContent = adminName.slice(0, 2).toUpperCase();

lucide.createIcons();

//  Data stores
let allUsers      = [];
let allDetections = [];
let allFeedback   = [];
let fbRatingChartInstance = null;
let fbCatChartInstance    = null;

// Cached filtered lists (used by pagination)
let _filteredUsers      = [];
let _filteredDetections = [];

// Pagination config
const USERS_PER_PAGE      = 10;
const DETECTIONS_PER_PAGE = 15;
let   userCurrentPage     = 1;
let   detectCurrentPage   = 1;

//  Helpers
const CAT_LABELS = {
  accuracy: 'Disease Accuracy', speed: 'Speed',
  language: 'Language Support', ui: 'App Design',
  treatment: 'Treatment Advice', other: 'Other'
};
const CAT_ICONS = {
  accuracy: 'scan-line', speed: 'zap', language: 'languages',
  ui: 'layout', treatment: 'pill', other: 'more-horizontal'
};
const STAGE_BADGE = {
  Healthy:  'green',
  Early:    'blue',
  Moderate: 'amber',
  Severe:   'red',
  Critical: 'red',
  Unknown:  'gray'
};

function escHtml(str) {
  return String(str)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function fmtDate(iso) {
  return new Date(iso).toLocaleDateString('en-IN', { day:'numeric', month:'short', year:'numeric' });
}
function fmtTime(iso) {
  return new Date(iso).toLocaleTimeString('en-IN', { hour:'2-digit', minute:'2-digit' });
}
function fmtDateTime(iso) { return `${fmtDate(iso)} · ${fmtTime(iso)}`; }

function isThisWeek(iso) {
  const diff = (new Date() - new Date(iso)) / (1000 * 60 * 60 * 24);
  return diff <= 7;
}
function isToday(iso) {
  return new Date(iso).toDateString() === new Date().toDateString();
}

//  Auth header
function authHeaders() {
  return { 'Authorization': `Bearer ${adminToken}`, 'Content-Type': 'application/json' };
}

//  Logout
function adminLogout() {
  sessionStorage.removeItem('ls_user');
  window.location.href = 'login.html';
}

// Sidebar toggle (mobile)
function toggleSidebar() {
  document.getElementById('sidebar').classList.toggle('open');
}

//  Tab switching
const TAB_TITLES = {
  overview:   'Overview',
  users:      'Users',
  detections: 'Detections',
  feedback:   'Feedback'
};

function switchTab(name) {
  document.querySelectorAll('.ad-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.ad-nav-item').forEach(n => n.classList.remove('active'));
  document.getElementById(`tab-${name}`).classList.add('active');
  document.getElementById(`nav-${name}`).classList.add('active');
  document.getElementById('topbarTitle').textContent = TAB_TITLES[name];
  document.getElementById('sidebar').classList.remove('open');
}

//  LOAD ALL DATA
async function refreshAll() {
  await Promise.all([loadUsers(), loadDetections(), loadFeedback()]);
  renderOverview();
}

//  Users
async function loadUsers() {
  try {
    const res  = await fetch('/admin/users', { headers: authHeaders() });
    if (res.status === 401) { adminLogout(); return; }
    const data = await res.json();
    allUsers   = data.users || [];
    document.getElementById('navBadgeUsers').textContent = allUsers.length;
  } catch {
    document.getElementById('userCount').textContent = 'Failed to load.';
  }
}

//  Detections
async function loadDetections() {
  try {
    const res     = await fetch('/admin/detections', { headers: authHeaders() });
    if (res.status === 401) { adminLogout(); return; }
    const data    = await res.json();
    allDetections = data.detections || [];
    document.getElementById('navBadgeDetections').textContent = allDetections.length;
  } catch {
    document.getElementById('detectCount').textContent = 'Failed to load.';
  }
}

//  Feedback
async function loadFeedback() {
  try {
    const res   = await fetch('/admin/feedback', { headers: authHeaders() });
    if (res.status === 401) { adminLogout(); return; }
    const data  = await res.json();
    allFeedback = data.feedback || [];
    document.getElementById('navBadgeFeedback').textContent = allFeedback.length;
    computeFeedbackStats();
  } catch {
    document.getElementById('resultsCount').textContent = 'Failed to load.';
  }
}

//  OVERVIEW
function renderOverview() {
  // seed cached arrays so pagination works on first switch
  _filteredUsers      = allUsers;
  _filteredDetections = allDetections;

  renderUsers(allUsers);
  renderDetections(allDetections);
  renderFeedbackList(allFeedback);

  // Users
  document.getElementById('ovUsers').textContent = allUsers.length;
  const newUsers = allUsers.filter(u => isThisWeek(u.created_at)).length;
  document.getElementById('ovUsersNew').textContent = `${newUsers} joined this week`;

  // Detections
  document.getElementById('ovDetections').textContent = allDetections.length;
  const today = allDetections.filter(d => isToday(d.created_at)).length;
  document.getElementById('ovDetectionsToday').textContent = `${today} today`;

  // Feedback
  document.getElementById('ovFeedback').textContent = allFeedback.length;
  const avgR = allFeedback.length
    ? (allFeedback.reduce((s, f) => s + f.rating, 0) / allFeedback.length).toFixed(1)
    : '—';
  document.getElementById('ovAvgRating').textContent = `avg rating ${avgR}`;

  // Avg Confidence
  const withConf = allDetections.filter(d => d.confidence > 0);
  const avgConf  = withConf.length
    ? (withConf.reduce((s, d) => s + d.confidence, 0) / withConf.length).toFixed(1) + '%'
    : '—';
  document.getElementById('ovAccuracy').textContent = avgConf;

  // Top disease
  const diseaseCount = {};
  allDetections.forEach(d => {
    diseaseCount[d.predicted_class] = (diseaseCount[d.predicted_class] || 0) + 1;
  });
  const topDisease = Object.entries(diseaseCount).sort((a,b) => b[1]-a[1])[0];
  document.getElementById('ovTopDisease').textContent = topDisease
    ? `top: ${topDisease[0].split(' - ')[0]}`
    : 'top: —';

  // Recent users
  const recentUsers = [...allUsers]
    .sort((a,b) => new Date(b.created_at) - new Date(a.created_at))
    .slice(0, 5);
  document.getElementById('ovRecentUsers').innerHTML = recentUsers.length
    ? recentUsers.map(u => `
        <div class="ad-mini-item">
          <div class="ad-mini-left">
            <div class="ad-mini-avatar">${u.username.slice(0,2).toUpperCase()}</div>
            <div>
              <div class="ad-mini-name">${escHtml(u.username)}</div>
              <div class="ad-mini-sub">${escHtml(u.email)}</div>
            </div>
          </div>
          <div class="ad-mini-right">${fmtDate(u.created_at)}</div>
        </div>`).join('')
    : '<div class="ad-mini-item"><div class="ad-mini-sub" style="padding:8px 0">No users yet</div></div>';

  // Recent detections
  const recentDetect = [...allDetections]
    .sort((a,b) => new Date(b.created_at) - new Date(a.created_at))
    .slice(0, 5);
  document.getElementById('ovRecentDetections').innerHTML = recentDetect.length
    ? recentDetect.map(d => `
        <div class="ad-mini-item">
          <div class="ad-mini-left">
            <div class="ad-mini-avatar" style="background:var(--blue-pale);color:var(--blue)">
              <i data-lucide="scan-line" style="width:13px;height:13px"></i>
            </div>
            <div>
              <div class="ad-mini-name">${escHtml(d.predicted_class)}</div>
              <div class="ad-mini-sub">${escHtml(d.username || 'Unknown')}</div>
            </div>
          </div>
          <div class="ad-mini-right">${fmtDate(d.created_at)}</div>
        </div>`).join('')
    : '<div class="ad-mini-item"><div class="ad-mini-sub" style="padding:8px 0">No detections yet</div></div>';

  lucide.createIcons();
}

//  PAGINATION RENDERER
function renderPagination(containerId, currentPage, totalPages, onPageFn) {
  const wrap = document.getElementById(containerId);
  if (!wrap) return;
  if (totalPages <= 1) { wrap.innerHTML = ''; return; }

  const base = `
    display:inline-flex;align-items:center;justify-content:center;
    min-width:32px;height:32px;padding:0 8px;
    border:1.5px solid var(--border);border-radius:10px;
    background:var(--white);font-family:'Nunito',sans-serif;
    font-size:12px;font-weight:700;color:var(--text-mid);cursor:pointer;
    transition:background .2s,color .2s,border-color .2s;`;

  const active = `
    display:inline-flex;align-items:center;justify-content:center;
    min-width:32px;height:32px;padding:0 8px;
    border:1.5px solid var(--leaf);border-radius:10px;
    background:var(--leaf);font-family:'Nunito',sans-serif;
    font-size:12px;font-weight:700;color:#fff;cursor:default;`;

  const disabled = `
    display:inline-flex;align-items:center;justify-content:center;
    min-width:32px;height:32px;padding:0 8px;
    border:1.5px solid var(--border);border-radius:10px;
    background:var(--white);font-family:'Nunito',sans-serif;
    font-size:12px;font-weight:700;color:var(--text-soft);
    cursor:not-allowed;opacity:.4;`;

  const hover = `onmouseenter="this.style.background='var(--leaf-pale)';this.style.color='var(--leaf)';this.style.borderColor='var(--leaf)'"
    onmouseleave="this.style.background='var(--white)';this.style.color='var(--text-mid)';this.style.borderColor='var(--border)'"`;

  function btn(label, page, isCurrent = false, isDisabled = false) {
    if (isDisabled) return `<button style="${disabled}" disabled>${label}</button>`;
    if (isCurrent)  return `<button style="${active}">${label}</button>`;
    return `<button style="${base}" ${hover} onclick="${onPageFn}(${page})">${label}</button>`;
  }

  const start = Math.max(1, currentPage - 2);
  const end   = Math.min(totalPages, currentPage + 2);
  let html = '';

  html += btn('‹', currentPage - 1, false, currentPage === 1);
  if (start > 1) {
    html += btn(1, 1);
    if (start > 2) html += `<span style="font-size:12px;color:var(--text-soft);padding:0 2px;font-weight:700">…</span>`;
  }
  for (let i = start; i <= end; i++) {
    html += btn(i, i, i === currentPage);
  }
  if (end < totalPages) {
    if (end < totalPages - 1) html += `<span style="font-size:12px;color:var(--text-soft);padding:0 2px;font-weight:700">…</span>`;
    html += btn(totalPages, totalPages);
  }
  html += btn('›', currentPage + 1, false, currentPage === totalPages);

  wrap.innerHTML = html;
}

//  USERS TAB
function filterUsers() {
  const q    = document.getElementById('userSearch').value.toLowerCase();
  const role = document.getElementById('userRoleFilter')
    ? document.getElementById('userRoleFilter').value : '';
  const sort = document.getElementById('userSortFilter')
    ? document.getElementById('userSortFilter').value : 'newest';

  let list = allUsers.filter(u => {
    if (role === 'admin' && !u.is_admin) return false;
    if (role === 'user'  &&  u.is_admin) return false;
    return u.username.toLowerCase().includes(q) || u.email.toLowerCase().includes(q);
  });

  if (sort === 'newest')          list.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  else if (sort === 'oldest')     list.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  else if (sort === 'name')       list.sort((a, b) => a.username.localeCompare(b.username));
  else if (sort === 'detections') {
    list.sort((a, b) => {
      const da = allDetections.filter(d => d.user_id === a.id).length;
      const db = allDetections.filter(d => d.user_id === b.id).length;
      return db - da;
    });
  }

  _filteredUsers  = list;
  userCurrentPage = 1;
  renderUsers(list);
}

function goToUserPage(page) {
  userCurrentPage = page;
  renderUsers(_filteredUsers);
}

function renderUsers(users) {
  const totalPages = Math.max(1, Math.ceil(users.length / USERS_PER_PAGE));
  const page       = Math.min(userCurrentPage, totalPages);
  userCurrentPage  = page;

  const start = (page - 1) * USERS_PER_PAGE;
  const items = users.slice(start, start + USERS_PER_PAGE);
  const total = users.length;

  const from = total === 0 ? 0 : start + 1;
  const to   = Math.min(start + USERS_PER_PAGE, total);
  document.getElementById('userCount').textContent =
    `Showing ${from}–${to} of ${total} users`;

  const tbody = document.getElementById('usersBody');
  if (!items.length) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:40px;color:var(--text-soft)">No users found</td></tr>`;
    document.getElementById('userPagination').innerHTML = '';
    return;
  }

  tbody.innerHTML = items.map(u => {
    const detectCount = allDetections.filter(d => d.user_id === u.id).length;
    return `
    <tr class="clickable" onclick="viewUser(${u.id})">
      <td>
        <div class="ad-cell-user">
          <div class="ad-cell-avatar">${u.username.slice(0,2).toUpperCase()}</div>
          <div class="ad-cell-name">${escHtml(u.username)}</div>
        </div>
      </td>
      <td style="color:var(--text-soft)">${escHtml(u.email)}</td>
      <td style="color:var(--text-soft)">${fmtDate(u.created_at)}</td>
      <td><span class="ad-badge ad-badge--blue">${detectCount} scan${detectCount !== 1 ? 's' : ''}</span></td>
      <td>${u.is_admin
        ? '<span class="ad-badge ad-badge--amber">Admin</span>'
        : '<span class="ad-badge ad-badge--gray">User</span>'}</td>
      <td style="display:flex;gap:8px;align-items:center">
        <button class="ad-view-btn" onclick="event.stopPropagation();viewUser(${u.id})">
          <i data-lucide="eye" style="width:12px;height:12px"></i>
          View
        </button>
      </td>
      <td>
        <button class="ad-view-btn ${u.is_admin ? 'ad-btn--danger' : 'ad-btn--promote'}"
          onclick="event.stopPropagation();toggleAdmin(${u.id}, ${u.is_admin})">
          <i data-lucide="${u.is_admin ? 'shield-off' : 'shield-check'}" style="width:12px;height:12px"></i>
          ${u.is_admin ? 'Demote' : 'Make Admin'}
        </button>
      </td>
      <td>
        <button class="ad-view-btn ad-btn--danger"
          onclick="event.stopPropagation();deleteUser(${u.id}, '${escHtml(u.username)}')">
          <i data-lucide="trash-2" style="width:12px;height:12px"></i>
          Delete
        </button>
      </td>
    </tr>`;
  }).join('');

  lucide.createIcons();
  renderPagination('userPagination', page, totalPages, 'goToUserPage');
}

async function toggleAdmin(userId, isCurrentlyAdmin) {
  const action    = isCurrentlyAdmin ? 'demote' : 'promote';
  const confirmed = confirm(`Are you sure you want to ${action} this user?`);
  if (!confirmed) return;

  try {
    const res = await fetch(`/admin/users/${userId}/toggle-admin`, {
      method: 'PATCH',
      headers: authHeaders(),
      body: JSON.stringify({ is_admin: !isCurrentlyAdmin })
    });
    if (res.status === 401) { adminLogout(); return; }
    if (res.ok) {
      await loadUsers();
      _filteredUsers = allUsers;
      renderUsers(allUsers);
    } else {
      const err = await res.json();
      alert(err.message || 'Failed to update user role.');
    }
  } catch {
    alert('Network error. Please try again.');
  }
}

function toggleUserClear() {
  const val = document.getElementById('userSearch').value;
  document.getElementById('userClearBtn').style.display = val.length > 0 ? 'flex' : 'none';
}
function clearUserSearch() {
  document.getElementById('userSearch').value = '';
  document.getElementById('userClearBtn').style.display = 'none';
  filterUsers();
}

async function deleteUser(userId, username) {
  const confirmed = confirm(`Delete user "${username}"?\n\nThis will permanently remove the account and all their data.`);
  if (!confirmed) return;
 
  try {
    const res = await fetch(`/admin/users/${userId}`, {
      method: 'DELETE',
      headers: authHeaders()
    });
    if (res.status === 401) { adminLogout(); return; }
    if (res.ok) {
      allUsers      = allUsers.filter(u => u.id !== userId);
      allDetections = allDetections.filter(d => d.user_id !== userId);
      _filteredUsers = _filteredUsers.filter(u => u.id !== userId);
      document.getElementById('navBadgeUsers').textContent = allUsers.length;
      document.getElementById('navBadgeDetections').textContent = allDetections.length;
      renderUsers(_filteredUsers);
      renderOverview();
    } else {
      const err = await res.json().catch(() => ({}));
      alert(err.message || 'Failed to delete user.');
    }
  } catch {
    alert('Network error. Please try again.');
  }
}
 
async function deleteDetection(detectionId) {
  const confirmed = confirm('Delete this detection record?\n\nThis action cannot be undone.');
  if (!confirmed) return;
 
  try {
    const res = await fetch(`/admin/detections/${detectionId}`, {
      method: 'DELETE',
      headers: authHeaders()
    });
    if (res.status === 401) { adminLogout(); return; }
    if (res.ok) {
      allDetections       = allDetections.filter(d => d.id !== detectionId);
      _filteredDetections = _filteredDetections.filter(d => d.id !== detectionId);
      document.getElementById('navBadgeDetections').textContent = allDetections.length;
      renderDetections(_filteredDetections);
      renderOverview();
    } else {
      const err = await res.json().catch(() => ({}));
      alert(err.message || 'Failed to delete detection.');
    }
  } catch {
    alert('Network error. Please try again.');
  }
}
 
async function deleteFeedback(feedbackId) {
  const confirmed = confirm('Delete this feedback entry?\n\nThis action cannot be undone.');
  if (!confirmed) return;
 
  try {
    const res = await fetch(`/admin/feedback/${feedbackId}`, {
      method: 'DELETE',
      headers: authHeaders()
    });
    if (res.status === 401) { adminLogout(); return; }
    if (res.ok) {
      allFeedback = allFeedback.filter(f => f.id !== feedbackId);
      document.getElementById('navBadgeFeedback').textContent = allFeedback.length;
      computeFeedbackStats();   
      applyFilters();          
    } else {
      const err = await res.json().catch(() => ({}));
      alert(err.message || 'Failed to delete feedback.');
    }
  } catch {
    alert('Network error. Please try again.');
  }
}

function viewUser(userId) {
  const user = allUsers.find(u => u.id === userId);
  if (!user) return;

  const detects = allDetections.filter(d => d.user_id === userId);

  document.getElementById('usersMain').style.display  = 'none';
  document.getElementById('userDetail').style.display = 'block';

  document.getElementById('userDetailCard').innerHTML = `
    <div class="ad-detail-avatar">${user.username.slice(0,2).toUpperCase()}</div>
    <div>
      <div class="ad-detail-name">${escHtml(user.username)}</div>
      <div class="ad-detail-email">${escHtml(user.email)}</div>
      <div class="ad-detail-stats">
        <div class="ad-detail-stat">Joined: <strong>${fmtDate(user.created_at)}</strong></div>
        <div class="ad-detail-stat">Detections: <strong>${detects.length}</strong></div>
        <div class="ad-detail-stat">Role: <strong>${user.is_admin ? 'Admin' : 'User'}</strong></div>
      </div>
    </div>
  `;

  const tbody = document.getElementById('userDetectBody');
  if (!detects.length) {
    tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:40px;color:var(--text-soft)">No detections yet</td></tr>`;
  } else {
    tbody.innerHTML = detects.map((d, i) => `
      <tr>
        <td style="color:var(--text-soft)">${i + 1}</td>
        <td><strong>${escHtml(d.predicted_class)}</strong></td>
        <td><strong style="color:var(--leaf)">${d.confidence}%</strong></td>
        <td>${d.severity_pct}%</td>
        <td><span class="ad-badge ad-badge--${STAGE_BADGE[d.stage] || 'gray'}">${escHtml(d.stage)}</span></td>
        <td style="font-size:12px;color:var(--text-soft);max-width:220px">${escHtml(d.urgency)}</td>
        <td style="color:var(--text-soft)">${fmtDateTime(d.created_at)}</td>
      </tr>`).join('');
  }

  lucide.createIcons();
}

function closeUserDetail() {
  document.getElementById('userDetail').style.display = 'none';
  document.getElementById('usersMain').style.display  = 'block';
}

//  DETECTIONS TAB
function filterDetections() {
  const q     = document.getElementById('detectSearch').value.toLowerCase();
  const stage = document.getElementById('detectStage').value;
  const sort  = document.getElementById('detectSort')
    ? document.getElementById('detectSort').value : 'newest';

  let list = allDetections.filter(d => {
    if (stage && d.stage !== stage) return false;
    if (q && !(
      d.predicted_class.toLowerCase().includes(q) ||
      (d.username || '').toLowerCase().includes(q)
    )) return false;
    return true;
  });

  if (sort === 'newest')          list.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  else if (sort === 'oldest')     list.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  else if (sort === 'confidence') list.sort((a, b) => b.confidence   - a.confidence);
  else if (sort === 'severity')   list.sort((a, b) => b.severity_pct - a.severity_pct);

  _filteredDetections = list;
  detectCurrentPage   = 1;
  renderDetections(list);
}

function goToDetectPage(page) {
  detectCurrentPage = page;
  renderDetections(_filteredDetections);
}

function renderDetections(detections) {
  const totalPages  = Math.max(1, Math.ceil(detections.length / DETECTIONS_PER_PAGE));
  const page        = Math.min(detectCurrentPage, totalPages);
  detectCurrentPage = page;

  const start = (page - 1) * DETECTIONS_PER_PAGE;
  const items = detections.slice(start, start + DETECTIONS_PER_PAGE);
  const total = detections.length;

  const from = total === 0 ? 0 : start + 1;
  const to   = Math.min(start + DETECTIONS_PER_PAGE, total);
  document.getElementById('detectCount').textContent =
    `Showing ${from}–${to} of ${total} detections`;

  const tbody = document.getElementById('detectionsBody');
  if (!items.length) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:40px;color:var(--text-soft)">No detections found</td></tr>`;
    document.getElementById('detectPagination').innerHTML = '';
    return;
  }

  tbody.innerHTML = items.map((d, i) => `
    <tr>
      <td style="color:var(--text-soft)">${start + i + 1}</td>
      <td>
        <div class="ad-cell-user">
          <div class="ad-cell-avatar" style="background:var(--blue-pale);color:var(--blue)">
            ${(d.username || '?').slice(0,2).toUpperCase()}
          </div>
          <span>${escHtml(d.username || 'Unknown')}</span>
        </div>
      </td>
      <td><strong>${escHtml(d.predicted_class)}</strong></td>
      <td><strong style="color:var(--leaf)">${d.confidence}%</strong></td>
      <td>${d.severity_pct}%</td>
      <td><span class="ad-badge ad-badge--${STAGE_BADGE[d.stage] || 'gray'}">${escHtml(d.stage)}</span></td>
      <td style="color:var(--text-soft)">${fmtDateTime(d.created_at)}</td>
      <td>
        <button class="ad-view-btn ad-btn--danger"
          onclick="deleteDetection(${d.id})">
          <i data-lucide="trash-2" style="width:12px;height:12px"></i>
          Delete
        </button>
      </td>
    </tr>`).join('');

  lucide.createIcons();
  renderPagination('detectPagination', page, totalPages, 'goToDetectPage');
}

function toggleDetectClear() {
  const val = document.getElementById('detectSearch').value;
  document.getElementById('detectClearBtn').style.display = val.length > 0 ? 'flex' : 'none';
}
function clearDetectSearch() {
  document.getElementById('detectSearch').value = '';
  document.getElementById('detectClearBtn').style.display = 'none';
  filterDetections();
}


//  FEEDBACK TAB
function computeFeedbackStats() {
  const total = allFeedback.length;
  document.getElementById('statTotal').textContent = total;
 
  if (!total) {
    document.getElementById('statAvgRating').textContent    = '—';
    document.getElementById('statSatisfaction').textContent = '—';
    document.getElementById('statTopCat').textContent       = '—';
    renderFeedbackCharts([]);   
    return;
  }
 
  const avg = (allFeedback.reduce((s, f) => s + f.rating, 0) / total).toFixed(1);
  document.getElementById('statAvgRating').textContent = `${avg} / 5`;
 
  const happy        = allFeedback.filter(f => f.rating >= 4).length;
  const satisfaction = Math.round((happy / total) * 100);
  document.getElementById('statSatisfaction').textContent = `${satisfaction}%`;
 
  const catCount = {};
  allFeedback.forEach(f => { catCount[f.category] = (catCount[f.category] || 0) + 1; });
  const topCat = Object.entries(catCount).sort((a, b) => b[1] - a[1])[0];
  document.getElementById('statTopCat').textContent =
    topCat ? (CAT_LABELS[topCat[0]] || topCat[0]) : '—';
 
  //  render the two charts
  renderFeedbackCharts(allFeedback);
}

function renderFeedbackCharts(feedbackData) {
 
  //  Rating Distribution Bar Chart
  const ratingCounts = [1, 2, 3, 4, 5].map(
    r => feedbackData.filter(f => f.rating === r).length
  );
 
  const ratingCtx = document.getElementById('fbRatingChart').getContext('2d');
 
  if (fbRatingChartInstance) fbRatingChartInstance.destroy();
 
  fbRatingChartInstance = new Chart(ratingCtx, {
    type: 'bar',
    data: {
      labels: ['1 ★', '2 ★', '3 ★', '4 ★', '5 ★'],
      datasets: [{
        label: 'Responses',
        data: ratingCounts,
        backgroundColor: [
          'rgba(198, 40,  40,  0.80)',   // 1★ red
          'rgba(230, 81,  0,   0.85)',   // 2★ deep orange
          'rgba(106, 27,  154, 0.80)',   // 3★ purple
          'rgba(0,   121, 107, 0.82)',   // 4★ teal
          'rgba(46,  125, 50,  0.90)',   // 5★ green
        ],
        borderRadius: 8,
        borderSkipped: false,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: ctx => ` ${ctx.parsed.y} response${ctx.parsed.y !== 1 ? 's' : ''}`
          }
        }
      },
      scales: {
        x: { grid: { display: false } },
        y: {
          beginAtZero: true,
          grid: { color: 'rgba(0,0,0,0.05)' },
          ticks: { precision: 0 }
        }
      }
    }
  });
 
  //  Category Donut Chart 
  const catOrder  = ['accuracy', 'speed', 'ui', 'treatment', 'language', 'other'];
  const catLabels = catOrder.map(k => CAT_LABELS[k] || k);
  const catValues = catOrder.map(
    k => feedbackData.filter(f => f.category === k).length
  );
  const catColors = [
    'rgba(46,  125, 50,  0.85)',   // accuracy  — green
    'rgba(21,  101, 192, 0.80)',   // speed     — blue
    'rgba(106, 27,  154, 0.80)',   // ui        — purple
    'rgba(245, 127, 23,  0.85)',   // treatment — amber
    'rgba(21,  101, 192, 0.50)',   // language  — light blue
    'rgba(120, 120, 120, 0.55)',   // other     — gray
  ];
 
  const catCtx = document.getElementById('fbCatChart').getContext('2d');
 
  if (fbCatChartInstance) fbCatChartInstance.destroy();
 
  fbCatChartInstance = new Chart(catCtx, {
    type: 'doughnut',
    data: {
      labels: catLabels,
      datasets: [{
        data: catValues,
        backgroundColor: catColors,
        borderColor: '#fff',
        borderWidth: 2,
        hoverOffset: 8,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '62%',
      plugins: {
        legend: {
          position: 'right',
          labels: {
            boxWidth: 11,
            padding: 14,
            font: { size: 12, family: "'Nunito', sans-serif", weight: '700' },
            color: '#4a6350',
          }
        },
        tooltip: {
          callbacks: {
            label: ctx => ` ${ctx.label}: ${ctx.parsed} response${ctx.parsed !== 1 ? 's' : ''}`
          }
        }
      }
    }
  });
}

function applyFilters() {
  const query    = document.getElementById('searchInput').value.toLowerCase();
  const rating   = document.getElementById('filterRating').value;
  const category = document.getElementById('filterCategory').value;

  const filtered = allFeedback.filter(f => {
    if (rating   && String(f.rating) !== rating)   return false;
    if (category && f.category       !== category) return false;
    if (query && !(f.message || '').toLowerCase().includes(query)) return false;
    return true;
  });

  renderFeedbackList(filtered);
  document.getElementById('resultsCount').textContent =
    `Showing ${filtered.length} of ${allFeedback.length} responses`;
}

function toggleFeedbackClear() {
  const val = document.getElementById('searchInput').value;
  document.getElementById('feedbackClearBtn').style.display = val.length > 0 ? 'flex' : 'none';
}
function clearFeedbackSearch() {
  document.getElementById('searchInput').value = '';
  document.getElementById('feedbackClearBtn').style.display = 'none';
  applyFilters();
}

function renderFeedbackList(items) {
  const list  = document.getElementById('feedbackList');
  const empty = document.getElementById('emptyState');

  if (!items.length) {
    list.innerHTML = '';
    empty.style.display = 'flex';
    return;
  }
  empty.style.display = 'none';

  list.innerHTML = items.map((f, i) => {
    const catLabel    = CAT_LABELS[f.category] || f.category;
    const catIcon     = CAT_ICONS[f.category]  || 'tag';
    const stars       = '★'.repeat(f.rating) + '☆'.repeat(5 - f.rating);
    const ratingClass = f.rating >= 4 ? 'good' : f.rating === 3 ? 'mid' : 'bad';

    return `
    <div class="ad-card" style="animation-delay:${i * 25}ms">
      <div class="ad-card-top">
        <div class="ad-card-left">
          <div class="ad-user-avatar">${(f.username || 'A').slice(0,2).toUpperCase()}</div>
          <div>
            <div class="ad-username-label">${escHtml(f.username || 'Anonymous')}</div>
            <div class="ad-stars ad-stars--${ratingClass}">${stars}</div>
            <div class="ad-rating-text">Rating ${f.rating}/5</div>
          </div>
        </div>
        <div class="ad-card-right">
          <div class="ad-cat-tag">
            <i data-lucide="${catIcon}" style="width:12px;height:12px"></i>
            ${catLabel}
          </div>
        </div>
      </div>
      <div class="ad-card-message">
        ${f.message ? `<p>${escHtml(f.message)}</p>` : '<p class="ad-no-msg">No message provided.</p>'}
      </div>
      <div class="ad-card-footer">
        <div class="ad-card-meta">
          <i data-lucide="clock" style="width:12px;height:12px"></i>
          ${fmtDateTime(f.created_at)}
        </div>
        <div style="display:flex;align-items:center;gap:10px;">
          <div class="ad-card-id">#${f.id}</div>
          <button class="ad-view-btn ad-btn--danger"
            onclick="deleteFeedback(${f.id})">
            <i data-lucide="trash-2" style="width:12px;height:12px"></i>
            Delete
          </button>
        </div>
      </div>
    </div>`;
  }).join('');

  lucide.createIcons();
}


//  INIT
refreshAll();