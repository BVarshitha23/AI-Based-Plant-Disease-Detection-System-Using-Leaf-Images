document.addEventListener("DOMContentLoaded", () => {
  // Protect page
  if (!Session.requireAuth()) return;

  // Render navbar
  Session.renderProtectedNav();
});

// FastAPI URL
// FastAPI runs at: uvicorn app:app --host 0.0.0.0 --port 8000
const API_URL = '/predict';

// State 
let selectedFile  = null;
let currentResult = null;
let currentLang   = 'en';

//  TREATMENT DATABASE
const TREATMENTS = {
  'Tomato - Early Blight': [
    { i: '<i data-lucide="spray-can" style="width:16px;height:16px;color:var(--leaf);"></i>', t: 'Spray copper-based fungicide (Bordeaux mixture) every 7–10 days.' },
    { i: '<i data-lucide="scissors" style="width:16px;height:16px;color:var(--leaf);"></i>', t: 'Cut off and burn all yellow or spotted leaves today.' },
    { i: '<i data-lucide="sprout" style="width:16px;height:16px;color:var(--leaf);"></i>', t: 'Organic option: Neem oil spray (5ml per 1 litre water) twice a week.' },
    { i: '<i data-lucide="droplets" style="width:16px;height:16px;color:var(--leaf);"></i>', t: 'Water only at the base — avoid wetting the leaves.' }
  ],
  'Tomato - Late Blight': [
    { i: '<i data-lucide="siren" style="width:16px;height:16px;color:var(--leaf);"></i>', t: 'Apply metalaxyl or cymoxanil fungicide urgently — act within 24 hours!' },
    { i: '<i data-lucide="scissors" style="width:16px;height:16px;color:var(--leaf);"></i>', t: 'Remove and destroy all infected leaves and stems immediately.' },
    { i: '<i data-lucide="ban" style="width:16px;height:16px;color:var(--leaf);"></i>', t: 'Isolate infected plants from healthy ones right away.' },
    { i: '<i data-lucide="phone" style="width:16px;height:16px;color:var(--leaf);"></i>', t: 'Call Kisan Helpline 1800-180-1551 if you are unsure what to do.' }
  ],
  'Tomato - Bacterial Spot': [
    { i: '<i data-lucide="spray-can" style="width:16px;height:16px;color:var(--leaf);"></i>', t: 'Apply copper-based bactericide spray every 7 days.' },
    { i: '<i data-lucide="scissors" style="width:16px;height:16px;color:var(--leaf);"></i>', t: 'Remove infected leaves and dispose away from the field.' },
    { i: '<i data-lucide="droplets" style="width:16px;height:16px;color:var(--leaf);"></i>', t: 'Avoid overhead irrigation — use drip irrigation instead.' },
    { i: '<i data-lucide="refresh-cw" style="width:16px;height:16px;color:var(--leaf);"></i>', t: 'Rotate crops next season to prevent recurrence.' }
  ],
  'Tomato - Septoria Leaf Spot': [
    { i: '<i data-lucide="spray-can" style="width:16px;height:16px;color:var(--leaf);"></i>', t: 'Apply mancozeb or chlorothalonil fungicide immediately.' },
    { i: '<i data-lucide="scissors" style="width:16px;height:16px;color:var(--leaf);"></i>', t: 'Remove lower infected leaves and dispose of them properly.' },
    { i: '<i data-lucide="droplets" style="width:16px;height:16px;color:var(--leaf);"></i>', t: 'Water at the base — keep foliage dry as much as possible.' },
    { i: '<i data-lucide="refresh-cw" style="width:16px;height:16px;color:var(--leaf);"></i>', t: 'Avoid planting tomatoes in the same spot next season.' }
  ],
  'Tomato - Spider Mites Two Spotted Spider Mite': [
    { i: '<i data-lucide="spray-can" style="width:16px;height:16px;color:var(--leaf);"></i>', t: 'Apply miticide or insecticidal soap spray.' },
    { i: '<i data-lucide="droplets" style="width:16px;height:16px;color:var(--leaf);"></i>', t: 'Spray water forcefully on leaf undersides to dislodge mites.' },
    { i: '<i data-lucide="sprout" style="width:16px;height:16px;color:var(--leaf);"></i>', t: 'Organic: Neem oil spray on both sides of leaves.' },
    { i: '<i data-lucide="thermometer" style="width:16px;height:16px;color:var(--leaf);"></i>', t: 'Mites thrive in heat — increase irrigation to reduce stress.' }
  ],
  'Tomato - Target Spot': [
    { i: '<i data-lucide="spray-can" style="width:16px;height:16px;color:var(--leaf);"></i>', t: 'Apply azoxystrobin or chlorothalonil fungicide spray.' },
    { i: '<i data-lucide="scissors" style="width:16px;height:16px;color:var(--leaf);"></i>', t: 'Remove heavily infected leaves from the plant.' },
    { i: '<i data-lucide="wind" style="width:16px;height:16px;color:var(--leaf);"></i>', t: 'Improve air circulation by pruning dense foliage.' },
    { i: '<i data-lucide="droplets" style="width:16px;height:16px;color:var(--leaf);"></i>', t: 'Avoid overhead watering — water at the root base only.' }
  ],
  'Tomato - Tomato Yellow Leaf Curl Virus': [
    { i: '<i data-lucide="siren" style="width:16px;height:16px;color:var(--leaf);"></i>', t: 'No cure — remove and destroy infected plants immediately.' },
    { i: '<i data-lucide="bug" style="width:16px;height:16px;color:var(--leaf);"></i>', t: 'Control whiteflies using yellow sticky traps and insecticide.' },
    { i: '<i data-lucide="seedling" style="width:16px;height:16px;color:var(--leaf);"></i>', t: 'Use virus-resistant tomato varieties for next planting.' },
    { i: '<i data-lucide="ban" style="width:16px;height:16px;color:var(--leaf);"></i>', t: 'Do not touch healthy plants after handling infected ones.' }
  ],
  'Tomato - Tomato Mosaic Virus': [
    { i: '<i data-lucide="siren" style="width:16px;height:16px;color:var(--leaf);"></i>', t: 'No cure — remove infected plants to prevent further spread.' },
    { i: '<i data-lucide="hand" style="width:16px;height:16px;color:var(--leaf);"></i>', t: 'Wash hands and tools with soap after touching infected plants.' },
    { i: '<i data-lucide="ban" style="width:16px;height:16px;color:var(--leaf);"></i>', t: 'Do not smoke near plants — tobacco can carry the virus.' },
    { i: '<i data-lucide="seedling" style="width:16px;height:16px;color:var(--leaf);"></i>', t: 'Use resistant varieties and certified disease-free seeds.' }
  ],
  'Tomato - Leaf Mold': [
    { i: '<i data-lucide="spray-can" style="width:16px;height:16px;color:var(--leaf);"></i>', t: 'Apply copper-based or chlorothalonil fungicide spray.' },
    { i: '<i data-lucide="wind" style="width:16px;height:16px;color:var(--leaf);"></i>', t: 'Improve ventilation inside the greenhouse or shade net.' },
    { i: '<i data-lucide="droplets" style="width:16px;height:16px;color:var(--leaf);"></i>', t: 'Reduce humidity — avoid wetting leaves when watering.' },
    { i: '<i data-lucide="scissors" style="width:16px;height:16px;color:var(--leaf);"></i>', t: 'Remove infected leaves and dispose outside the field.' }
  ],
  'Tomato - Healthy': [
    { i: '<i data-lucide="circle-check" style="width:16px;height:16px;color:var(--leaf);"></i>', t: 'Your tomato plant is healthy — no treatment needed!' },
    { i: '<i data-lucide="droplets" style="width:16px;height:16px;color:var(--leaf);"></i>', t: 'Continue regular watering and fertilisation schedule.' },
    { i: '<i data-lucide="search" style="width:16px;height:16px;color:var(--leaf);"></i>', t: 'Monitor weekly for any early signs of disease.' },
    { i: '<i data-lucide="seedling" style="width:16px;height:16px;color:var(--leaf);"></i>', t: 'Maintain good air circulation and avoid waterlogging.' }
  ],
  'Potato - Early Blight': [
    { i: '<i data-lucide="spray-can" style="width:16px;height:16px;color:var(--leaf);"></i>', t: 'Apply mancozeb or chlorothalonil fungicide spray.' },
    { i: '<i data-lucide="wind" style="width:16px;height:16px;color:var(--leaf);"></i>', t: 'Improve air circulation by removing crowded lower leaves.' },
    { i: '<i data-lucide="sprout" style="width:16px;height:16px;color:var(--leaf);"></i>', t: 'Organic: Baking soda spray (1 tbsp per litre water).' },
    { i: '<i data-lucide="refresh-cw" style="width:16px;height:16px;color:var(--leaf);"></i>', t: 'Rotate crops next season — avoid potatoes in the same field.' }
  ],
  'Potato - Late Blight': [
    { i: '<i data-lucide="siren" style="width:16px;height:16px;color:var(--leaf);"></i>', t: 'Apply metalaxyl or cymoxanil fungicide urgently — within 24 hours!' },
    { i: '<i data-lucide="scissors" style="width:16px;height:16px;color:var(--leaf);"></i>', t: 'Remove and destroy all infected plant material immediately.' },
    { i: '<i data-lucide="ban" style="width:16px;height:16px;color:var(--leaf);"></i>', t: 'Isolate infected plants from healthy crops.' },
    { i: '<i data-lucide="phone" style="width:16px;height:16px;color:var(--leaf);"></i>', t: 'Call Kisan Helpline 1800-180-1551 if unsure.' }
  ],
  'Potato - Healthy': [
    { i: '<i data-lucide="circle-check" style="width:16px;height:16px;color:var(--leaf);"></i>', t: 'Your potato plant is healthy — no treatment needed!' },
    { i: '<i data-lucide="droplets" style="width:16px;height:16px;color:var(--leaf);"></i>', t: 'Continue regular watering and fertilisation schedule.' },
    { i: '<i data-lucide="search" style="width:16px;height:16px;color:var(--leaf);"></i>', t: 'Monitor weekly for any early signs of disease.' },
    { i: '<i data-lucide="seedling" style="width:16px;height:16px;color:var(--leaf);"></i>', t: 'Ensure good drainage to prevent waterlogging.' }
  ],
  'Corn (Maize) - Cercospora Leaf Spot Gray Leaf Spot': [
    { i: '<i data-lucide="spray-can" style="width:16px;height:16px;color:var(--leaf);"></i>', t: 'Apply propiconazole or azoxystrobin fungicide spray.' },
    { i: '<i data-lucide="wind" style="width:16px;height:16px;color:var(--leaf);"></i>', t: 'Ensure proper plant spacing for good air circulation.' },
    { i: '<i data-lucide="refresh-cw" style="width:16px;height:16px;color:var(--leaf);"></i>', t: 'Rotate crops — avoid continuous corn planting in same field.' },
    { i: '<i data-lucide="wheat" style="width:16px;height:16px;color:var(--leaf);"></i>', t: 'Use resistant hybrid varieties in next planting season.' }
  ],
  'Corn (Maize) - Common Rust': [
    { i: '<i data-lucide="spray-can" style="width:16px;height:16px;color:var(--leaf);"></i>', t: 'Apply propiconazole or mancozeb fungicide spray at early stage.' },
    { i: '<i data-lucide="seedling" style="width:16px;height:16px;color:var(--leaf);"></i>', t: 'Ensure proper spacing between plants for air circulation.' },
    { i: '<i data-lucide="search" style="width:16px;height:16px;color:var(--leaf);"></i>', t: 'Monitor plant daily — early stage is easy to control.' },
    { i: '<i data-lucide="sprout" style="width:16px;height:16px;color:var(--leaf);"></i>', t: 'Organic: Baking soda spray (1 tbsp per litre water) as prevention.' }
  ],
  'Corn (Maize) - Northern Leaf Blight': [
    { i: '<i data-lucide="spray-can" style="width:16px;height:16px;color:var(--leaf);"></i>', t: 'Apply propiconazole or azoxystrobin fungicide immediately.' },
    { i: '<i data-lucide="scissors" style="width:16px;height:16px;color:var(--leaf);"></i>', t: 'Remove heavily infected leaves to slow disease spread.' },
    { i: '<i data-lucide="wheat" style="width:16px;height:16px;color:var(--leaf);"></i>', t: 'Use resistant hybrid varieties in next planting season.' },
    { i: '<i data-lucide="droplets" style="width:16px;height:16px;color:var(--leaf);"></i>', t: 'Avoid excess nitrogen fertilizer — it promotes disease.' }
  ],
  'Corn (Maize) - Healthy': [
    { i: '<i data-lucide="circle-check" style="width:16px;height:16px;color:var(--leaf);"></i>', t: 'Your corn plant is healthy — no treatment needed!' },
    { i: '<i data-lucide="droplets" style="width:16px;height:16px;color:var(--leaf);"></i>', t: 'Continue regular watering and fertilisation schedule.' },
    { i: '<i data-lucide="search" style="width:16px;height:16px;color:var(--leaf);"></i>', t: 'Monitor weekly for any early signs of disease.' },
    { i: '<i data-lucide="seedling" style="width:16px;height:16px;color:var(--leaf);"></i>', t: 'Ensure balanced fertilization for continued healthy growth.' }
  ],
  'Apple - Apple Scab': [
    { i: '<i data-lucide="spray-can" style="width:16px;height:16px;color:var(--leaf);"></i>', t: 'Apply captan or mancozeb fungicide every 7–10 days.' },
    { i: '<i data-lucide="leaf" style="width:16px;height:16px;color:var(--leaf);"></i>', t: 'Rake and destroy fallen leaves — they harbour fungal spores.' },
    { i: '<i data-lucide="scissors" style="width:16px;height:16px;color:var(--leaf);"></i>', t: 'Prune overcrowded branches to improve air circulation.' },
    { i: '<i data-lucide="sprout" style="width:16px;height:16px;color:var(--leaf);"></i>', t: 'Organic: Sulphur spray as a preventive measure.' }
  ],
  'Apple - Black Rot': [
    { i: '<i data-lucide="spray-can" style="width:16px;height:16px;color:var(--leaf);"></i>', t: 'Apply captan or thiophanate-methyl fungicide spray.' },
    { i: '<i data-lucide="scissors" style="width:16px;height:16px;color:var(--leaf);"></i>', t: 'Prune and destroy all infected wood and mummified fruits.' },
    { i: '<i data-lucide="leaf" style="width:16px;height:16px;color:var(--leaf);"></i>', t: 'Remove fallen leaves and fruits from the ground.' },
    { i: '<i data-lucide="refresh-cw" style="width:16px;height:16px;color:var(--leaf);"></i>', t: 'Disinfect pruning tools between cuts with alcohol.' }
  ],
  'Apple - Cedar Apple Rust': [
    { i: '<i data-lucide="spray-can" style="width:16px;height:16px;color:var(--leaf);"></i>', t: 'Apply myclobutanil or propiconazole fungicide in early spring.' },
    { i: '<i data-lucide="scissors" style="width:16px;height:16px;color:var(--leaf);"></i>', t: 'Remove and destroy nearby cedar or juniper trees if possible.' },
    { i: '<i data-lucide="leaf" style="width:16px;height:16px;color:var(--leaf);"></i>', t: 'Remove all infected leaves and fruits from the ground.' },
    { i: '<i data-lucide="sprout" style="width:16px;height:16px;color:var(--leaf);"></i>', t: 'Use disease-resistant apple varieties for future planting.' }
  ],
  'Apple - Healthy': [
    { i: '<i data-lucide="circle-check" style="width:16px;height:16px;color:var(--leaf);"></i>', t: 'Your apple plant is healthy — no treatment needed!' },
    { i: '<i data-lucide="droplets" style="width:16px;height:16px;color:var(--leaf);"></i>', t: 'Continue regular watering and fertilisation schedule.' },
    { i: '<i data-lucide="search" style="width:16px;height:16px;color:var(--leaf);"></i>', t: 'Monitor weekly for any early signs of disease.' },
    { i: '<i data-lucide="scissors" style="width:16px;height:16px;color:var(--leaf);"></i>', t: 'Prune annually to maintain good air circulation.' }
  ],
  'Pepper, Bell - Bacterial Spot': [
    { i: '<i data-lucide="spray-can" style="width:16px;height:16px;color:var(--leaf);"></i>', t: 'Apply copper hydroxide bactericide every 5–7 days.' },
    { i: '<i data-lucide="scissors" style="width:16px;height:16px;color:var(--leaf);"></i>', t: 'Remove infected leaves and avoid working with wet plants.' },
    { i: '<i data-lucide="droplets" style="width:16px;height:16px;color:var(--leaf);"></i>', t: 'Use drip irrigation — avoid wetting leaves and fruit.' },
    { i: '<i data-lucide="seedling" style="width:16px;height:16px;color:var(--leaf);"></i>', t: 'Use certified disease-free seeds for next planting.' }
  ],
  'Pepper, Bell - Healthy': [
    { i: '<i data-lucide="circle-check" style="width:16px;height:16px;color:var(--leaf);"></i>', t: 'Your pepper plant is healthy — no treatment needed!' },
    { i: '<i data-lucide="droplets" style="width:16px;height:16px;color:var(--leaf);"></i>', t: 'Continue regular watering and fertilisation schedule.' },
    { i: '<i data-lucide="search" style="width:16px;height:16px;color:var(--leaf);"></i>', t: 'Monitor weekly for any early signs of disease.' },
    { i: '<i data-lucide="seedling" style="width:16px;height:16px;color:var(--leaf);"></i>', t: 'Maintain consistent moisture to prevent blossom drop.' }
  ],
  'default': [
    { i: '<i data-lucide="pill" style="width:16px;height:16px;color:var(--leaf);"></i>', t: 'Apply a broad-spectrum fungicide as a first step.' },
    { i: '<i data-lucide="scissors" style="width:16px;height:16px;color:var(--leaf);"></i>', t: 'Remove and destroy all visibly infected leaves or stems.' },
    { i: '<i data-lucide="droplets" style="width:16px;height:16px;color:var(--leaf);"></i>', t: 'Avoid overhead watering — water only at the root base.' },
    { i: '<i data-lucide="phone" style="width:16px;height:16px;color:var(--leaf);"></i>', t: 'Consult your local KVK or call 1800-180-1551 for expert guidance.' }
  ]
};


