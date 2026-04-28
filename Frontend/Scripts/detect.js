document.addEventListener("DOMContentLoaded", () => {
  if (!Session.requireAuth()) return;
});

const API_URL = '/predict';

let selectedFile  = null;
let currentResult = null;
let currentLang   = 'en';
let userLatitude  = null;
let userLongitude = null;

// GET USER LOCATION ON PAGE LOAD 
function initLocation() {
  const statusEl = document.getElementById('locationStatus');
  const textEl   = document.getElementById('locationText');
  if (!navigator.geolocation) {
    if (statusEl) { statusEl.className = 'location-status err'; textEl.innerHTML = '<i data-lucide="map-pin" style="width:14px;height:14px;color:#888;vertical-align:middle;flex-shrink:0;"></i> Location not supported in this browser'; }
    return;
  }
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      userLatitude  = pos.coords.latitude;
      userLongitude = pos.coords.longitude;
      if (statusEl) {
        statusEl.className   = 'location-status ok';
        textEl.innerHTML   = `<i data-lucide="map-pin" style="width:14px;height:14px;color:#2e7d32;vertical-align:middle;flex-shrink:0;"></i> Location captured — weather &amp; soil analysis enabled`;
      }
    },
    () => {
      if (statusEl) { statusEl.className = 'location-status err'; textEl.innerHTML = '<i data-lucide="alert-triangle" style="width:14px;height:14px;color:#e65100;vertical-align:middle;flex-shrink:0;"></i> Location denied — weather advice will be skipped'; }
    },
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
  );
}
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
  initLocation();

  // Set max date on sowing input to today
  const sowingInput = document.getElementById('sowingDateInput');
  if (sowingInput) sowingInput.max = new Date().toISOString().split('T')[0];

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
  'Fetching weather & soil context...',
  'Preparing your result...'
];

async function startScan() {
  if (!selectedFile) return;

  document.getElementById('scanBtnWrap').style.display = 'none';
  document.getElementById('analyzingBox').classList.add('show');
  document.getElementById('resultSection').classList.remove('show');

  const analysisCard = document.getElementById('analysisCard');
  if (analysisCard) { analysisCard.innerHTML = ''; analysisCard.classList.remove('full-width'); }

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
      fetchUnifiedAnalysis({ predicted_class, confidence, severity_pct: pct, stage, urgency });
      fetchGroqSpray(currentResult);
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

// SAFE STRING HELPER — prevents [object Object] if LLM returns wrong type
function safeStr(val) {
  if (!val) return '';
  if (typeof val === 'string') return val;
  if (Array.isArray(val)) return val.join(' ');
  if (typeof val === 'object') {
    return val.text || val.description || val.content || val.impact
           || val.note || val.detail || JSON.stringify(val);
  }
  return String(val);
}

// ============================================================
//  UNIFIED ANALYSIS — plant health + weather + soil combined
// ============================================================
async function fetchUnifiedAnalysis({ predicted_class, confidence, severity_pct, stage, urgency }) {
  const card = document.getElementById('analysisCard');
  if (!card) return;

  const hasLocation = !!(userLatitude && userLongitude);

  card.innerHTML = `
    <div class="analysis-card">
      <div class="analysis-header">
        <div class="analysis-dot"></div>
        <span class="analysis-header-text">Overall Analysis</span>
        <span class="analysis-badge">${hasLocation ? '<span style="display:inline-flex;align-items:center;gap:4px;"><i data-lucide="cloud-sun" style="width:12px;height:12px;color:#2e7d32;vertical-align:middle;flex-shrink:0;"></i> Weather + Soil + AI</span>' : '<span style="display:inline-flex;align-items:center;gap:4px;"><i data-lucide="brain-circuit" style="width:12px;height:12px;color:#1565c0;vertical-align:middle;flex-shrink:0;"></i> AI Analysis</span>'}</span>
      </div>
      <div class="analysis-loading">
        <div class="analysis-spinner"></div>
        ${hasLocation ? 'Combining plant health, live weather & soil data...' : 'Getting AI-powered advice...'}
      </div>
    </div>`;

  try {
    let advice, context;

    if (hasLocation) {
      // Full analysis: weather + soil + AI all in one call
      const res = await fetch('/weather-advice', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', ...Session.authHeaders() },
        body: JSON.stringify({
          predicted_class, confidence, severity_pct, stage, urgency,
          latitude:          userLatitude,
          longitude:         userLongitude,
          soil_type:         'Unknown',
          irrigation_method: 'Unknown',
          sowing_date:       '',
        }),
      });
      if (!res.ok) throw new Error(`Status ${res.status}`);
      const data = await res.json();
      if (!data.advice) throw new Error('No advice returned');
      advice  = data.advice;
      context = data.context || null;
      if (currentResult) currentResult.weatherData = { advice, context };
      fetchGroqSpray(currentResult);
    } else {
      // Fallback: basic AI-only call (no location)
      const res = await fetch('/groq-advice', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', ...Session.authHeaders() },
        body: JSON.stringify({ predicted_class, confidence, severity_pct, stage, urgency }),
      });
      if (!res.ok) throw new Error(`Status ${res.status}`);
      const data = await res.json();
      if (!data.advice) throw new Error('No advice returned');
      advice  = data.advice;
      context = null;
      if (currentResult) currentResult.weatherData = { advice, context: null };
    }

    renderUnifiedAnalysis(card, advice, context);
    if (typeof lucide !== 'undefined') lucide.createIcons();

  } catch (err) {
    console.error('Unified analysis failed:', err?.message || err);
    card.innerHTML = `
      <div class="analysis-card">
        <div class="analysis-header">
          <div class="analysis-dot"></div>
          <span class="analysis-header-text">Overall Analysis</span>
        </div>
        <div class="analysis-error"><i data-lucide="alert-triangle" style="width:14px;height:14px;color:#c62828;vertical-align:middle;flex-shrink:0;"></i> Analysis unavailable right now. Your ML diagnosis above is still accurate.</div>
      </div>`;
  }
}

