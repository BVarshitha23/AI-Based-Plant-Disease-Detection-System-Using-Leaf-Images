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

function renderProfile(user) {
  document.getElementById("profileName").textContent = user.username || "User";
  document.getElementById("profileEmail").textContent = user.email || "";
  document.getElementById("detailUsername").textContent = user.username || "-";
  document.getElementById("detailEmail").textContent = user.email || "-";
  document.getElementById("detailCreatedAt").textContent =
    formatJoinedDate(user.created_at);
}

async function loadProfile() {
  if (!Session.requireAuth()) return;

  Session.renderProtectedNav();

  const cachedUser = Session.getUser();
  if (cachedUser) {
    renderProfile(cachedUser);
  }

  const result = await Session.syncUser();

  if (result.ok && result.user) {
    renderProfile(result.user);
  } else if (!cachedUser) {
    document.getElementById("profileName").textContent = "Failed to load";
    document.getElementById("profileEmail").textContent =
      result.error || "Login again.";
  }
}

document.addEventListener("DOMContentLoaded", () => {
  loadProfile();

  document.getElementById("logoutBtn").addEventListener("click", () => {
    Session.logout();
    window.location.href = "login.html";
  });
});