//  TRANSLATION BUILDER (pre-built — no API call needed)
function buildTranslations(predictedClass, pct, stage) {
  const isHealthy = predictedClass.toLowerCase().includes('healthy');
  const stageHi   = { Early:'प्रारंभिक', Moderate:'मध्यम', Severe:'गंभीर', Critical:'अत्यंत गंभीर' };
  const stageTe   = { Early:'ప్రారంభ', Moderate:'మధ్యస్థ', Severe:'తీవ్ర', Critical:'అత్యంత తీవ్ర' };
  const stageTa   = { Early:'ஆரம்ப', Moderate:'மிதமான', Severe:'கடுமையான', Critical:'மிகவும் கடுமையான' };
  const stageKn   = { Early:'ಆರಂಭಿಕ', Moderate:'ಮಧ್ಯಮ', Severe:'ತೀವ್ರ', Critical:'ಅತ್ಯಂತ ತೀವ್ರ' };

  if (isHealthy) {
    return {
      en: `Your plant is healthy! No disease detected. Continue regular care and monitor weekly.`,
      hi: `आपका पौधा स्वस्थ है! कोई रोग नहीं पाया गया। नियमित देखभाल जारी रखें और साप्ताहिक निगरानी करें।`,
      te: `మీ మొక్క ఆరోగ్యంగా ఉంది! ఏ వ్యాధి కనుగొనబడలేదు. సాధారణ సంరక్షణ కొనసాగించండి.`,
      ta: `உங்கள் செடி ஆரோக்கியமாக உள்ளது! நோய் எதுவும் கண்டறியப்படவில்லை. வழக்கமான பராமரிப்பை தொடரவும்.`,
      kn: `ನಿಮ್ಮ ಗಿಡ ಆರೋಗ್ಯವಾಗಿದೆ! ಯಾವುದೇ ರೋಗ ಕಂಡುಬಂದಿಲ್ಲ. ನಿಯಮಿತ ಆರೈಕೆ ಮುಂದುವರಿಸಿ.`
    };
  }

  return {
    en: `Your plant has ${predictedClass} at ${stage.toLowerCase()} stage — ${pct}% of the leaf is infected. Follow the treatment steps shown below immediately.`,
    hi: `आपके पौधे में ${predictedClass} रोग ${stageHi[stage]} अवस्था में है — ${pct}% पत्ती संक्रमित है। नीचे दिए उपचार के चरणों का तुरंत पालन करें।`,
    te: `మీ మొక్కకు ${predictedClass} వ్యాధి ${stageTe[stage]} దశలో ఉంది — ${pct}% ఆకు సోకింది. దిగువ చికిత్స దశలను వెంటనే అనుసరించండి.`,
    ta: `உங்கள் செடிக்கு ${predictedClass} நோய் ${stageTa[stage]} நிலையில் உள்ளது — ${pct}% இலை பாதிக்கப்பட்டுள்ளது. கீழே உள்ள சிகிச்சை படிகளை உடனடியாக பின்பற்றவும்.`,
    kn: `ನಿಮ್ಮ ಗಿಡಕ್ಕೆ ${predictedClass} ರೋಗ ${stageKn[stage]} ಹಂತದಲ್ಲಿದೆ — ${pct}% ಎಲೆ ಸೋಂಕಿದೆ. ಕೆಳಗೆ ತೋರಿಸಿದ ಚಿಕಿತ್ಸಾ ಹಂತಗಳನ್ನು ತಕ್ಷಣ ಅನುಸರಿಸಿ.`
  };
}


