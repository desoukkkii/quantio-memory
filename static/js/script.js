// ─── State ──────────────────────────────────────────────────────────────────
let token = localStorage.getItem('q_token') || '';
let currentUser = null;
let memories = [];
let isRecording = false;
let speechRecognition = null;
let offlineQueue = JSON.parse(localStorage.getItem('q_offline_queue') || '[]');
let isDark = !document.documentElement.classList.contains('light');
let ollamaOnline = false;
let settings = {};

// ─── Init ────────────────────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', async () => {
  setupOfflineDetection();
  setupSpeechRecognition();

  if (token) {
    try {
      const res = await api('/me');
      currentUser = res;
      showApp();
    } catch {
      token = '';
      localStorage.removeItem('q_token');
    }
  }

  // Theme
  const savedTheme = localStorage.getItem('q_theme');
  if (savedTheme === 'light') {
    document.documentElement.classList.add('light');
    isDark = false;
    document.getElementById('dark-toggle').classList.remove('on');
  } else {
    document.getElementById('dark-toggle').classList.add('on');
  }

  // Enter handler for auth forms
  document.getElementById('login-password').addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });
  document.getElementById('reg-password').addEventListener('keydown', e => { if (e.key === 'Enter') doRegister(); });
});

// ─── Auth ────────────────────────────────────────────────────────────────────
function switchTab(tab) {
  document.getElementById('tab-login').classList.toggle('active', tab === 'login');
  document.getElementById('tab-register').classList.toggle('active', tab === 'register');
  document.getElementById('login-form').style.display = tab === 'login' ? '' : 'none';
  document.getElementById('register-form').style.display = tab === 'register' ? '' : 'none';
  document.getElementById('auth-error').textContent = '';
}

async function doLogin() {
  const btn = document.getElementById('login-btn');
  const email = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;
  if (!email || !password) { setAuthError('Please fill in all fields'); return; }
  btn.innerHTML = '<span class="spinner"></span>';
  btn.disabled = true;
  try {
    const res = await fetch('/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || 'Login failed');
    token = data.token;
    localStorage.setItem('q_token', token);
    currentUser = { id: data.user_id, email: data.email };
    showApp();
  } catch (e) {
    setAuthError(e.message);
    btn.innerHTML = 'Sign In';
    btn.disabled = false;
  }
}

async function doRegister() {
  const btn = document.getElementById('reg-btn');
  const email = document.getElementById('reg-email').value.trim();
  const password = document.getElementById('reg-password').value;
  if (!email || !password) { setAuthError('Please fill in all fields'); return; }
  btn.innerHTML = '<span class="spinner"></span>';
  btn.disabled = true;
  try {
    const res = await fetch('/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || 'Registration failed');
    token = data.token;
    localStorage.setItem('q_token', token);
    currentUser = { id: data.user_id, email: data.email };
    showApp();
  } catch (e) {
    setAuthError(e.message);
    btn.innerHTML = 'Create Account';
    btn.disabled = false;
  }
}

function setAuthError(msg) {
  document.getElementById('auth-error').textContent = msg;
}

function doLogout() {
  token = '';
  currentUser = null;
  localStorage.removeItem('q_token');
  document.getElementById('app').classList.remove('visible');
  document.getElementById('auth-screen').style.display = 'flex';
  document.getElementById('messages').innerHTML = `
    <div class="empty-state" id="empty-state">
      <div class="empty-icon">🧠</div>
      <div class="empty-title">Welcome to Quantio</div>
      <div class="empty-subtitle">Your AI remembers everything. Ask about past conversations, set preferences, or just start chatting.</div>
    </div>`;
}

// ─── App initialisation ───────────────────────────────────────────────────────
async function showApp() {
  document.getElementById('auth-screen').style.display = 'none';
  document.getElementById('app').classList.add('visible');
  await Promise.all([checkOllama(), loadSettings(), refreshMemories()]);
  generateInsight();
  setInterval(checkOllama, 15000);
  processOfflineQueue();
}

// ─── API helpers ──────────────────────────────────────────────────────────────
async function api(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
      ...(options.headers || {}),
    },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.detail || `Error ${res.status}`);
  return data;
}

