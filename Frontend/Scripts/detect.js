document.addEventListener("DOMContentLoaded", () => {
  if (!Session.requireAuth()) return;
});

const API_URL = '/predict';

let selectedFile  = null;
let currentResult = null;
let currentLang   = 'en';

const LANG_NAMES = {
  en: 'English', hi: 'Hindi', te: 'Telugu', ta: 'Tamil', kn: 'Kannada'
};

// LLM-POWERED TRANSLATION 
async function fetchTranslation(predictedClass, pct, stage, lang) {
  const isHealthy = predictedClass.toLowerCase().includes('healthy');

  // Build ONE dynamic sentence from actual result data
  let sourceText = '';

  if (isHealthy) {
    sourceText = `Your ${predictedClass.replace(' - Healthy', '').trim()} plant is healthy with no disease detected — keep up your current care routine.`;
  } else {
    const urgencyShort = 
      stage === 'Early'    ? 'monitor closely and apply preventive spray' :
      stage === 'Moderate' ? 'apply fungicide within 2-3 days'            :
      stage === 'Severe'   ? 'apply treatment immediately today'           :
                             'treat now and isolate the plant';

    sourceText = `Your plant has ${predictedClass} at ${stage.toLowerCase()} stage with ${pct}% leaf infection — ${urgencyShort}.`;
  }

  // English — return as-is
  if (lang === 'en') return sourceText;

  // Translate via backend
  try {
    const res = await fetch('/api/translate', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', ...Session.authHeaders() },
      body: JSON.stringify({
        predicted_class: predictedClass,
        severity_pct:    pct,
        stage,
        lang,
        source_text: sourceText  
      })
    });
    if (!res.ok) throw new Error('Translation failed');
    const data = await res.json();
    return data.translated || sourceText;
  } catch (e) {
    console.warn('Translation failed:', e);
    return sourceText;
  }
}

// IMAGE UPLOAD HANDLERS 
document.addEventListener('DOMContentLoaded', function () {
  const fileInput = document.getElementById('fileInput');
  if (fileInput) {
    fileInput.addEventListener('change', function () {
      if (this.files && this.files[0]) {
        selectedFile = this.files[0];
        showPreview(URL.createObjectURL(selectedFile));
      }
    });
  }
});

function handleFileInput(input) {
  if (input.files && input.files[0]) {
    selectedFile = input.files[0];
    showPreview(URL.createObjectURL(selectedFile));
  }
}

function handleDrop(e) {
  e.preventDefault();
  document.getElementById('dropZone').classList.remove('drag');
  const file = e.dataTransfer.files[0];
  if (file && file.type.startsWith('image/')) {
    selectedFile = file;
    showPreview(URL.createObjectURL(file));
  }
}

function showPreview(url) {
  const img  = document.getElementById('previewImg');
  const zone = document.getElementById('dropZone');
  img.src           = url;
  img.style.display = 'block';
  zone.classList.add('has-img');
  const btn = document.getElementById('scanBtn');
  btn.disabled  = false;
  btn.innerHTML = '<i data-lucide="scan-line" style="width:18px;height:18px;"></i>&nbsp; Scan This Leaf Now';
  if (typeof lucide !== 'undefined') lucide.createIcons();
}

// SCAN 
const STEPS = [
  'Checking image quality...',
  'Running disease detection...',
  'Calculating severity...',
  'Fetching treatment advice...',
  'Preparing your result...'
];

