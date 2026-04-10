function initNavbar(page) {
  // Redirect to login
  const publicPages = ['login', 'register', 'portal'];
  if (!publicPages.includes(page) && !Session.isLoggedIn()) {
    window.location.href = 'login.html';
    return;
  }

  // Mark active nav link 
  document.querySelectorAll('.nav-links a, .mobile-nav a').forEach(a => {
    a.classList.remove('active');
    const href = a.getAttribute('href') || '';
    if (
      (page === 'home'    && href.includes('index'))   ||
      (page === 'detect'  && href.includes('detect'))  ||
      (page === 'history' && href.includes('history')) ||
      (page === 'profile' && href.includes('profile')) ||
      (page === 'feedback' && href.includes('feedback')) ||
      (page === 'about'   && href.includes('about'))
    ) {
      a.classList.add('active');
    }
  });

  //  Build right side (profile button or login) 
  const navRight      = document.getElementById('navRight');
  const mobileNavAuth = document.getElementById('mobileNavAuth');
  const user          = Session.getUser();
  const isAdmin = user?.is_admin === true || user?.role === 'admin';


  if (user) {
    const initials = (user.username || 'U').slice(0, 2).toUpperCase();

    // Desktop: greeting (home only) + avatar button + dropdown
    navRight.innerHTML = `
      ${page === 'home'
        ? `<span class="nav-greeting">Hi, <span>${user.username}</span></span>`
        : ''}
      <div class="nav-profile-wrap" style="position:relative;">
        <button class="nav-profile-btn" id="profileBtn" title="Your profile">
          ${initials}
        </button>
        <div class="nav-dropdown" id="navDropdown">
          <div class="nav-dropdown-header">
            <span class="nav-dropdown-name">${user.username}</span>
            <span class="nav-dropdown-email">${user.email || ''}</span>
          </div>
          <a href="profile.html" class="nav-dropdown-item">
            <i data-lucide="user" style="width:15px;height:15px;flex-shrink:0;"></i>
            My Profile
          </a>
          ${isAdmin ? `
          <a href="admin.html" class="nav-dropdown-item">
          <i data-lucide="shield" style="width:15px;height:15px;flex-shrink:0;"></i>
          Admin Dashboard
          </a>
          <div class="nav-dropdown-divider"></div>
         ` : ''}
          <button class="nav-dropdown-item danger" onclick="navLogout()">
            <i data-lucide="log-out" style="width:15px;height:15px;flex-shrink:0;"></i>
            Logout
          </button>
        </div>
      </div>
    `;

    // Mobile: admin link (if admin) + logout button inside drawer
mobileNavAuth.innerHTML = `
  ${isAdmin ? `
    <a href="admin.html" class="mobile-nav-admin">
      <i data-lucide="shield" style="width:15px;height:15px"></i>
      Admin Dashboard
    </a>` : ''}
  <button class="mobile-nav-logout" onclick="navLogout()">Logout</button>
`;

    // Dropdown open/close
    document.getElementById('profileBtn').addEventListener('click', e => {
      e.stopPropagation();
      document.getElementById('navDropdown').classList.toggle('open');
    });

  } else {
    // Not logged in
    navRight.innerHTML      = `<a href="login.html" class="btn-nav-login">Login</a>`;
    mobileNavAuth.innerHTML = `<a href="login.html">Login</a>`;
  }

  // Re-render lucide icons inside the injected HTML
  lucide.createIcons();

  //  Close dropdown on outside click
  document.addEventListener('click', () => {
    const dd = document.getElementById('navDropdown');
    if (dd) dd.classList.remove('open');
  });

  //  Hamburger toggle 
  const hamburger = document.getElementById('hamburger');
  const mobileNav = document.getElementById('mobileNav');

  if (hamburger && mobileNav) {
    hamburger.addEventListener('click', e => {
      e.stopPropagation();
      hamburger.classList.toggle('open');
      mobileNav.classList.toggle('open');
    });

    // Close drawer on outside click
    document.addEventListener('click', () => {
      hamburger.classList.remove('open');
      mobileNav.classList.remove('open');
    });
  }
}

//  Logout 
function navLogout() {
  Session.logout();
  showToast('success', 'Logged out successfully.');
  setTimeout(() => {
    window.location.href = 'login.html';
  }, 700);
}