// ─── Ollama status ────────────────────────────────────────────────────────────
async function checkOllama() {
  try {
    const data = await fetch('/ollama/status').then(r => r.json());
    ollamaOnline = data.available;
    const dot = document.getElementById('ollama-dot');
    const label = document.getElementById('ollama-label');
    dot.classList.toggle('online', data.available);
    label.textContent = data.available ? 'Ollama online' : 'Ollama offline';

    // Populate model selector
    const modelSel = document.getElementById('pref-ollama-model');
    const currentVal = modelSel.value;
    modelSel.innerHTML = '';
    const models = data.models.length ? data.models : ['llama3.2'];
    models.forEach(m => {
      const opt = document.createElement('option');
      opt.value = opt.textContent = m;
      if (m === currentVal || m === settings.ollama_model) opt.selected = true;
      modelSel.appendChild(opt);
    });
  } catch {
    ollamaOnline = false;
    document.getElementById('ollama-dot').classList.remove('online');
    document.getElementById('ollama-label').textContent = 'Ollama offline';
  }
}

// ─── Settings ─────────────────────────────────────────────────────────────────
async function loadSettings() {
  try {
    settings = await api('/preferences');
    document.getElementById('pref-provider').value = settings.provider || 'ollama';
    document.getElementById('pref-voice').value = settings.voice_preference || 'never';
    document.getElementById('pref-system').value = settings.system_instruction || '';
    onProviderChange();
  } catch {}
}

async function saveSettings() {
  const provider = document.getElementById('pref-provider').value;
  const geminiKey = document.getElementById('pref-gemini-key').value;
  const systemInstruction = document.getElementById('pref-system').value;
  const voicePref = document.getElementById('pref-voice').value;
  const ollamaModel = document.getElementById('pref-ollama-model').value;

  const payload = { provider, system_instruction: systemInstruction, voice_preference: voicePref, ollama_model: ollamaModel };
  if (geminiKey) payload.gemini_key = geminiKey;

  try {
    await api('/preferences', { method: 'POST', body: JSON.stringify(payload) });
    settings = { ...settings, ...payload };
    toast('Settings saved', 'success');
    toggleSettings();
  } catch (e) {
    toast('Failed to save: ' + e.message, 'error');
  }
}

function onProviderChange() {
  const val = document.getElementById('pref-provider').value;
  document.getElementById('ollama-model-section').classList.toggle('visible', val === 'ollama');
  document.getElementById('gemini-key-section').classList.toggle('visible', val === 'gemini');
}

// ─── Memories ─────────────────────────────────────────────────────────────────
async function refreshMemories() {
  try {
    const data = await api('/memories');
    memories = data.memories;
    renderMemories(memories);
  } catch (e) {
    document.getElementById('memories-list').innerHTML =
      `<div style="text-align:center;color:var(--red);font-size:12px;padding:16px">${e.message}</div>`;
  }
}

function renderMemories(list) {
  const el = document.getElementById('memories-list');
  if (!list.length) {
    el.innerHTML = '<div style="text-align:center;color:var(--muted);font-size:12px;padding:20px">No memories yet. Start chatting!</div>';
    return;
  }
  el.innerHTML = list.map(m => {
    const tags = (m.tags || []).map(t => `<span class="memory-tag">#${t}</span>`).join('');
    const date = m.timestamp ? m.timestamp.slice(0, 10) : '';
    const escaped = escapeHtml(m.text.slice(0, 120));
    return `
      <div class="memory-item">
        <button class="memory-delete" onclick="deleteMemory(${m.id})" title="Delete">✕</button>
        <div class="memory-text">${escaped}</div>
        <div class="memory-meta">
          <span class="memory-time">${date}</span>
          <span class="memory-role ${m.role}">${m.role}</span>
          ${tags}
        </div>
      </div>`;
  }).join('');
}

function filterMemories(query) {
  const q = query.toLowerCase().trim();
  if (!q) { renderMemories(memories); return; }
  const filtered = memories.filter(m => {
    const textMatch = m.text.toLowerCase().includes(q);
    const tagMatch = (m.tags || []).some(t => t.toLowerCase().includes(q.replace('#', '')));
    const dateMatch = (m.timestamp || '').includes(q);
    return textMatch || tagMatch || dateMatch;
  });
  renderMemories(filtered);
}

async function deleteMemory(id) {
  try {
    await api(`/memories/${id}`, { method: 'DELETE' });
    memories = memories.filter(m => m.id !== id);
    renderMemories(memories);
    toast('Memory deleted', 'success');
  } catch (e) {
    toast('Could not delete: ' + e.message, 'error');
  }
}