async function startScan() {
  if (!selectedFile) return;

  document.getElementById('scanBtnWrap').style.display = 'none';
  document.getElementById('analyzingBox').classList.add('show');
  document.getElementById('resultSection').classList.remove('show');

  const geminiCard = document.getElementById('geminiCard');
  if (geminiCard) geminiCard.innerHTML = '';

  let si = 0;
  const stepEl = document.getElementById('anaStep');
  const fillEl = document.getElementById('progFill');
  stepEl.textContent = STEPS[0];

  const stepTimer = setInterval(() => {
    si++;
    fillEl.style.width = ((si / STEPS.length) * 80) + '%';
    if (si < STEPS.length) stepEl.textContent = STEPS[si];
  }, 600);

  try {
    const formData = new FormData();
    formData.append('file', selectedFile);

    const response = await fetch(API_URL, {
      method:  'POST',
      headers: Session.authHeaders(),
      body:    formData,
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      throw new Error(errData.detail || `Server error ${response.status}`);
    }

    const apiData = await response.json();
    const { predicted_class, confidence, severity_pct: pct, stage, urgency } = apiData;

    // Store result without pre-built translations — we'll fetch on demand
    currentResult = { predicted_class, confidence, pct, stage, urgency, translations: {} };
    currentLang   = 'en';

    clearInterval(stepTimer);
    fillEl.style.width = '100%';
    stepEl.textContent = 'Done!';

    // Pre-fetch English translation
    currentResult.translations['en'] = await fetchTranslation(predicted_class, pct, stage, 'en');

    setTimeout(() => {
      document.getElementById('analyzingBox').classList.remove('show');
      renderResult(currentResult);
      fetchGeminiAdvice({ predicted_class, confidence, severity_pct: pct, stage, urgency });
    }, 400);

  } catch (error) {
    clearInterval(stepTimer);
    console.error('API Error:', error);

    document.getElementById('analyzingBox').classList.remove('show');
    document.getElementById('scanBtnWrap').style.display = 'block';
    fillEl.style.width = '0%';

    const btn = document.getElementById('scanBtn');
    btn.textContent      = 'Error: ' + (error.message || 'Cannot connect to server.');
    btn.style.background = '#c62828';
    btn.disabled         = true;

    setTimeout(() => {
      btn.innerHTML        = '<i data-lucide="scan-line" style="width:18px;height:18px;"></i>&nbsp; Scan This Leaf Now';
      btn.style.background = '';
      btn.disabled         = false;
      if (typeof lucide !== 'undefined') lucide.createIcons();
    }, 4000);
  }
}

// RENDER RESULT 
function renderResult(data) {
  const isHealthy = data.predicted_class.toLowerCase().includes('healthy');

  const cropIconMap = {
    tomato: 'cherry', potato: 'box', corn: 'wheat', apple: 'apple', pepper: 'flame'
  };
  const cropKey  = Object.keys(cropIconMap).find(k => data.predicted_class.toLowerCase().includes(k));
  const iconName = cropIconMap[cropKey] || 'leaf';

  document.getElementById('rbIcon').setAttribute('data-lucide', iconName);
  document.getElementById('rbDisease').textContent = data.predicted_class;
  document.getElementById('rbDetail').textContent  = 'Detected just now';
  document.getElementById('rbConf').textContent    = data.confidence + '%';
  document.getElementById('unknownBar').classList.toggle('show', data.confidence < 60);

  renderSeverity(data.pct, data.stage, isHealthy);

  // Language card
  const transBox = document.getElementById('transBox');
  transBox.textContent = data.translations['en'] || '';
  document.querySelectorAll('.lang-btn').forEach(b => b.classList.remove('active'));
  document.querySelector('.lang-btn').classList.add('active');

  if (typeof lucide !== 'undefined') lucide.createIcons();

  const section = document.getElementById('resultSection');
  section.classList.add('show');

  const banner    = document.querySelector('.result-banner');
  const glowClass = isHealthy               ? 'glow-healthy'
                  : data.stage === 'Early'    ? 'glow-early'
                  : data.stage === 'Moderate' ? 'glow-moderate'
                  : 'glow-critical';

  banner.classList.remove('glow-healthy', 'glow-early', 'glow-moderate', 'glow-critical');
  void banner.offsetWidth;
  banner.classList.add(glowClass);

  setTimeout(() => section.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);
}

function renderSeverity(pct, stage, isHealthy) {
  document.getElementById('sevNum').textContent = pct + '%';
  setTimeout(() => { document.getElementById('sevFill').style.width = pct + '%'; }, 300);

  const stageMap   = { Early:0, Moderate:1, Severe:2, Critical:3 };
  const stageIcons = ['seedling', 'alert-triangle', 'alert-circle', 'siren'];
  const stageNames = ['early', 'moderate', 'severe', 'critical'];
  const si         = stageMap[stage] ?? 0;

  const badge = document.getElementById('sevBadge');
  if (isHealthy) {
    badge.innerHTML = '<i data-lucide="circle-check" style="width:13px;height:13px;margin-right:5px;vertical-align:middle;"></i> Healthy Plant';
    badge.className = 'sev-badge sev-early';
  } else {
    badge.innerHTML = `<i data-lucide="${stageIcons[si]}" style="width:13px;height:13px;margin-right:5px;vertical-align:middle;"></i>${stage} Stage`;
    badge.className = 'sev-badge';
    if (stage === 'Early')    badge.classList.add('sev-early');
    if (stage === 'Severe')   badge.classList.add('sev-severe');
    if (stage === 'Critical') badge.classList.add('sev-critical');
  }

  [0, 1, 2, 3].forEach(i => {
    const el = document.getElementById('s' + i);
    el.className = 'sev-stage' + (i === si ? ' active ' + stageNames[i] : '');
  });
}

//  GEMINI / AI ADVICE 
async function fetchGeminiAdvice({ predicted_class, confidence, severity_pct, stage, urgency }) {
  const card = document.getElementById('geminiCard');
  if (!card) return;

  card.innerHTML = `
    <div class="gemini-card">
      <div class="gemini-header">
        <div class="gemini-logo"></div>
        <span class="gemini-header-text">AI Analysis</span>
      </div>
      <div class="gemini-loading">
        <div class="gemini-spinner"></div>
        Getting AI-powered advice for your crop...
      </div>
    </div>`;

  try {
    const res = await fetch('/gemini-advice', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', ...Session.authHeaders() },
      body: JSON.stringify({ predicted_class, confidence, severity_pct, stage, urgency }),
    });

    if (!res.ok) throw new Error(`Gemini endpoint error ${res.status}`);
    const data = await res.json();

    if (data.success && data.advice) {
      renderGeminiAdvice(card, data.advice);
    } else {
      card.innerHTML = `
        <div class="gemini-card">
          <div class="gemini-header">
            <div class="gemini-logo"></div>
            <span class="gemini-header-text">AI Analysis</span>
          </div>
          <div class="gemini-body">
            <div class="gemini-summary">${data.advice?.summary || 'AI advice unavailable.'}</div>
          </div>
        </div>`;
    }
  } catch (err) {
    console.warn('AI advice fetch failed:', err);
    card.innerHTML = `
      <div class="gemini-card">
        <div class="gemini-header">
          <div class="gemini-logo"></div>
          <span class="gemini-header-text">AI Analysis</span>
        </div>
        <div class="gemini-error">⚠ AI advice unavailable right now. Your ML diagnosis above is still accurate.</div>
      </div>`;
  }
}