//  IMAGE UPLOAD HANDLERS
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

// Called from HTML onchange (backup — works either way)
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
  const img     = document.getElementById('previewImg');
  const zone    = document.getElementById('dropZone');
  const content = document.getElementById('dzContent');

  img.src           = url;
  img.style.display = 'block';
  content.style.display = 'none';
  zone.classList.add('has-img');

  const btn = document.getElementById('scanBtn');
  btn.disabled    = false;
  btn.innerHTML = '<i data-lucide="scan-line" style="width:18px;height:18px;"></i>&nbsp; Scan This Leaf Now';
  if (typeof lucide !== 'undefined') lucide.createIcons();

}


//  SCAN — CALLS YOUR FastAPI POST /predict
const STEPS = [
  'Checking image quality...',
  'Running disease detection...',
  'Calculating severity...',
  'Fetching treatment advice...',
  'Preparing your result...'
];

async function startScan() {
  //  Ensure user logged in
  const token = Session.getToken();

  console.log("TOKEN:", token); 
  
  if (!token) {
    alert("Please login first");
    window.location.href = "login.html";
    return;
  }

  if (!selectedFile) return;

  document.getElementById('scanBtnWrap').style.display = 'none';
  document.getElementById('analyzingBox').classList.add('show');
  document.getElementById('resultSection').classList.remove('show');

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
    //  POST /predict 
    const formData = new FormData();
    formData.append('file', selectedFile);  

    const response = await fetch("/predict", {
      method: 'POST',
      headers: {
    ...Session.authHeaders(), 
     },
      body: formData
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      throw new Error(errData.detail || `Server error ${response.status}`);
    }

    const apiData = await response.json();

    const predicted_class = apiData.predicted_class;  
    const confidence      = apiData.confidence;       
    const pct             = apiData.severity_pct;     
    const stage           = apiData.stage;            
    const urgency         = apiData.urgency;         

    // Build translations using real severity data
    const translations = buildTranslations(predicted_class, pct, stage);

    currentResult = { predicted_class, confidence, pct, stage, urgency, translations };
    currentLang   = 'en';

    clearInterval(stepTimer);
    fillEl.style.width = '100%';
    stepEl.textContent = 'Done!';

    setTimeout(() => {
      document.getElementById('analyzingBox').classList.remove('show');
      renderResult(currentResult);
    }, 400);

  } catch (error) {
    clearInterval(stepTimer);
    console.error('API Error:', error);

    document.getElementById('analyzingBox').classList.remove('show');
    document.getElementById('scanBtnWrap').style.display = 'block';
    fillEl.style.width = '0%';

    const btn = document.getElementById('scanBtn');
    btn.textContent      = 'Error: ' + (error.message || 'Cannot connect to FastAPI. Is it running?');
    btn.style.background = '#c62828';
    btn.disabled         = true;

    setTimeout(() => {
      btn.innerHTML = '<i data-lucide="scan-line" style="width:18px;height:18px;"></i>&nbsp; Scan This Leaf Now';
  if (typeof lucide !== 'undefined') lucide.createIcons();
      btn.style.background = '';
      btn.disabled         = false;
    }, 4000);
  }
}


