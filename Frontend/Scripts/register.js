if (Session.isLoggedIn()) window.location.href = "index.html"; 

document.getElementById("name").addEventListener("input", function () {
  this.value = this.value.replace(/[^a-zA-Z\s]/g, "");
});

function checkStrength(val) {
  const fill  = document.getElementById("pwStrengthFill");
  const label = document.getElementById("pwStrengthLabel");
  fill.className = "pw-strength-fill";
  if (!val) { label.textContent = ""; return; }
  let score = 0;
  if (val.length >= 8)           score++;
  if (/[A-Z]/.test(val))         score++;
  if (/[0-9]/.test(val))         score++;
  if (/[^a-zA-Z0-9]/.test(val))  score++;
  if (score <= 1) {
    fill.classList.add("weak");   label.textContent = "Weak";
  } else if (score <= 2) {
    fill.classList.add("medium"); label.textContent = "Medium";
  } else {
    fill.classList.add("strong"); label.textContent = "Strong";
  }
}

function togglePw(id, btn) {
  const inp = document.getElementById(id);
  const isText = inp.type === "text";
  inp.type = isText ? "password" : "text";
  btn.innerHTML = isText
    ? '<i data-lucide="eye" style="width:16px;height:16px;"></i>'
    : '<i data-lucide="eye-off" style="width:16px;height:16px;"></i>';
  lucide.createIcons();
}

async function handleRegister(e) {
  e.preventDefault();

  const name     = document.getElementById("name").value.trim();
  const email    = document.getElementById("email").value.trim();
  const password = document.getElementById("password").value;
  const confirm  = document.getElementById("confirm").value;
  const btn      = document.getElementById("registerBtn");
  const errBox   = document.getElementById("authError");

  errBox.classList.remove("show");
  ["nameError","emailError","pwError","confirmError"].forEach(id =>
    document.getElementById(id).classList.remove("show")
  );

  if (!/^[a-zA-Z\s]+$/.test(name)) {
    const nameErr = document.getElementById("nameError");
    nameErr.textContent = "Name must contain only letters and spaces.";
    nameErr.classList.add("show"); return;
  }
  if (name.length < 2) {
    document.getElementById("nameError").classList.add("show"); return;
  }
  if (password.length < 8) {
    document.getElementById("pwError").classList.add("show"); return;
  }
  if (password !== confirm) {
    document.getElementById("confirmError").classList.add("show"); return;
  }

  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Creating account...';

  const result = await Session.register(name, email, password);

  if (result.ok) {
    Session.logout(); 
    showToast("success", "Account created! Please sign in.");
    setTimeout(() => window.location.href = "login.html", 800); 
  } else {
    document.getElementById("authErrorMsg").textContent =
      result.error || "Registration failed. Please try again.";
    errBox.classList.add("show");
    btn.disabled = false;
    btn.innerHTML =
      '<i data-lucide="user-plus" style="width:18px;height:18px;"></i> Create Account';
    lucide.createIcons();
  }
}