function renderUnifiedAnalysis(card, advice, ctx) {
  const isHealthy = !ctx
    ? (advice.risk_level === 'None')
    : currentResult?.predicted_class?.toLowerCase().includes('healthy');

  // Context data (only if location was available)
  const w        = ctx?.weather   || {};
  const l        = ctx?.location  || {};
  const soil     = ctx?.soil      || {};
  const sowing   = ctx?.sowing    || {};

  const locStr  = l.city && l.state ? `${l.city}, ${l.state}` : '';
  const tempStr = w.temperature_c !== 'N/A' ? `${w.temperature_c}°C` : '';
  const humStr  = w.humidity_pct  !== 'N/A' ? `${w.humidity_pct}%`  : '';
  const rainStr = w.rain_forecast || '';
  const phStr   = soil.ph && soil.ph !== 'N/A' ? `pH ${soil.ph}` : '';
  const daysStr = sowing.days_since_sowing && sowing.days_since_sowing !== 'Unknown'
                  ? `Day ${sowing.days_since_sowing}` : '';

  // AI-generated fields
  const summary      = safeStr(advice.summary);
  const whatIsThis   = safeStr(advice.what_is_this);
  const cropStage    = safeStr(advice.crop_stage);
  const seasonAssess = safeStr(advice.season_assessment);
  const weatherImp   = safeStr(advice.weather_impact);
  const soilImp      = safeStr(advice.soil_impact || advice.soil_insight);
  const farmerTip    = safeStr(advice.farmer_tip);
  const riskLevel    = safeStr(advice.risk_level);

  const actions = (advice.immediate_actions || [])
    .map((a, i) => `
      <div class="analysis-action-item">
        <span class="analysis-action-num">${i + 1}</span>
        <span>${safeStr(a)}</span>
      </div>`).join('');

  const tips = (advice.prevention_tips || [])
    .map(t => `
      <div class="analysis-tip-item">
        <div class="analysis-tip-dot"></div>
        <span>${safeStr(t)}</span>
      </div>`).join('');

  // Context pills row (only shown when location available)
  const pillsHtml = ctx ? `
    <div class="analysis-pills">
      ${tempStr && humStr ? `<div class="apill green"><i data-lucide="thermometer" style="width:12px;height:12px;color:#2e7d32;vertical-align:middle;flex-shrink:0;"></i> ${tempStr} · ${humStr} Humidity</div>` : ''}
      ${rainStr           ? `<div class="apill blue"><i data-lucide="cloud-rain" style="width:12px;height:12px;color:#1565c0;vertical-align:middle;flex-shrink:0;"></i> ${rainStr}</div>` : ''}
      ${phStr             ? `<div class="apill orange"><i data-lucide="flask-conical" style="width:12px;height:12px;color:#e65100;vertical-align:middle;flex-shrink:0;"></i> ${phStr}</div>` : ''}
      ${daysStr           ? `<div class="apill teal"><i data-lucide="sprout" style="width:12px;height:12px;color:#00695c;vertical-align:middle;flex-shrink:0;"></i> ${daysStr} in field</div>` : ''}
    </div>` : '';

  card.innerHTML = `
    <div class="analysis-card">
      <div class="analysis-header">
        <div class="analysis-dot"></div>
        <span class="analysis-header-text">Overall Analysis</span>
        ${locStr ? `<span class="analysis-loc"><i data-lucide="map-pin" style="width:12px;height:12px;color:#888;vertical-align:middle;flex-shrink:0;"></i> ${locStr}</span>` : ''}
        ${riskLevel && riskLevel !== 'None' ? `<span class="analysis-risk risk-${riskLevel.toLowerCase()}">${riskLevel} Risk</span>` : ''}
      </div>

      <div class="analysis-body">

        ${pillsHtml}

        ${summary ? `<div class="analysis-summary">${summary}</div>` : ''}

        ${whatIsThis ? `
        <div>
          <div class="analysis-section-title">What is this?</div>
          <div class="analysis-what">${whatIsThis}</div>
        </div>` : ''}

        ${cropStage ? `
        <div>
          <div class="analysis-section-title"><i data-lucide="sprout" style="width:12px;height:12px;color:#2e7d32;vertical-align:middle;flex-shrink:0;"></i> Crop Stage</div>
          <div class="analysis-box green-box">${cropStage}</div>
        </div>` : ''}

        ${seasonAssess ? `
        <div>
          <div class="analysis-section-title"><i data-lucide="calendar" style="width:12px;height:12px;color:#f57c00;vertical-align:middle;flex-shrink:0;"></i> Season Assessment</div>
          <div class="analysis-box amber-box">${seasonAssess}</div>
        </div>` : ''}

        ${weatherImp ? `
        <div>
          <div class="analysis-section-title"><i data-lucide="cloud-sun" style="width:12px;height:12px;color:#1565c0;vertical-align:middle;flex-shrink:0;"></i> Weather Impact on Disease</div>
          <div class="analysis-box blue-box">${weatherImp}</div>
        </div>` : ''}

        ${soilImp ? `
        <div>
          <div class="analysis-section-title"><i data-lucide="layers" style="width:12px;height:12px;color:#bf360c;vertical-align:middle;flex-shrink:0;"></i> Soil Impact</div>
          <div class="analysis-box red-box">${soilImp}</div>
        </div>` : ''}

        ${actions ? `
        <div>
          <div class="analysis-section-title">Immediate Actions</div>
          <div class="analysis-actions">${actions}</div>
        </div>` : ''}

        ${tips ? `
        <div>
          <div class="analysis-section-title">Prevention for Next Season</div>
          <div class="analysis-tips">${tips}</div>
        </div>` : ''}

        ${farmerTip ? `
        <div class="analysis-farmer-tip">
          <span class="analysis-farmer-icon"><i data-lucide="wheat" style="width:16px;height:16px;color:#e65100;vertical-align:middle;flex-shrink:0;"></i></span>
          <span>${farmerTip}</span>
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

  const analysisCard = document.getElementById('analysisCard');
  if (analysisCard) { analysisCard.innerHTML = ''; analysisCard.classList.remove('full-width'); }

  const playBtn = document.getElementById('playBtn');
  playBtn.innerHTML = '<i data-lucide="volume-2" style="width:16px;height:16px;"></i> Listen Now';
  playBtn.onclick   = speakResult;
  if (typeof lucide !== 'undefined') lucide.createIcons();

  if ('speechSynthesis' in window) window.speechSynthesis.cancel();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// REPORT

function buildReportHTML(data, imgSrc) {
  const now = new Date();
  const dateStr = now.toLocaleDateString('en-IN', { day:'numeric', month:'short', year:'numeric' });
  const timeStr = now.toLocaleTimeString('en-IN', { hour:'2-digit', minute:'2-digit' });
  const isHealthy = data.predicted_class.toLowerCase().includes('healthy');

  // Pull AI advice from stored result data (not DOM scraping)
  const wd = data.weatherData;
  const adv = wd?.advice || {};

  const summaryText  = safeStr(adv.summary);
  const whatText     = safeStr(adv.what_is_this);
  const actionsList  = adv.immediate_actions || [];
  const tipsList     = adv.prevention_tips   || [];
  const farmerTipTxt = safeStr(adv.farmer_tip);

  const summaryHTML = summaryText ? `
    <div class="rpt-ai-box">
      <div class="rpt-ai-box-title">AI Summary</div>
      ${summaryText}
    </div>` : '';

  const whatHTML = whatText ? `
    <div class="rpt-ai-box" style="margin-top:10px;">
      <div class="rpt-ai-box-title">What is this?</div>
      ${whatText}
    </div>` : '';

  const actionsHTML = actionsList.length ? `
    <div class="rpt-section-title" style="margin-top:14px;">Immediate Actions</div>
    <div class="rpt-action-list">
      ${actionsList.map((a, i) => `
        <div class="rpt-action-item">
          <span class="rpt-action-num">${i + 1}</span>
          <span>${safeStr(a)}</span>
        </div>`).join('')}
    </div>` : '';

  const tipsHTML = tipsList.length ? `
    <div class="rpt-section-title" style="margin-top:14px;">Prevention Tips</div>
    ${tipsList.map(t => `
      <div class="rpt-tip-item">
        <div class="rpt-tip-dot"></div>
        <span>${safeStr(t)}</span>
      </div>`).join('')}` : '';

  const farmerHTML = farmerTipTxt ? `
    <div class="rpt-farmer-tip" style="margin-top:10px;">
      <span style="flex-shrink:0;"><i data-lucide="wheat" style="width:16px;height:16px;color:#e65100;vertical-align:middle;flex-shrink:0;"></i></span>
      <span>${farmerTipTxt}</span>
    </div>` : '';

  // Translation line
  const transText = data.translations?.['en'] || '';

  const stageColor = isHealthy ? '#2e7d32'
    : data.stage === 'Critical' || data.stage === 'Severe' ? '#c62828'
    : data.stage === 'Moderate' ? '#f57c00' : '#2e7d32';

  return `
    <div class="rpt-header">
      <div class="rpt-logo">
        <div class="rpt-logo-icon">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5">
            <path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10z"/>
            <path d="M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12"/>
          </svg>
        </div>
        <span class="rpt-logo-text">LeafSense</span>
      </div>
      <span class="rpt-date">Scan report · ${dateStr} · ${timeStr}</span>
    </div>

    <div class="rpt-top">
      ${imgSrc ? `<img class="rpt-thumb" src="${imgSrc}" alt="Leaf" crossorigin="anonymous"/>` : ''}
      <div style="flex:1;min-width:160px;">
        <div class="rpt-disease-name">${data.predicted_class}</div>
        <div class="rpt-disease-sub">Detected just now</div>
        <span class="rpt-conf-pill">✓ ${data.confidence}% confidence</span>
      </div>
    </div>

    <div class="rpt-divider"></div>

    <div class="rpt-section-title">Severity</div>
    <div class="rpt-sev-row">
      <div class="rpt-sev-pill">
        <div class="rpt-sev-label">Leaf infected</div>
        <div class="rpt-sev-val" style="color:${stageColor};">${data.pct}%</div>
        <div class="rpt-sev-bar-bg">
          <div class="rpt-sev-bar-fill" style="width:${data.pct}%"></div>
        </div>
      </div>
      <div class="rpt-sev-pill">
        <div class="rpt-sev-label">Stage</div>
        <div class="rpt-sev-val" style="color:${stageColor};">${isHealthy ? 'Healthy' : data.stage}</div>
        <div class="rpt-sev-sub">${isHealthy ? 'No disease found' : data.urgency || ''}</div>
      </div>
    </div>

    <div class="rpt-divider"></div>

    ${transText ? `
    <div class="rpt-section-title">Summary (English)</div>
    <div class="rpt-ai-box" style="margin-bottom:10px;">${transText}</div>` : ''}

    ${summaryHTML}${whatHTML}${actionsHTML}${tipsHTML}${farmerHTML}

    ${(function() {
      const wd = data.weatherData;
      if (!wd || !wd.context) return '';

      const w        = wd.context?.weather    || {};
      const l        = wd.context?.location   || {};
      const soil     = wd.context?.soil       || {};
      const sowing   = wd.context?.sowing     || {};
      const soilType = wd.context?.soil_type  || '';
      const irr      = wd.context?.irrigation || '';
      const adv      = wd.advice || {};

      // Live data strings
      const locStr  = l.city && l.state ? `${l.city}, ${l.state}` : '';
      const tempStr = w.temperature_c !== 'N/A' ? `${w.temperature_c}°C` : '';
      const humStr  = w.humidity_pct  !== 'N/A' ? `${w.humidity_pct}% humidity` : '';
      const rainStr = w.rain_forecast || '';
      const phStr   = soil.ph && soil.ph !== 'N/A' ? `Soil pH ${soil.ph}` : '';
      const daysStr = sowing.days_since_sowing && sowing.days_since_sowing !== 'Unknown'
                      ? `Day ${sowing.days_since_sowing} in field` : '';

      // Llama-generated dynamic fields — always run through safeStr
      const cropStage    = safeStr(adv.crop_stage);
      const seasonAssess = safeStr(adv.season_assessment);
      const weatherImp   = safeStr(adv.weather_impact);
      const soilImp      = safeStr(adv.soil_impact);
      const farmerTip    = safeStr(adv.farmer_tip);

      const pillStyle = `display:inline-block;border-radius:20px;padding:3px 10px;font-size:11px;font-weight:700;margin:3px 4px 3px 0;`;
      const greenPill  = `${pillStyle}background:#f1f8e9;border:1.5px solid #c5e1a5;color:#2e7d32;`;
      const bluePill   = `${pillStyle}background:#e3f2fd;border:1.5px solid #90caf9;color:#1565c0;`;
      const orangePill = `${pillStyle}background:#fff8e1;border:1.5px solid #ffe082;color:#e65100;`;
      const tealPill   = `${pillStyle}background:#e0f2f1;border:1.5px solid #80cbc4;color:#00695c;`;

      const pills = [
        tempStr && humStr ? `<span style="${greenPill}"><i data-lucide="thermometer" style="width:11px;height:11px;color:#2e7d32;vertical-align:middle;flex-shrink:0;"></i> ${tempStr} · ${humStr}</span>`   : '',
        rainStr           ? `<span style="${bluePill}"><i data-lucide="cloud-rain" style="width:11px;height:11px;color:#1565c0;vertical-align:middle;flex-shrink:0;"></i> ${rainStr}</span>`                 : '',
        soilType && soilType !== 'Unknown' ? `<span style="${orangePill}"><i data-lucide="layers" style="width:11px;height:11px;color:#e65100;vertical-align:middle;flex-shrink:0;"></i> ${soilType}</span>` : '',
        phStr             ? `<span style="${orangePill}"><i data-lucide="flask-conical" style="width:11px;height:11px;color:#e65100;vertical-align:middle;flex-shrink:0;"></i> ${phStr}</span>`                  : '',
        irr && irr !== 'Unknown' ? `<span style="${bluePill}"><i data-lucide="droplets" style="width:11px;height:11px;color:#1565c0;vertical-align:middle;flex-shrink:0;"></i> ${irr}</span>`               : '',
        daysStr           ? `<span style="${tealPill}"><i data-lucide="sprout" style="width:11px;height:11px;color:#00695c;vertical-align:middle;flex-shrink:0;"></i> ${daysStr}</span>`                  : '',
      ].filter(Boolean).join('');

      const sectionTitle = `font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:0.06em;color:#aaa;margin-bottom:4px;margin-top:10px;`;
      const greenBox  = `background:#e8f5e9;border-left:4px solid #2e7d32;border-radius:0 8px 8px 0;padding:9px 12px;font-size:12px;font-weight:600;color:#1b5e20;line-height:1.55;margin-bottom:8px;`;
      const blueBox   = `background:#e3f2fd;border-left:4px solid #1976d2;border-radius:0 8px 8px 0;padding:9px 12px;font-size:12px;font-weight:600;color:#1a237e;line-height:1.55;margin-bottom:8px;`;
      const orangeBox = `background:#fbe9e7;border-left:4px solid #e64a19;border-radius:0 8px 8px 0;padding:9px 12px;font-size:12px;font-weight:600;color:#bf360c;line-height:1.55;margin-bottom:8px;`;
      const yellowBox = `background:#fff8e1;border-left:4px solid #f9a825;border-radius:0 8px 8px 0;padding:9px 12px;font-size:12px;font-weight:600;color:#e65100;line-height:1.55;margin-bottom:8px;`;

      return `
        <div class="rpt-divider"></div>
        <div class="rpt-section-title"><i data-lucide="cloud-sun" style="width:11px;height:11px;color:#1565c0;vertical-align:middle;flex-shrink:0;"></i> Weather &amp; Context at Scan Time</div>
        ${locStr    ? `<div style="font-size:12px;color:#888;font-weight:600;margin-bottom:8px;display:flex;align-items:center;gap:4px;"><i data-lucide="map-pin" style="width:12px;height:12px;color:#888;vertical-align:middle;flex-shrink:0;"></i> ${locStr}</div>` : ''}
        ${sowing.sowing_date && sowing.sowing_date !== 'Not provided'
                    ? `<div style="font-size:12px;color:#888;font-weight:600;margin-bottom:8px;display:flex;align-items:center;gap:4px;"><i data-lucide="sprout" style="width:12px;height:12px;color:#2e7d32;vertical-align:middle;flex-shrink:0;"></i> Sown on ${sowing.sowing_date}</div>` : ''}
        <div style="margin-bottom:10px;">${pills}</div>

        ${cropStage    ? `<div style="${sectionTitle}"><i data-lucide="sprout" style="width:11px;height:11px;color:#2e7d32;vertical-align:middle;flex-shrink:0;"></i> Crop Stage (AI-Assessed)</div>
                          <div style="${greenBox}">${cropStage}</div>` : ''}
        ${seasonAssess ? `<div style="${sectionTitle}"><i data-lucide="calendar" style="width:11px;height:11px;color:#f57c00;vertical-align:middle;flex-shrink:0;"></i> Season Assessment (AI-Assessed)</div>
                          <div style="${yellowBox}">${seasonAssess}</div>` : ''}
        ${weatherImp   ? `<div style="${sectionTitle}"><i data-lucide="cloud-sun" style="width:11px;height:11px;color:#1565c0;vertical-align:middle;flex-shrink:0;"></i> Weather Impact</div>
                           <div style="${blueBox}">${weatherImp}</div>` : ''}
        ${soilImp      ? `<div style="${sectionTitle}"><i data-lucide="layers" style="width:11px;height:11px;color:#bf360c;vertical-align:middle;flex-shrink:0;"></i> Soil Impact</div>
                           <div style="${orangeBox}">${soilImp}</div>` : ''}
        ${farmerTip    ? `
          <div style="display:flex;gap:8px;align-items:flex-start;padding:9px 12px;${yellowBox}">
            <span style="flex-shrink:0;"><i data-lucide="wheat" style="width:15px;height:15px;color:#e65100;vertical-align:middle;flex-shrink:0;"></i></span>
            <span>${farmerTip}</span>
          </div>` : ''}
      `;
    })()}

    <div class="rpt-footer">
      <span class="rpt-footer-note">Generated by LeafSense AI · For guidance only · Not a substitute for expert advice</span>
    </div>`;
}

function showReportModal() {
  if (!currentResult) return;

  const imgSrc = document.getElementById('previewImg')?.src || '';
  document.getElementById('reportPrintArea').innerHTML = buildReportHTML(currentResult, imgSrc);

  if (typeof lucide !== 'undefined') lucide.createIcons();
  document.getElementById('reportOverlay').classList.add('show');
  document.body.style.overflow = 'hidden';
}

function closeReportModal() {
  document.getElementById('reportOverlay').classList.remove('show');
  document.body.style.overflow = '';
}

async function downloadReportPDF() {
  const { jsPDF } = window.jspdf;
  const el = document.getElementById('reportPrintArea');
  const canvas = await html2canvas(el, { scale: 2, useCORS: true, backgroundColor: '#ffffff' });
  const imgData = canvas.toDataURL('image/png');
  const pdf = new jsPDF({ orientation: 'portrait', unit: 'px', format: [canvas.width / 2, canvas.height / 2] });
  pdf.addImage(imgData, 'PNG', 0, 0, canvas.width / 2, canvas.height / 2);
  pdf.save(`LeafSense_Report_${Date.now()}.pdf`);
}

async function downloadReportPNG() {
  const el = document.getElementById('reportPrintArea');
  const canvas = await html2canvas(el, { scale: 2, useCORS: true, backgroundColor: '#ffffff' });
  const link = document.createElement('a');
  link.download = `LeafSense_Report_${Date.now()}.png`;
  link.href = canvas.toDataURL('image/png');
  link.click();
}
// ============================================================
//  TREATMENT COST ESTIMATOR
// ============================================================

// ============================================================
//  GROQ-POWERED COST ESTIMATOR + SPRAY SCHEDULER
// ============================================================

async function fetchGroqSpray(data) {
  const sprayEl   = document.getElementById('spraySchedulerCard');
  if (!sprayEl) return;
  const isHealthy = (data.predicted_class || '').toLowerCase().includes('healthy');
  const analysisEl = document.getElementById('analysisCard');
  if (isHealthy) {
    sprayEl.style.display = 'none';
    if (analysisEl) analysisEl.classList.add('full-width');
    return;
  }
  if (analysisEl) analysisEl.classList.remove('full-width');

  // Show loading
  sprayEl.style.display = 'block';
  sprayEl.innerHTML = `
    <div class="res-card-title">
      <i data-lucide="calendar-clock" style="width:13px;height:13px;margin-right:5px;vertical-align:middle;"></i>
      Spray Scheduler
    </div>
    <div class="spray-loading">
      <div class="spray-spinner"></div> Building your AI spray schedule…
    </div>`;
  if (typeof lucide !== 'undefined') lucide.createIcons();

  // Build payload — include weather if available
  const wx     = data.weatherData?.context?.weather  || {};
  const loc    = data.weatherData?.context?.location || {};
  const sowCtx = data.weatherData?.context?.sowing   || {};

  const payload = {
    predicted_class: data.predicted_class,
    confidence:      data.confidence,
    severity_pct:    data.pct || 0,
    stage:           data.stage,
    urgency:         data.urgency,
    temperature_c:   wx.temperature_c  ?? null,
    humidity_pct:    wx.humidity_pct   ?? null,
    rain_3day_mm:    wx.rain_3day_mm   ?? null,
    rain_forecast:   wx.rain_forecast  ?? null,
    location_city:   loc.city          ?? null,
    location_state:  loc.state         ?? null,
    soil_type:       data.weatherData?.context?.soil_type ?? null,
    sowing_date:     sowCtx.sowing_date ?? null,
  };

  try {
    const res = await fetch('/groq-cost-spray', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', ...Session.authHeaders() },
      body:    JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(`Status ${res.status}`);
    const result = await res.json();
    if (!result.success) throw new Error(result.error || 'Groq error');
    renderGroqSpray(result.spray);
  } catch (err) {
    console.error('Spray Groq error:', err);
    renderSprayError();
  }
}

function renderGroqSpray(spray) {
  const el = document.getElementById('spraySchedulerCard');
  if (!el || !spray) { renderSprayError(); return; }

  const statusMap = {
    safe_to_spray: { cls: 'spray-rain-safe', icon: 'sun' },
    delay_rain:    { cls: 'spray-rain-warn', icon: 'cloud-rain' },
    light_rain_ok: { cls: 'spray-rain-ok',   icon: 'cloud' },
  };
  const st = statusMap[spray.weather_status] || statusMap['safe_to_spray'];

  const today = new Date();

  const scheduleHTML = (spray.schedule || []).map((s, idx) => {
    const sprayDate = new Date(today);
    sprayDate.setDate(today.getDate() + (s.date_offset_days || 0));
    const dateStr = sprayDate.toLocaleDateString('en-IN', { weekday:'short', day:'numeric', month:'short' });
    return `
      <div class="spray-item ${idx === 0 ? 'spray-first' : ''}">
        <div class="spray-dot"></div>
        <div class="spray-info">
          <div class="spray-date">${dateStr}</div>
          <div class="spray-label">${s.label}</div>
          <div class="spray-time">
            <i data-lucide="clock" style="width:11px;height:11px;vertical-align:middle;"></i>
            ${s.best_time}
          </div>
          ${s.notes ? `<div class="spray-notes">${s.notes}</div>` : ''}
        </div>
        <div class="spray-num">#${s.spray_number}</div>
      </div>`;
  }).join('');

  const precautionsHTML = (spray.precautions || []).map(p =>
    `<li>${p}</li>`
  ).join('');

  el.innerHTML = `
    <div class="res-card-title">
      <i data-lucide="calendar-clock" style="width:13px;height:13px;margin-right:5px;vertical-align:middle;"></i>
      Spray Scheduler
      <span class="groq-badge">AI</span>
    </div>
    <div class="${st.cls}">
      <i data-lucide="${st.icon}" style="width:13px;height:13px;vertical-align:middle;flex-shrink:0;"></i>
      ${spray.weather_message}
    </div>
    <div class="spray-timeline">${scheduleHTML}</div>
    ${precautionsHTML ? `
    <div class="spray-precautions">
      <div class="spray-prec-title">
        <i data-lucide="shield-alert" style="width:12px;height:12px;vertical-align:middle;flex-shrink:0;"></i>
        Precautions
      </div>
      <ul class="spray-prec-list">${precautionsHTML}</ul>
    </div>` : ''}`;
  if (typeof lucide !== 'undefined') lucide.createIcons();
}

function renderSprayError() {
  const el = document.getElementById('spraySchedulerCard');
  if (el) el.innerHTML = `
    <div class="res-card-title">
      <i data-lucide="calendar-clock" style="width:13px;height:13px;margin-right:5px;vertical-align:middle;"></i>
      Spray Scheduler
    </div>
    <div class="analysis-error">
      <i data-lucide="alert-triangle" style="width:13px;height:13px;color:#c62828;vertical-align:middle;"></i>
      Spray schedule unavailable right now.
    </div>`;
  if (typeof lucide !== 'undefined') lucide.createIcons();
}