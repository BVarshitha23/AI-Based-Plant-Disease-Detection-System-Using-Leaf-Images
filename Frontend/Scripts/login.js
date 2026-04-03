lucide.createIcons();

if (Session.isLoggedIn()) window.location.href = "index.html";

async function handleLogin(e) {
  e.preventDefault();

  const email = document.getElementById("username").value.trim();
  const password = document.getElementById("password").value;

  const btn = document.getElementById("loginBtn");
  const errBox = document.getElementById("authError");

  errBox.classList.remove("show");

  btn.disabled = true;
  btn.innerHTML =
    '<span class="spinner" style="width:18px;height:18px;border-width:2px;"></span> Signing in...';

  const result = await Session.login(email, password);

  if (result.ok) {
    showToast("success", "Signed in successfully!");
    setTimeout(() => {
      window.location.href = "index.html";
    }, 700);
} else {
    document.getElementById("authErrorMsg").textContent =
      result.error || "Invalid email or password.";
    errBox.classList.add("show");

    btn.disabled = false;
    btn.innerHTML =
      '<i data-lucide="log-in" style="width:17px;height:17px;"></i> Sign In';
    lucide.createIcons();
  }
}

//  Toggle password
function togglePw(id, btn) {
  const inp = document.getElementById(id);
  const isText = inp.type === "text";

  inp.type = isText ? "password" : "text";

  btn.innerHTML = isText
    ? '<i data-lucide="eye" style="width:16px;height:16px;"></i>'
    : '<i data-lucide="eye-off" style="width:16px;height:16px;"></i>';

  lucide.createIcons();
}