// ─── Insight ──────────────────────────────────────────────────────────────────
async function generateInsight() {
  if (memories.length < 3) return;
  try {
    const provider = settings.provider || 'ollama';
    const body = { provider, model: settings.ollama_model || 'llama3.2' };
    if (provider === 'gemini' && settings.gemini_key) body.gemini_key = settings.gemini_key;
    const data = await api('/insight', { method: 'POST', body: JSON.stringify(body) });
    if (data.insight) {
      document.getElementById('insight-text').textContent = data.insight;
      document.getElementById('insight-card').classList.add('visible');
    }
  } catch {}
}

// ─── Chat ──────────────────────────────────────────────────────────────────────
async function sendMessage() {
  const input = document.getElementById('msg-input');
  if (!input) return;
  const text = input.value.trim();
  if (!text) return;

  input.value = '';
  input.style.height = '';
  const sendBtn = document.getElementById('send-btn');
  if (sendBtn) sendBtn.disabled = true;

  // Remove empty state (all instances)
  document.querySelectorAll('#empty-state, .empty-state').forEach(el => el.remove());

  appendMessage('user', text);

  // Show typing indicator
  const typingId = 'typing-' + Date.now();
  appendTyping(typingId);

  // If offline, queue
  if (!navigator.onLine) {
    offlineQueue.push({ text, ts: Date.now() });
    localStorage.setItem('q_offline_queue', JSON.stringify(offlineQueue));
    removeEl(typingId);
    toast('Queued — will send when online', 'info');
    document.getElementById('send-btn').disabled = false;
    return;
  }

  try {
    const provider = settings.provider || 'ollama';
    const body = {
      message: text,
      provider,
      model: settings.ollama_model || 'llama3.2',
    };
    if (provider === 'gemini') body.gemini_key = settings.gemini_key || '';

    const data = await api('/chat', { method: 'POST', body: JSON.stringify(body) });
    removeEl(typingId);
    appendMessage('assistant', data.response, data.tags);

    // TTS if preference is always
    if (settings.voice_preference === 'always' && data.response) {
      speak(data.response);
    }

    // Refresh memories in background
    refreshMemories();
  } catch (e) {
    removeEl(typingId);
    appendMessage('assistant', `⚠️ Error: ${e.message}`);
  }

  const sb = document.getElementById('send-btn');
  if (sb) sb.disabled = false;
}

function appendMessage(role, text, tags = []) {
  const container = document.getElementById('messages');
  const div = document.createElement('div');
  div.className = `message ${role}`;

  const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const tagsHtml = (tags || []).map(t => `<span class="msg-tag">#${t}</span>`).join('');
  div.innerHTML = `
    <div class="msg-avatar">${role === 'user' ? (currentUser?.email?.[0]?.toUpperCase() || 'U') : '🧠'}</div>
    <div class="msg-content">
      <div class="msg-bubble">${escapeHtml(text)}</div>
      <div class="msg-meta">
        <span>${timeStr}</span>
        <div class="msg-tags">${tagsHtml}</div>
        ${role === 'assistant' ? '<button class="msg-speak-btn speak-btn" title="Read aloud">🔊</button>' : ''}
      </div>
    </div>`;

  if (role === 'assistant') {
    const btn = div.querySelector('.speak-btn');
    if (btn) btn.addEventListener('click', () => speak(text));
  }

  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
}

function appendTyping(id) {
  const container = document.getElementById('messages');
  const div = document.createElement('div');
  div.className = 'message assistant';
  div.id = id;
  div.innerHTML = `
    <div class="msg-avatar">🧠</div>
    <div class="msg-content">
      <div class="typing-indicator">
        <div class="typing-dot"></div>
        <div class="typing-dot"></div>
        <div class="typing-dot"></div>
      </div>
    </div>`;
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
}

function removeEl(id) {
  document.getElementById(id)?.remove();
}

// ─── Voice ────────────────────────────────────────────────────────────────────
function setupSpeechRecognition() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) { const mb = document.getElementById('mic-btn'); if (mb) mb.style.display = 'none'; return; }
  speechRecognition = new SR();
  speechRecognition.continuous = false;
  speechRecognition.interimResults = false;
  speechRecognition.onresult = (e) => {
    const transcript = e.results[0][0].transcript;
    document.getElementById('msg-input').value += transcript;
    autoResizeTextarea(document.getElementById('msg-input'));
  };
  speechRecognition.onend = () => {
    isRecording = false;
    document.getElementById('mic-btn').classList.remove('recording');
  };
  speechRecognition.onerror = () => {
    isRecording = false;
    document.getElementById('mic-btn').classList.remove('recording');
    toast('Microphone error', 'error');
  };
}