function renderGeminiAdvice(card, advice) {
  const actions = (advice.immediate_actions || [])
    .map((a, i) => `
      <div class="gemini-action-item">
        <span class="gemini-action-num">${i + 1}</span>
        <span>${a}</span>
      </div>`).join('');

  const tips = (advice.prevention_tips || [])
    .map(t => `
      <div class="gemini-tip-item">
        <div class="gemini-tip-dot"></div>
        <span>${t}</span>
      </div>`).join('');

  card.innerHTML = `
    <div class="gemini-card">
      <div class="gemini-header">
        <div class="gemini-logo"></div>
        <span class="gemini-header-text">Plant Health Analysis</span>
        <span class="gemini-header-sub"></span>
      </div>
      <div class="gemini-body">
        <div class="gemini-summary">${advice.summary || ''}</div>
        ${advice.what_is_this ? `
        <div>
          <div class="gemini-section-title">What is this?</div>
          <div class="gemini-what">${advice.what_is_this}</div>
        </div>` : ''}
        ${actions ? `
        <div>
          <div class="gemini-section-title">Immediate Actions</div>
          <div class="gemini-actions-grid">${actions}</div>
        </div>` : ''}
        ${tips ? `
        <div>
          <div class="gemini-section-title">Prevention for Next Season</div>
          <div class="gemini-tips-list">${tips}</div>
        </div>` : ''}
        ${advice.farmer_tip ? `
        <div class="gemini-farmer-tip">
          <span class="gemini-farmer-emoji">🌾</span>
          <span>${advice.farmer_tip}</span>
        </div>` : ''}
      </div>
    </div>`;
}

