import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { 
  getAuth, 
  onAuthStateChanged, 
  signInWithEmailAndPassword, 
  createUserWithEmailAndPassword,
  GoogleAuthProvider,
  signInWithPopup,
  signOut
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";

const firebaseConfig = {
  projectId: "novaquant-engine-1",
  appId: "1:492487783489:web:e66c8245df094527b042c0",
  storageBucket: "novaquant-engine-1.firebasestorage.app",
  apiKey: "AIzaSyARlJTyvyo48sJbwyFR3svGjAf65LX5LNI",
  authDomain: "novaquant-engine-1.firebaseapp.com",
  messagingSenderId: "492487783489",
  measurementId: "G-EQ5SZDBW84"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const provider = new GoogleAuthProvider();

// UI Elements
const authOverlay = document.getElementById('auth-overlay');
const mainApp = document.getElementById('main-app');
const loginForm = document.getElementById('login-form');
const emailInput = document.getElementById('auth-email');
const passwordInput = document.getElementById('auth-password');
const googleBtn = document.getElementById('google-login-btn');
const authError = document.getElementById('auth-error');
const userEmailDisplay = document.getElementById('user-email-display');
const logoutBtn = document.getElementById('logout-btn');

let currentUser = null;

onAuthStateChanged(auth, (user) => {
  if (user) {
    currentUser = user;
    authOverlay.style.display = 'none';
    mainApp.style.display = 'block';
    mainApp.style.filter = 'none';
    userEmailDisplay.textContent = user.email;
    init(); 
  } else {
    currentUser = null;
    authOverlay.style.display = 'flex';
    mainApp.style.display = 'none';
    mainApp.style.filter = 'blur(5px)';
  }
});

loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = emailInput.value;
  const password = passwordInput.value;
  authError.textContent = '';
  try {
    try {
      await signInWithEmailAndPassword(auth, email, password);
    } catch (err) {
      if (err.code === 'auth/user-not-found' || err.code === 'auth/invalid-credential') {
        await createUserWithEmailAndPassword(auth, email, password);
      } else {
        throw err;
      }
    }
  } catch (err) {
    authError.textContent = 'Error: ' + err.message;
  }
});

googleBtn.addEventListener('click', async () => {
  try {
    await signInWithPopup(auth, provider);
  } catch (err) {
    authError.textContent = 'Google Sign-In Error: ' + err.message;
  }
});

logoutBtn.addEventListener('click', () => {
  signOut(auth);
});

async function authorizedFetch(url, options = {}) {
  if (!currentUser) throw new Error("Not authenticated");
  const token = await currentUser.getIdToken();
  const headers = {
    ...options.headers,
    'Authorization': `Bearer ${token}`
  };
  return fetch(url, { ...options, headers });
}

const API_URL = '/api/settings';

// State
let state = {
  cryptoPairs: [],
  forexPairs: []
};

// Elements
const cryptoList = document.getElementById('crypto-list');
const forexList = document.getElementById('forex-list');
const cryptoForm = document.getElementById('crypto-form');
const forexForm = document.getElementById('forex-form');
const cryptoInput = document.getElementById('crypto-input');
const forexInput = document.getElementById('forex-input');

// Init
async function init() {
  await fetchSettings();
  renderLists();
}

async function fetchSettings() {
  try {
    const res = await authorizedFetch(API_URL);
    const data = await res.json();
    state = data;
  } catch (err) {
    console.error('Failed to fetch settings:', err);
    state = { cryptoPairs: [], forexPairs: [] };
  }
}

async function updateServer() {
  try {
    const res = await authorizedFetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(state)
    });
    const data = await res.json();
    if (data.success) {
      state = data.activeSettings;
      renderLists();
    }
  } catch (err) {
    console.error('Failed to update settings:', err);
  }
}

// Render
function renderLists() {
  renderList(cryptoList, state.cryptoPairs, 'cryptoPairs');
  renderList(forexList, state.forexPairs, 'forexPairs');
}

function renderList(container, items, type) {
  container.innerHTML = '';
  
  if (!items || items.length === 0) {
    container.innerHTML = '<div style="color:var(--text-muted); text-align:center; padding-top:20px; font-weight: 300;">No pairs tracked. Add one below.</div>';
    return;
  }

  items.forEach((item, index) => {
    const div = document.createElement('div');
    div.className = 'pair-item';
    div.style.animationDelay = `${index * 0.05}s`;
    
    div.innerHTML = `
      <span class="pair-name">${item}</span>
      <button class="delete-btn" onclick="removePair('${type}', '${item}')" title="Remove pair">
        <i class="fa-solid fa-xmark"></i>
      </button>
    `;
    container.appendChild(div);
  });
}

// Handlers
function formatPair(val) {
  val = val.trim().toUpperCase();
  if (!val || val.includes('/')) return val;
  
  // Format Forex & Crypto (e.g., GBPUSD -> GBP/USD)
  if (val.length === 6) {
    return val.substring(0, 3) + '/' + val.substring(3);
  }
  
  if (val.endsWith('USDT')) return val.slice(0, -4) + '/USDT';
  if (val.endsWith('USD')) return val.slice(0, -3) + '/USD';
  
  return val;
}

cryptoForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const val = formatPair(cryptoInput.value);
  if (val && !state.cryptoPairs.includes(val)) {
    state.cryptoPairs.push(val);
    cryptoInput.value = '';
    updateServer();
  }
});

forexForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const val = formatPair(forexInput.value);
  if (val && !state.forexPairs.includes(val)) {
    state.forexPairs.push(val);
    forexInput.value = '';
    updateServer();
  }
});

window.removePair = (type, itemToRemove) => {
  state[type] = state[type].filter(item => item !== itemToRemove);
  updateServer();
};

// Backtester Logic
const backtestForm = document.getElementById('backtest-form');
const backtestInput = document.getElementById('backtest-input');
const btRange = document.getElementById('bt-range');

// Initialize Flatpickr 7 days default
const today = new Date();
const sevenDaysAgo = new Date();
sevenDaysAgo.setDate(today.getDate() - 7);

const datePicker = flatpickr(btRange, {
  mode: "range",
  defaultDate: [sevenDaysAgo, today],
  dateFormat: "Y-m-d",
  static: true,
});
const backtestBtn = document.getElementById('backtest-btn');
const backtestResultsDiv = document.getElementById('backtest-results');
const btLoader = document.getElementById('bt-loader');
const btContent = document.getElementById('bt-content');
const btTelegramBtn = document.getElementById('bt-telegram-btn');

let latestBtResults = null;
let currentBtSymbol = null;

backtestForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const val = formatPair(backtestInput.value);
  const dates = datePicker.selectedDates;
  if (!val || dates.length !== 2) return;
  const startDate = flatpickr.formatDate(dates[0], "Y-m-d");
  const endDate = flatpickr.formatDate(dates[1], "Y-m-d");
  
  // UI State Loading
  backtestBtn.disabled = true;
  backtestBtn.style.opacity = '0.5';
  backtestResultsDiv.style.display = 'block';
  btLoader.style.display = 'block';
  btContent.style.display = 'none';
  btTelegramBtn.style.display = 'none';

  try {
    const res = await authorizedFetch('/api/backtest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ symbol: val, startDate, endDate })
    });
    
    const data = await res.json();
    if (data.success) {
      latestBtResults = data.data;
      currentBtSymbol = data.symbol;
      
      let outputHTML = `<strong style="color:var(--primary-glow); font-size:1.1rem;">Results for ${data.symbol}:</strong><br><strong style="font-size:0.8rem; color:var(--text-muted)">(${startDate} to ${endDate})</strong><br><br>`;
      
      const stats = data.data;
      for (const [interval, result] of Object.entries(stats)) {
        if (result.error) {
           outputHTML += `<span style="color:var(--danger)">[${interval}] ERROR: ${result.error}</span><br>`;
        } else {
           outputHTML += `<div style="background:rgba(255,255,255,0.05); padding:10px; border-radius:6px; margin-bottom:10px;">
                <span style="color:var(--success); font-weight:bold;">[${interval}]</span> Scanned: ${result.candles} | <strong style="color:var(--accent);">Setups: ${result.setups} (${result.winRate} Win Rate)</strong><br>`;
           
           if (result.recent && result.recent.length > 0) {
               outputHTML += `<div style="margin-top:10px; font-size:0.85rem; border-left:2px solid var(--accent); padding-left:10px;">`;
               result.recent.slice(0, 3).forEach(setup => {
                   const outcomeColor = setup.outcome === 'Win' ? 'var(--success)' : (setup.outcome === 'Loss' ? 'var(--danger)' : 'var(--text-muted)');
                   const action = setup.type.includes('BUY') ? 'BUY' : 'SELL';
                   outputHTML += `<div style="margin-bottom:8px;">
                      <strong style="color:var(--text-main);">${setup.datetime} (UTC+1 Lagos)</strong> - 👀 Action: <strong style="color:var(--accent);">${action}</strong><br>
                      🧲 Inducement Level: ${setup.idm || 'N/A'} <br>
                      🎯 Nearest OB/BB Level: ${setup.entry} <br>
                      ➔ Outcome: <strong style="color:${outcomeColor}">${setup.outcome}</strong>
                   </div>`;
               });
               outputHTML += `</div>`;
           }
           outputHTML += `</div>`;
        }
      }
      btContent.innerHTML = outputHTML;
      btTelegramBtn.style.display = 'inline-flex';
    } else {
      btContent.innerHTML = `<span style="color:var(--danger)">Failed: ${data.error || 'Unknown Error'}</span>`;
    }
  } catch (err) {
    btContent.innerHTML = `<span style="color:var(--danger)">Error: ${err.message}</span>`;
  }
  
  // UI State Finish
  btLoader.style.display = 'none';
  btContent.style.display = 'block';

  // Enforcement cooldown
  let cooldown = 30;
  const timer = setInterval(() => {
    backtestBtn.innerHTML = `<i class="fa-solid fa-hourglass"></i> ${cooldown}s`;
    cooldown--;
    if (cooldown < 0) {
      clearInterval(timer);
      backtestBtn.disabled = false;
      backtestBtn.style.opacity = '1';
      backtestBtn.innerHTML = `<i class="fa-solid fa-play"></i> Backtest`;
    }
  }, 1000);
});