function toggleMic() {
  if (!speechRecognition) { toast('Speech recognition not supported in this browser', 'error'); return; }
  if (isRecording) {
    speechRecognition.stop();
    isRecording = false;
    document.getElementById('mic-btn').classList.remove('recording');
  } else {
    speechRecognition.start();
    isRecording = true;
    document.getElementById('mic-btn').classList.add('recording');
    toast('Listening…', 'info');
  }
}

function speak(text) {
  if (!window.speechSynthesis) return;
  window.speechSynthesis.cancel();
  const utt = new SpeechSynthesisUtterance(text);
  window.speechSynthesis.speak(utt);
}

// ─── Export ────────────────────────────────────────────────────────────────────
async function exportData() {
  try {
    const res = await fetch('/export', {
      headers: { 'Authorization': `Bearer ${token}` },
    });
    if (!res.ok) throw new Error('Export failed');
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'quantio_export.json';
    a.click();
    URL.revokeObjectURL(url);
    toast('Export downloaded', 'success');
  } catch (e) {
    toast('Export failed: ' + e.message, 'error');
  }
}

// ─── UI helpers ───────────────────────────────────────────────────────────────
function toggleSidebar() {
  document.getElementById('sidebar').classList.toggle('open');
  document.getElementById('sidebar-overlay').classList.toggle('visible');
}

function closeSidebar() {
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('sidebar-overlay').classList.remove('visible');
}

function toggleSettings() {
  document.getElementById('settings-panel').classList.toggle('open');
}

function toggleTheme() {
  isDark = !isDark;
  document.documentElement.classList.toggle('light', !isDark);
  document.getElementById('dark-toggle').classList.toggle('on', isDark);
  document.getElementById('theme-btn').textContent = isDark ? '🌙' : '☀️';
  localStorage.setItem('q_theme', isDark ? 'dark' : 'light');
}

function autoResizeTextarea(el) {
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 120) + 'px';
}

function handleInputKey(e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/\n/g, '<br>');
}

function toast(msg, type = 'info') {
  const container = document.getElementById('toast-container');
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = msg;
  container.appendChild(el);
  setTimeout(() => el.remove(), 3100);
}

// ─── Offline ──────────────────────────────────────────────────────────────────
function setupOfflineDetection() {
  const banner = document.getElementById('offline-banner');
  window.addEventListener('online',  () => { banner.classList.remove('visible'); processOfflineQueue(); });
  window.addEventListener('offline', () => banner.classList.add('visible'));
  if (!navigator.onLine) banner.classList.add('visible');
}

async function processOfflineQueue() {
  if (!navigator.onLine || !offlineQueue.length || !token) return;
  const queue = [...offlineQueue];
  offlineQueue = [];
  localStorage.setItem('q_offline_queue', '[]');
  for (const item of queue) {
    try {
      const provider = settings.provider || 'ollama';
      const body = { message: item.text, provider, model: settings.ollama_model || 'llama3.2' };
      if (provider === 'gemini') body.gemini_key = settings.gemini_key || '';
      const data = await api('/chat', { method: 'POST', body: JSON.stringify(body) });
      appendMessage('assistant', data.response);
    } catch {}
  }
  refreshMemories();
}
</script>

<!-- PWA Service Worker -->
<script>
if ('serviceWorker' in navigator) {
  const swCode = `
const CACHE = 'quantio-v1';
const PRECACHE = ['/'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(PRECACHE)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  // Don't cache API calls
  if (url.pathname.startsWith('/auth') || url.pathname.startsWith('/chat') ||
      url.pathname.startsWith('/memories') || url.pathname.startsWith('/preferences') ||
      url.pathname.startsWith('/insight') || url.pathname.startsWith('/export') ||
      url.pathname.startsWith('/ollama') || url.pathname.startsWith('/admin') ||
      url.pathname.startsWith('/me')) {
    return;
  }
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request))
  );
});
  `;
  const blob = new Blob([swCode], { type: 'application/javascript' });
  const url = URL.createObjectURL(blob);
  navigator.serviceWorker.register(url).catch(() => {});
}