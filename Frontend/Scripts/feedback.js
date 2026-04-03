//  State 
let selectedRating   = 0;
let selectedCategory = '';

const ratingLabels = {
  1: 'Terrible — we\'ll do better!',
  2: 'Not great — sorry about that',
  3: 'It was okay',
  4: 'Good experience!',
  5: 'Excellent — thank you!'
};

const categoryLabels = {
  accuracy:  'Disease Accuracy',
  speed:     'Speed',
  language:  'Language Support',
  ui:        'App Design',
  treatment: 'Treatment Advice',
  other:     'Other'
};

//  Star Rating 
function highlightStars(count) {
  document.querySelectorAll('.fb-star-btn').forEach(b => {
    const val = parseInt(b.dataset.val);
    b.classList.toggle('filled', val <= count);
    b.classList.toggle('selected', val <= selectedRating);
  });
}

document.querySelectorAll('.fb-star-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    selectedRating = parseInt(btn.dataset.val);
    highlightStars(selectedRating);
    document.getElementById('ratingLabel').textContent = ratingLabels[selectedRating];
    checkStep1();
  });

  btn.addEventListener('mouseenter', () => {
    highlightStars(parseInt(btn.dataset.val));
  });

  btn.addEventListener('mouseleave', () => {
    highlightStars(selectedRating);
  });
});

//  Category buttons 
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

// Step navigation 
function goStep(step) {
  document.querySelectorAll('.fb-step-panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.fb-step').forEach(s => s.classList.remove('active', 'done'));
  document.querySelectorAll('.fb-step-line').forEach(l => l.classList.remove('done'));

  for (let i = 1; i < step; i++) {
    document.getElementById(`step${i}dot`).classList.add('done');
    const line = document.getElementById(`line${i}`);
    if (line) line.classList.add('done');
  }

  document.getElementById(`step${step}dot`).classList.add('active');
  document.getElementById(`panel${step}`).classList.add('active');

  if (step === 3) populateReview();
  if (typeof lucide !== 'undefined') lucide.createIcons();
}

// Populate review 
function populateReview() {
  const stars = '★'.repeat(selectedRating) + '☆'.repeat(5 - selectedRating);
  const msg = document.getElementById('fbMessage').value.trim();
  document.getElementById('rv-rating').textContent = `${stars} ${ratingLabels[selectedRating] || ''}`;
  document.getElementById('rv-cat').textContent = categoryLabels[selectedCategory] || '—';
  document.getElementById('rv-msg').textContent = msg || '(No message provided)';
}

//  Submit 
async function submitFeedback() {
  const btn = document.getElementById('submitBtn');
  btn.disabled = true;
  btn.innerHTML = '<i data-lucide="loader-2" style="width:16px;height:16px;animation:spin 0.8s linear infinite"></i> Submitting...';
  if (typeof lucide !== 'undefined') lucide.createIcons();

  const payload = {
    rating:    selectedRating,
    category:  selectedCategory,
    message:   document.getElementById('fbMessage').value.trim(),
  };

  try {
    const res = await fetch('/feedback', {
      method:  'POST',
      headers: {
        'Content-Type': 'application/json',
        ...Session.authHeaders()
      },
      body: JSON.stringify(payload)
    });

    if (!res.ok) throw new Error('Failed');

    document.getElementById('fbFormCard').style.display = 'none';
    const successEl = document.getElementById('fbSuccess');
    successEl.style.display = 'flex';
    successEl.classList.add('show');
    document.getElementById('fbSuccess').classList.add('show');
    if (typeof lucide !== 'undefined') lucide.createIcons();

  } catch {
    btn.disabled = false;
    btn.innerHTML = '<i data-lucide="send" style="width:16px;height:16px"></i> Submit Feedback';
    if (typeof lucide !== 'undefined') lucide.createIcons();
    showToast('error', 'Failed to submit. Please try again.');
  }
}