//  RENDER RESULT
function renderResult(data) {
  const isHealthy = data.predicted_class.toLowerCase().includes('healthy');

  // Crop icon map — lucide icon names per crop
  const cropIconMap = {
    tomato: 'cherry',
    potato: 'box',
    corn:   'wheat',
    apple:  'apple',
    pepper: 'flame'
  };
  const cropKey  = Object.keys(cropIconMap).find(k => data.predicted_class.toLowerCase().includes(k));
  const iconName = cropIconMap[cropKey] || 'leaf';
  document.getElementById('rbIcon').setAttribute('data-lucide', iconName);
  document.getElementById('rbDisease').textContent = data.predicted_class;
  document.getElementById('rbDetail').textContent  = 'Detected just now';
  document.getElementById('rbConf').textContent    = data.confidence + '%';

  // Show unknown bar if confidence is below 60%
  document.getElementById('unknownBar').classList.toggle('show', data.confidence < 60);

  renderSeverity(data.pct, data.stage, isHealthy);

  const items = TREATMENTS[data.predicted_class] || TREATMENTS['default'];
  document.getElementById('treatList').innerHTML = items.map(t =>
    `<div class="treat-item">
       <div class="treat-icon">${t.i}</div>
       <div class="treat-text">${t.t}</div>
     </div>`
  ).join('');

  document.getElementById('transBox').textContent = data.translations['en'];
  document.querySelectorAll('.lang-btn').forEach(b => b.classList.remove('active'));
  document.querySelector('.lang-btn').classList.add('active');

  // Re-initialise Lucide icons for dynamically injected HTML
  if (typeof lucide !== 'undefined') lucide.createIcons();

  const section = document.getElementById('resultSection');
  section.classList.add('show');
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
    badge.className   = 'sev-badge sev-early';
  } else {
    badge.innerHTML = '<i data-lucide="' + stageIcons[si] + '" style="width:13px;height:13px;margin-right:5px;vertical-align:middle;"></i>' + stage + ' Stage';
    badge.className   = 'sev-badge';
    if (stage === 'Early')    badge.classList.add('sev-early');
    if (stage === 'Severe')   badge.classList.add('sev-severe');
    if (stage === 'Critical') badge.classList.add('sev-critical');
  }

  [0, 1, 2, 3].forEach(i => {
    const el = document.getElementById('s' + i);
    el.className = 'sev-stage' + (i === si ? ' active ' + stageNames[i] : '');
  });
}


