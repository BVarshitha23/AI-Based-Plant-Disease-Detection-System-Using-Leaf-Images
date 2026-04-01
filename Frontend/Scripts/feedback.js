// ── State ──
let selectedRating   = 0;
let selectedCategory = '';

const ratingLabels = {
  1: '😞 Terrible — we\'ll do better!',
  2: '😕 Not great — sorry about that',
  3: '😐 It was okay',
  4: '😊 Good experience!',
  5: '🤩 Excellent — thank you!'
};

const categoryLabels = {
  accuracy:  'Disease Accuracy',
  speed:     'Speed',
  language:  'Language Support',
  ui:        'App Design',
  treatment: 'Treatment Advice',
  other:     'Other'
};

// ── Rating buttons ──
document.querySelectorAll('.fb-emoji-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    selectedRating = parseInt(btn.dataset.val);
    document.querySelectorAll('.fb-emoji-btn').forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');
    document.getElementById('ratingLabel').textContent = ratingLabels[selectedRating];
    checkStep1();
  });
});

// ── Category buttons ──
document.querySelectorAll('.fb-cat-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    selectedCategory = btn.dataset.cat;
    document.querySelectorAll('.fb-cat-btn').forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');
    checkStep1();
  });
});

function checkStep1() {
  const btn = document.getElementById('next1');
  btn.disabled = !(selectedRating > 0 && selectedCategory !== '');
}

// ── Character counter ──
document.getElementById('fbMessage').addEventListener('input', function () {
  const len = Math.min(this.value.length, 500);
  document.getElementById('charCount').textContent = len;
  if (this.value.length > 500) this.value = this.value.slice(0, 500);
});

// ── Step navigation ──
function goStep(step) {
  // Hide all panels
  document.querySelectorAll('.fb-step-panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.fb-step').forEach(s => {
    s.classList.remove('active', 'done');
  });
  document.querySelectorAll('.fb-step-line').forEach(l => l.classList.remove('done'));

  // Mark done steps
  for (let i = 1; i < step; i++) {
    document.getElementById(`step${i}dot`).classList.add('done');
    const line = document.getElementById(`line${i}`);
    if (line) line.classList.add('done');
  }

  // Activate current step
  document.getElementById(`step${step}dot`).classList.add('active');
  document.getElementById(`panel${step}`).classList.add('active');

  // If going to step 3, populate review
  if (step === 3) populateReview();

  // Re-init lucide icons for any new ones
  if (typeof lucide !== 'undefined') lucide.createIcons();
}

// ── Populate review ──
function populateReview() {
  const msg = document.getElementById('fbMessage').value.trim();

  document.getElementById('rv-rating').textContent =
    `${['😞','😕','😐','😊','🤩'][selectedRating - 1]} ${ratingLabels[selectedRating]?.split('—')[0].trim() || ''}`;
  document.getElementById('rv-cat').textContent = categoryLabels[selectedCategory] || '—';
  document.getElementById('rv-msg').textContent = msg || '(No message provided)';
}

// ── Submit ──
function submitFeedback() {
  const btn = document.getElementById('submitBtn');
  btn.disabled = true;
  btn.innerHTML = '<i data-lucide="loader-2" style="width:16px;height:16px;animation:spin 0.8s linear infinite"></i> Submitting...';
  if (typeof lucide !== 'undefined') lucide.createIcons();

  // Collect data
  const payload = {
    rating:    selectedRating,
    category:  selectedCategory,
    message:   document.getElementById('fbMessage').value.trim(),
    isFarmer:  document.getElementById('isFarmer').checked,
    timestamp: new Date().toISOString()
  };

  console.log('Feedback submitted:', payload);

  // Simulate API call — replace with your actual endpoint
  setTimeout(() => {
    document.getElementById('fbFormCard').style.display = 'none';
    const success = document.getElementById('fbSuccess');
    success.classList.add('show');
    if (typeof lucide !== 'undefined') lucide.createIcons();
  }, 1000);

  /*
  // ── Uncomment to connect to your real backend ──
  fetch('/feedback', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...Session.authHeaders()
    },
    body: JSON.stringify(payload)
  })
  .then(res => {
    if (!res.ok) throw new Error('Failed');
    document.getElementById('fbFormCard').style.display = 'none';
    document.getElementById('fbSuccess').classList.add('show');
    if (typeof lucide !== 'undefined') lucide.createIcons();
  })
  .catch(() => {
    btn.disabled = false;
    btn.innerHTML = '<i data-lucide="send" style="width:16px;height:16px"></i> Submit Feedback';
    showToast('error', 'Failed to submit. Please try again.');
    if (typeof lucide !== 'undefined') lucide.createIcons();
  });
  */
}