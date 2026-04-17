lucide.createIcons();

if (Session.isLoggedIn()) window.location.href = "index.html";

async function handleLogin(e) {
  e.preventDefault();

  const email = document.getElementById("username").value.trim();
  const password = document.getElementById("password").value;
  const btn = document.getElementById("loginBtn");
  const errBox = document.getElementById("authError");

  //  reCAPTCHA check 
  const captchaResponse = grecaptcha.getResponse();
  const captchaError    = document.getElementById("captchaError");

  if (!captchaResponse) {
    captchaError.style.display = "block";
    return;
  }
  captchaError.style.display = "none";

  errBox.classList.remove("show");

  btn.disabled = true;
  btn.innerHTML =
    '<span class="spinner" style="width:18px;height:18px;border-width:2px;"></span> Signing in...';

  const result = await Session.login(email, password, captchaResponse);

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
    grecaptcha.reset();
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

let fpEmail = "";

function showForgotModal() {
  document.getElementById("forgotModal").style.display = "flex";
}

function closeForgotModal() {
  document.getElementById("forgotModal").style.display = "none";
  document.getElementById("fpStep1").style.display = "block";
  document.getElementById("fpStep2").style.display = "none";
  document.getElementById("fpStep3").style.display = "none";
  document.getElementById("fpEmail").value = "";
  document.getElementById("fpOTP").value = "";
}

async function sendOTP() {
  const email = document.getElementById("fpEmail").value.trim();
  const errEl = document.getElementById("fpError1");
  errEl.style.display = "none";

  if (!email) { errEl.textContent = "Please enter your email."; errEl.style.display = "block"; return; }

  const res  = await fetch("/auth/forgot-password", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });
  const data = await res.json();

  if (res.ok) {
    fpEmail = email;
    document.getElementById("fpStep1").style.display = "none";
    document.getElementById("fpStep2").style.display = "block";
  } else {
    errEl.textContent = data.detail || "Failed to send OTP.";
    errEl.style.display = "block";
  }
}

async function verifyOTP() {
  const otp   = document.getElementById("fpOTP").value.trim();
  const errEl = document.getElementById("fpError2");
  errEl.style.display = "none";

  if (otp.length !== 6) { errEl.textContent = "Enter the 6-digit OTP."; errEl.style.display = "block"; return; }

  const res  = await fetch("/auth/verify-otp", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: fpEmail, otp }),
  });
  const data = await res.json();

  if (res.ok) {
    document.getElementById("fpStep2").style.display = "none";
    document.getElementById("fpStep3").style.display = "block";
  } else {
    errEl.textContent = data.detail || "Invalid OTP.";
    errEl.style.display = "block";
  }
}

async function resetPassword() {
  const password  = document.getElementById("fpNewPw").value;
  const confirm   = document.getElementById("fpConfirmPw").value;
  const otp       = document.getElementById("fpOTP").value.trim();
  const errEl     = document.getElementById("fpError3");
  errEl.style.display = "none";

  if (password.length < 8) { errEl.textContent = "Password must be at least 8 characters."; errEl.style.display = "block"; return; }
  if (password !== confirm) { errEl.textContent = "Passwords do not match."; errEl.style.display = "block"; return; }

  const res  = await fetch("/auth/reset-password", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: fpEmail, otp, password }),
  });
  const data = await res.json();

  if (res.ok) {
    closeForgotModal();
    showToast("success", "Password reset! Please sign in.");
  } else {
    errEl.textContent = data.detail || "Reset failed.";
    errEl.style.display = "block";
  }
}

document.getElementById("loginForm").addEventListener("reset", () => {
  document.getElementById("authError").classList.remove("show");
  document.getElementById("usernameError").classList.remove("show");
  document.getElementById("pwError").classList.remove("show");
});

// SMART BUTTON ENABLE/DISABLE 

const loginBtn   = document.getElementById('loginBtn');
const emailInput = document.getElementById('username');
const pwInput    = document.getElementById('password');

function checkFormReady() {
  const emailOk   = emailInput.value.trim().length > 0;
  const pwOk      = pwInput.value.length > 0;
  const captchaOk = grecaptcha.getResponse().length > 0;

  loginBtn.disabled = !(emailOk && pwOk && captchaOk);
}

// Listen to typing
emailInput.addEventListener('input', checkFormReady);
pwInput.addEventListener('input', checkFormReady);

// reCAPTCHA doesn't fire DOM events, so we poll it every 500ms
setInterval(checkFormReady, 500);

// Run once on load so button starts disabled
checkFormReady();