btTelegramBtn.addEventListener('click', async () => {
  if (!latestBtResults || !currentBtSymbol) return;
  const origText = btTelegramBtn.innerHTML;
  btTelegramBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Sending...`;
  btTelegramBtn.disabled = true;
  btTelegramBtn.style.opacity = '0.5';
  
  try {
    const res = await authorizedFetch('/api/telegram-backtest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ symbol: currentBtSymbol, results: latestBtResults })
    });
    const d = await res.json();
    if (d.success) btTelegramBtn.innerHTML = `<i class="fa-solid fa-check"></i> Sent to Telegram`;
    else btTelegramBtn.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> Error sending`;
  } catch (e) {
    btTelegramBtn.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> Fail`;
  }
  
  setTimeout(() => {
    btTelegramBtn.innerHTML = origText;
    btTelegramBtn.disabled = false;
    btTelegramBtn.style.opacity = '1';
  }, 3000);
});

// --- Server Status Checker ---
const statusText = document.getElementById('status-text');
const statusDot = document.getElementById('status-dot');
const overlayStatusText = document.getElementById('overlay-status-text');
const overlayStatusDot = document.getElementById('overlay-status-dot');

async function checkServerStatus() {
  try {
    const res = await fetch('/api/status');
    if (res.ok) {
      const data = await res.json();
      if (data.status === 'online') {
        const onlineColor = 'var(--success)';
        statusText.textContent = 'ENGINE ONLINE';
        statusText.style.color = onlineColor;
        statusDot.style.background = onlineColor;
        statusDot.style.boxShadow = `0 0 10px ${onlineColor}`;
        
        if (overlayStatusText) {
          overlayStatusText.textContent = 'ENGINE ONLINE';
          overlayStatusText.style.color = onlineColor;
          overlayStatusDot.style.background = onlineColor;
          overlayStatusDot.style.boxShadow = `0 0 10px ${onlineColor}`;
        }
        return;
      }
    }
  } catch (e) {
    // Fall through to offline
  }
  
  const offlineColor = 'var(--danger)';
  statusText.textContent = 'ENGINE OFFLINE';
  statusText.style.color = offlineColor;
  statusDot.style.background = offlineColor;
  statusDot.style.boxShadow = `0 0 10px ${offlineColor}`;
  
  if (overlayStatusText) {
    overlayStatusText.textContent = 'ENGINE OFFLINE';
    overlayStatusText.style.color = offlineColor;
    overlayStatusDot.style.background = offlineColor;
    overlayStatusDot.style.boxShadow = `0 0 10px ${offlineColor}`;
  }
}

// Check immediately and then every 15 seconds
checkServerStatus();
setInterval(checkServerStatus, 15000);

// --- System Logs Logic ---
const openLogsBtn = document.getElementById('open-logs-btn');
const closeLogsBtn = document.getElementById('close-logs-btn');
const refreshLogsBtn = document.getElementById('refresh-logs-btn');
const logsOverlay = document.getElementById('logs-overlay');
const logsContent = document.getElementById('logs-content');

openLogsBtn.addEventListener('click', () => {
  logsOverlay.style.display = 'flex';
  fetchLogs();
});

closeLogsBtn.addEventListener('click', () => {
  logsOverlay.style.display = 'none';
});

refreshLogsBtn.addEventListener('click', () => {
  fetchLogs();
});

async function fetchLogs() {
  logsContent.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Fetching secure system logs...';
  try {
    const res = await authorizedFetch('/api/logs');
    if (!res.ok) throw new Error('Failed to fetch logs');
    const logs = await res.json();
    
    if (logs.length === 0) {
      logsContent.innerHTML = 'No activity recorded yet.';
      return;
    }
    
    let html = '';
    logs.forEach(log => {
      const colorMap = {
        'INFO': 'var(--text-main)',
        'SUCCESS': 'var(--success)',
        'WARN': 'orange',
        'ERROR': 'var(--danger)'
      };
      
      const c = colorMap[log.level] || 'var(--text-main)';
      const d = new Date(log.time).toLocaleString('en-US', { timeZone: 'America/New_York' });
      
      html += `<div style="margin-bottom:8px; border-bottom:1px solid rgba(255,255,255,0.05); padding-bottom:8px; line-height:1.4;">
        <span style="color:var(--accent); font-size:0.8rem; filter:opacity(0.8)">[${d}]</span> 
        <strong style="color:${c}; width:60px; display:inline-block;">[${log.level}]</strong> 
        <span style="color:var(--text-main)">${log.message.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</span>
      </div>`;
    });
    logsContent.innerHTML = html;
  } catch(e) {
    logsContent.innerHTML = `<span style="color:var(--danger)">Error loading logs: ${e.message}</span>`;
  }
}
