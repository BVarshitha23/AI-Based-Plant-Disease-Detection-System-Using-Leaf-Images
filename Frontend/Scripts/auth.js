const Session = {
  //  Check login 
  isLoggedIn: () => !!sessionStorage.getItem("ls_user"),

  // Register 
  register: async (username, email, password) => {
    try {
      const res = await fetch("/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, email, password }),
      });
      const data = await res.json();

      if (res.ok) {
        return { ok: true };
      } else {
        return { ok: false, error: data.detail || "Registration failed" };
      }
    } catch (e) {
      return { ok: false, error: "Network error" };
    }
  },

  //  Login 
  login: async (email, password) => {
    try {
      const res = await fetch("/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      const data = await res.json();

      if (res.ok) {
        const session = {
          ...data.user,
          token: data.access_token,
        };

        sessionStorage.setItem("ls_user", JSON.stringify(session));

        return { ok: true, user: data.user };
      } else {
        return { ok: false, error: data.detail || "Login failed" };
      }
    } catch (e) {
      return { ok: false, error: "Network error" };
    }
  },

  //  Logout ─
  logout: () => {
    sessionStorage.removeItem("ls_user");
  },

  // Get user 
  getUser: () => {
    const raw = sessionStorage.getItem("ls_user");
    return raw ? JSON.parse(raw) : null;
  },

  // Get JWT token 
  getToken: () => {
    const raw = sessionStorage.getItem("ls_user");
    if (!raw) return null;
    return JSON.parse(raw).token || null;
  },

  //  Auth header 
  authHeaders: () => {
    const token = Session.getToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
  },

  //  Protect pages 
  requireAuth: () => {
    if (!Session.isLoggedIn()) {
      window.location.href = "login.html";
      return false;
    }
    return true;
  },

  //  Navbar (Profile instead of Logout) 
  renderProtectedNav: () => {
    const navAuth = document.getElementById("navAuth");
    if (!navAuth) return;

    const user = Session.getUser();

    if (user) {
      navAuth.innerHTML = `
        <a href="profile.html" class="btn-nav-login">Profile</a>
      `;
    } else {
      navAuth.innerHTML = `
        <a href="login.html" class="btn-nav-login">Login</a>
      `;
    }
  },

  //  Sync user from backend 
  syncUser: async () => {
    try {
      const res = await fetch("/auth/me", {
        headers: {
          ...Session.authHeaders(),
        },
      });

      if (!res.ok) {
        return { ok: false, error: "Failed to fetch user" };
      }

      const data = await res.json();

      const current = Session.getUser();
      const updated = {
        ...current,
        ...data.user,
      };

      sessionStorage.setItem("ls_user", JSON.stringify(updated));

      return { ok: true, user: data.user };
    } catch (e) {
      return { ok: false, error: "Network error" };
    }
  },
};

//  Toast helper 
function showToast(type, message) {
  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `
    <i data-lucide="${type === "success" ? "check-circle" : "alert-circle"}" style="width:16px;height:16px;"></i>
    <span>${message}</span>
  `;

  document.body.appendChild(toast);

  setTimeout(() => toast.classList.add("show"), 100);

  setTimeout(() => {
    toast.classList.remove("show");
    setTimeout(() => document.body.removeChild(toast), 300);
  }, 3000);

  if (typeof lucide !== "undefined") {
    lucide.createIcons();
  }
}