// LANGUAGE SWITCH 
async function setLang(el, lang) {
  currentLang = lang;
  document.querySelectorAll('.lang-btn').forEach(b => b.classList.remove('active'));
  el.classList.add('active');

  if (!currentResult) return;

  const transBox = document.getElementById('transBox');

  // If we already have this translation cached, show it immediately
  if (currentResult.translations[lang]) {
    transBox.textContent = currentResult.translations[lang];
    return;
  }

  // Show loading state
  transBox.innerHTML = `<span style="color:var(--text-soft);font-style:italic;">Translating to ${LANG_NAMES[lang]}…</span>`;

  const translated = await fetchTranslation(
    currentResult.predicted_class,
    currentResult.pct,
    currentResult.stage,
    lang
  );

  // Cache it
  currentResult.translations[lang] = translated || currentResult.translations['en'];
  transBox.textContent = currentResult.translations[lang];
}

// VOICE OUTPUT 
function speakResult() {
  if (!currentResult) return;
  const text = currentResult.translations[currentLang] || currentResult.translations['en'];
  if ('speechSynthesis' in window) {
    window.speechSynthesis.cancel();
    const utt  = new SpeechSynthesisUtterance(text);
    utt.lang   = currentLang + '-IN';
    utt.rate   = 0.88;
    utt.pitch  = 1;
    const voices = window.speechSynthesis.getVoices();
    const match  = voices.find(v => v.lang.startsWith(currentLang));
    if (match) utt.voice = match;
    const btn = document.getElementById('playBtn');
    btn.innerHTML = '<i data-lucide="square" style="width:15px;height:15px;"></i> Stop';
    utt.onend = () => {
      btn.innerHTML = '<i data-lucide="volume-2" style="width:16px;height:16px;"></i> Listen Now';
      btn.onclick = speakResult;
      if (typeof lucide !== 'undefined') lucide.createIcons();
    };
    btn.onclick = () => {
      if (window.speechSynthesis.speaking) {
        window.speechSynthesis.cancel();
        btn.innerHTML = '<i data-lucide="volume-2" style="width:16px;height:16px;"></i> Listen Now';
        btn.onclick = speakResult;
        if (typeof lucide !== 'undefined') lucide.createIcons();
      }
    };
    window.speechSynthesis.speak(utt);
  } else {
    alert('Voice not supported. Please use Chrome or Edge.');
  }
}
window.speechSynthesis && window.speechSynthesis.getVoices();

// RESET
function resetScan() {
  selectedFile  = null;
  currentResult = null;
  currentLang   = 'en';

  const img  = document.getElementById('previewImg');
  const zone = document.getElementById('dropZone');
  img.style.display = 'none';
  img.src           = '';
  zone.classList.remove('has-img');
  document.getElementById('fileInput').value = '';

  document.getElementById('scanBtnWrap').style.display = 'block';
  const btn = document.getElementById('scanBtn');
  btn.disabled         = true;
  btn.innerHTML        = '<i data-lucide="upload-cloud" style="width:18px;height:18px;"></i>&nbsp; Upload a photo to scan';
  btn.style.background = '';
  if (typeof lucide !== 'undefined') lucide.createIcons();

  document.getElementById('progFill').style.width     = '0%';
  document.getElementById('analyzingBox').classList.remove('show');
  document.getElementById('sevFill').style.width      = '0%';
  document.getElementById('resultSection').classList.remove('show');
  document.getElementById('unknownBar').classList.remove('show');

  const geminiCard = document.getElementById('geminiCard');
  if (geminiCard) geminiCard.innerHTML = '';

  const playBtn = document.getElementById('playBtn');
  playBtn.innerHTML = '<i data-lucide="volume-2" style="width:16px;height:16px;"></i> Listen Now';
  playBtn.onclick   = speakResult;
  if (typeof lucide !== 'undefined') lucide.createIcons();

  if ('speechSynthesis' in window) window.speechSynthesis.cancel();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}