(function () {
  'use strict';

  const PING_URL          = '/health';
  const PING_TIMEOUT_MS   = 6000;
  const RETRY_INTERVAL_MS = 8000;
  const OVERLAY_ID        = 'ls-network-overlay';

  let retryTimer = null;
  let isOffline  = false;

  // Inject overlay + toast HTML into <body> automatically 
  function injectHTML() {
    if (document.getElementById(OVERLAY_ID)) return; // already injected

    // -- Offline overlay --
    const overlay = document.createElement('div');
    overlay.id = OVERLAY_ID;
    overlay.innerHTML = `
      <div class="ls-net-card">

        <div class="ls-net-icon-wrap">
          <svg viewBox="0 0 24 24" fill="none" stroke-width="2"
               stroke-linecap="round" stroke-linejoin="round">
            <line x1="1"  y1="1"  x2="23" y2="23"/>
            <path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55"/>
            <path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39"/>
            <path d="M10.71 5.05A16 16 0 0 1 22.56 9"/>
            <path d="M1.42 9a15.91 15.91 0 0 1 4.7-2.88"/>
            <path d="M8.53 16.11a6 6 0 0 1 6.95 0"/>
            <line x1="12" y1="20" x2="12.01" y2="20"/>
          </svg>
        </div>

        <div class="ls-net-badge">
          <span class="ls-net-badge-dot"></span>
          No Internet
        </div>

        <h2 class="ls-net-title">You're Offline</h2>
        <p class="ls-net-msg">
          LeafSense needs an internet connection to detect plant diseases
          and fetch AI advice. Please check your Wi-Fi or mobile data
          and try again.
        </p>

        <button class="ls-net-retry-btn" id="ls-net-retry-btn"
                onclick="window.__lsNetCheck()">
          <svg viewBox="0 0 24 24" fill="none" stroke-width="2.5"
               stroke-linecap="round" stroke-linejoin="round">
            <polyline points="23 4 23 10 17 10"/>
            <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
          </svg>
          Try Again
        </button>

        <p class="ls-net-auto">Checking automatically every 8 seconds…</p>

      </div>
    `;
    document.body.insertBefore(overlay, document.body.firstChild);

    // -- Reconnected toast --
    const toast = document.createElement('div');
    toast.id = 'ls-net-toast';
    toast.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke-width="2.5"
           stroke-linecap="round" stroke-linejoin="round">
        <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
        <polyline points="22 4 12 14.01 9 11.01"/>
      </svg>
      Back online — you're good to go!
    `;
    document.body.appendChild(toast);
  }

  //  Show / hide overlay 
  function showOverlay() {
    const el = document.getElementById(OVERLAY_ID);
    if (el) el.classList.add('ls-visible');
  }

  function hideOverlay() {
    const el = document.getElementById(OVERLAY_ID);
    if (el) el.classList.remove('ls-visible');
  }

  //  Reconnected toast 
  function showReconnectedToast() {
    const toast = document.getElementById('ls-net-toast');
    if (!toast) return;
    toast.classList.add('ls-toast-show');
    setTimeout(() => toast.classList.remove('ls-toast-show'), 3000);
  }

  // Retry button state 
  function setRetryBusy(busy) {
    const btn = document.getElementById('ls-net-retry-btn');
    if (!btn) return;
    btn.disabled = busy;
    if (busy) {
      btn.textContent = 'Checking…';
    } else {
      btn.innerHTML = `
        <svg viewBox="0 0 24 24" fill="none" stroke-width="2.5"
             stroke-linecap="round" stroke-linejoin="round"
             style="width:15px;height:15px;stroke:#fff;flex-shrink:0;">
          <polyline points="23 4 23 10 17 10"/>
          <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
        </svg>
        Try Again
      `;
    }
  }

  //Ping /health 
  async function pingServer() {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PING_TIMEOUT_MS);
    try {
      const res = await fetch(PING_URL, {
        method: 'GET',
        cache:  'no-store',
        signal: controller.signal,
      });
      clearTimeout(timer);
      return res.ok;
    } catch (_) {
      clearTimeout(timer);
      return false;
    }
  }

  // Core connectivity check 
  async function checkConnectivity() {
    if (!navigator.onLine) { markOffline(); return; }
    const reachable = await pingServer();
    reachable ? markOnline() : markOffline();
  }

  function markOffline() {
    if (!isOffline) {
      isOffline = true;
      showOverlay();
      startRetryTimer();
    }
  }

  function markOnline() {
    if (isOffline) {
      isOffline = false;
      stopRetryTimer();
      hideOverlay();
      showReconnectedToast();
    } else {
      hideOverlay();
    }
  }

  // Auto-retry timer 
  function startRetryTimer() {
    stopRetryTimer();
    retryTimer = setInterval(checkConnectivity, RETRY_INTERVAL_MS);
  }

  function stopRetryTimer() {
    if (retryTimer) { clearInterval(retryTimer); retryTimer = null; }
  }

  // Manual retry (button) 
  window.__lsNetCheck = async function () {
    setRetryBusy(true);
    await checkConnectivity();
    setRetryBusy(false);
  };

  // Browser events 
  window.addEventListener('offline', markOffline);
  window.addEventListener('online',  checkConnectivity);

  //  Boot 
  function init() {
    injectHTML();         // create the overlay + toast in DOM
    checkConnectivity();  // run the first check
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();