/*  Date formatter  */
function formatJoinedDate(value) {
  if (!value) return "-";
  const parsed = new Date(value);
  if (isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/* Render basic profile info  */
function renderProfile(user) {
  document.getElementById("profileName").textContent = user.username || "User";
  document.getElementById("profileEmail").textContent = user.email || "";
  document.getElementById("detailUsername").textContent = user.username || "-";
  document.getElementById("detailEmail").textContent = user.email || "-";
  document.getElementById("detailCreatedAt").textContent = formatJoinedDate(user.created_at);
}

/*  Detection stats  */
async function loadDetectionStats() {
  try {
    const token = Session.getUser()?.token;
    const res = await fetch("/api/history", {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return;
    const data = await res.json();
    const detections = data.records || [];

    document.getElementById("statTotal").textContent =
      detections.length > 0 ? detections.length : "0";

    if (detections.length) {
      const freq = {};
      detections.forEach((d) => {
        const name = (d.predicted_class || "Unknown").split(" - ")[0];
        freq[name] = (freq[name] || 0) + 1;
      });
      const top = Object.entries(freq).sort((a, b) => b[1] - a[1])[0];
      document.getElementById("statTopDisease").textContent = top ? top[0] : "—";

      const latest = [...detections].sort(
        (a, b) => new Date(b.created_at) - new Date(a.created_at)
      )[0];
      document.getElementById("statLastScan").textContent = latest
        ? formatJoinedDate(latest.created_at)
        : "—";
    } else {
      document.getElementById("statTopDisease").textContent = "None yet";
      document.getElementById("statLastScan").textContent = "Never";
    }
  } catch {
    // silently fail — stats are non-critical
  }
}

/*  Load profile  */
async function loadProfile() {
  if (!Session.requireAuth()) return;

  Session.renderProtectedNav();

  const cachedUser = Session.getUser();
  if (cachedUser) renderProfile(cachedUser);

  const result = await Session.syncUser();
  if (result.ok && result.user) {
    renderProfile(result.user);
  } else if (!cachedUser) {
    document.getElementById("profileName").textContent = "Failed to load";
    document.getElementById("profileEmail").textContent =
      result.error || "Login again.";
  }

  loadDetectionStats();
}

/* Toggle password visibility  */
function togglePwd(inputId, btn) {
  const input = document.getElementById(inputId);
  const isHidden = input.type === "password";
  input.type = isHidden ? "text" : "password";
  btn.innerHTML = isHidden
    ? `<i data-lucide="eye-off" style="width:15px;height:15px"></i>`
    : `<i data-lucide="eye" style="width:15px;height:15px"></i>`;
  lucide.createIcons();
}

/* Change password  */
async function changePassword() {
  const current = document.getElementById("pwdCurrent").value.trim();
  const newPwd  = document.getElementById("pwdNew").value.trim();
  const confirm = document.getElementById("pwdConfirm").value.trim();
  const msg     = document.getElementById("pwdMsg");

  msg.className   = "pwd-msg";
  msg.textContent = "";

  if (!current || !newPwd || !confirm) {
    msg.className   = "pwd-msg error";
    msg.textContent = "Please fill in all fields.";
    return;
  }
  if (newPwd.length < 8) {
    msg.className   = "pwd-msg error";
    msg.textContent = "New password must be at least 8 characters.";
    return;
  }
  if (newPwd !== confirm) {
    msg.className   = "pwd-msg error";
    msg.textContent = "New passwords do not match.";
    return;
  }

  try {
    const token = Session.getUser()?.token;
    const res = await fetch("/auth/change-password", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        current_password: current,
        new_password: newPwd,
      }),
    });
    const data = await res.json();
    if (res.ok) {
      msg.className   = "pwd-msg success";
      msg.textContent = "Password updated successfully!";
      document.getElementById("pwdCurrent").value = "";
      document.getElementById("pwdNew").value     = "";
      document.getElementById("pwdConfirm").value = "";
    } else {
      msg.className   = "pwd-msg error";
      msg.textContent = data.error || "Failed to update password.";
    }
  } catch {
    msg.className   = "pwd-msg error";
    msg.textContent = "Network error. Please try again.";
  }
}

/* Delete account modal  */
function showDeleteConfirm() {
  document.getElementById("deleteModal").style.display = "flex";
  document.getElementById("deleteConfirmInput").value  = "";
  document.getElementById("deleteConfirmBtn").disabled = true;
  lucide.createIcons();
}

function hideDeleteConfirm() {
  document.getElementById("deleteModal").style.display = "none";
}

async function deleteAccount() {
  try {
    const token = Session.getUser()?.token;
    const res = await fetch("/auth/delete-account", {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) {
      Session.logout();
      window.location.href = "login.html";
    } else {
      const data = await res.json();
      hideDeleteConfirm();
      alert(data.error || "Failed to delete account.");
    }
  } catch {
    hideDeleteConfirm();
    alert("Network error. Please try again.");
  }
}

/* DOMContentLoaded  */
document.addEventListener("DOMContentLoaded", () => {
  loadProfile();

  document.getElementById("logoutBtn").addEventListener("click", () => {
    Session.logout();
    window.location.href = "login.html";
  });

  const deleteInput = document.getElementById("deleteConfirmInput");
  if (deleteInput) {
    deleteInput.addEventListener("input", () => {
      document.getElementById("deleteConfirmBtn").disabled =
        deleteInput.value.trim() !== "DELETE";
    });
  }
});