//  LANGUAGE SWITCH — uses pre-built translations
function setLang(el, lang) {
  currentLang = lang;
  document.querySelectorAll('.lang-btn').forEach(b => b.classList.remove('active'));
  el.classList.add('active');
  if (currentResult && currentResult.translations[lang]) {
    document.getElementById('transBox').textContent = currentResult.translations[lang];
  }
}


//  VOICE OUTPUT
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
    utt.onend = () => { btn.innerHTML = '<i data-lucide="volume-2" style="width:16px;height:16px;"></i> Listen Now'; btn.onclick = speakResult; if(typeof lucide!=='undefined') lucide.createIcons(); };
    btn.onclick = () => {
      if (window.speechSynthesis.speaking) {
        window.speechSynthesis.cancel();
        btn.innerHTML = '<i data-lucide="volume-2" style="width:16px;height:16px;"></i> Listen Now';
        btn.onclick = speakResult;
        if(typeof lucide!=='undefined') lucide.createIcons();
      }
    };
    window.speechSynthesis.speak(utt);
  } else {
    alert('Voice not supported. Please use Chrome or Edge.');
  }
}
window.speechSynthesis && window.speechSynthesis.getVoices();


//  RESET SCAN
function resetScan() {
  selectedFile  = null;
  currentResult = null;
  currentLang   = 'en';

  const img = document.getElementById('previewImg');
  img.style.display = 'none';
  img.src = '';
  document.getElementById('dzContent').style.display  = 'flex';
  document.getElementById('dropZone').classList.remove('has-img');
  document.getElementById('fileInput').value = '';

  document.getElementById('scanBtnWrap').style.display = 'block';
  const btn = document.getElementById('scanBtn');
  btn.disabled         = true;
  btn.innerHTML = '<i data-lucide="upload-cloud" style="width:18px;height:18px;"></i> Upload a photo to scan';
  if(typeof lucide!=='undefined') lucide.createIcons();
  btn.style.background = '';

  document.getElementById('progFill').style.width = '0%';
  document.getElementById('analyzingBox').classList.remove('show');
  document.getElementById('sevFill').style.width  = '0%';
  document.getElementById('resultSection').classList.remove('show');
  document.getElementById('unknownBar').classList.remove('show');

  const playBtn = document.getElementById('playBtn');
  playBtn.textContent = '▶ Listen Now';
  playBtn.onclick     = speakResult;

  if ('speechSynthesis' in window) window.speechSynthesis.cancel();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}