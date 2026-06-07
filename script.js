const state = {
  token: localStorage.getItem("quantio_token"),
  user: null,
  preferences: {},
  queue: JSON.parse(localStorage.getItem("quantio_queue") || "[]"),
  messages: [],
  authMode: "login",
};

const elements = {
  authScreen: document.getElementById("auth-screen"),
  mainScreen: document.getElementById("main-screen"),
  authForm: document.getElementById("auth-form"),
  authSubmit: document.getElementById("auth-submit"),
  toggleAuthMode: document.getElementById("toggle-auth-mode"),
  emailInput: document.getElementById("email"),
  passwordInput: document.getElementById("password"),
  authMessage: document.getElementById("auth-message"),
  historySearch: document.getElementById("history-search"),
  historyList: document.getElementById("history-list"),
  messageList: document.getElementById("message-list"),
  messageInput: document.getElementById("message-input"),
  sendButton: document.getElementById("send-button"),
  micButton: document.getElementById("mic-button"),
  networkStatus: document.getElementById("network-status"),
  buttonLogout: document.getElementById("button-logout"),
  buttonSettings: document.getElementById("button-settings"),
  settingsDrawer: document.getElementById("settings-drawer"),
  closeSettings: document.getElementById("close-settings"),
  saveSettings: document.getElementById("save-settings"),
  syncCloud: document.getElementById("sync-cloud"),
  restoreCloud: document.getElementById("restore-cloud"),
  toggleTheme: document.getElementById("toggle-theme"),
  buttonInsight: document.getElementById("button-insight"),
  buttonExport: document.getElementById("button-export"),
  buttonNewChat: document.getElementById("button-new-chat"),
  hamburger: document.getElementById("hamburger"),
  settingApiKey: document.getElementById("setting-api-key"),
  settingStyle: document.getElementById("setting-style"),
  settingVoice: document.getElementById("setting-voice"),
  settingCloudProvider: document.getElementById("setting-cloud-provider"),
  settingCloudToken: document.getElementById("setting-cloud-token"),
  toast: document.getElementById("toast"),
};

const showToast = (message, type = "default") => {
  elements.toast.textContent = message;
  elements.toast.style.background =
    type === "error" ? "rgba(220, 38, 26, 0.9)" : "rgba(15, 25, 45, 0.95)";
  elements.toast.classList.add("show");
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(
    () => elements.toast.classList.remove("show"),
    3500,
  );
};

const apiRequest = async (path, method = "GET", body = null) => {
  const headers = { "Content-Type": "application/json" };
  if (state.token) headers.Authorization = `Bearer ${state.token}`;
  const response = await fetch(path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401) {
      clearAuth();
      throw new Error("Session expired. Please sign in again.");
    }
    throw new Error(data.detail || data.error || JSON.stringify(data));
  }
  return data;
};

const setAuthVisibility = (showMain) => {
  elements.authScreen.classList.toggle("active", !showMain);
  elements.mainScreen.classList.toggle("active", showMain);
};

const saveQueue = () =>
  localStorage.setItem("quantio_queue", JSON.stringify(state.queue));
const formatDate = (value) =>
  new Date(value).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
const escapeHTML = (text) =>
  text?.replace(
    /[&<>]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c],
  ) || "";

const renderMessages = () => {
  elements.messageList.innerHTML = "";
  [...state.messages].reverse().forEach((message) => {
    const bubble = document.createElement("div");
    bubble.className = `message-card ${message.sender}${message.pending ? " pending" : ""}`;
    bubble.innerHTML = `
      <div class="message-meta"><span>${escapeHTML(message.sender === "assistant" ? "Quantio" : "You")}</span><span>•</span><span>${formatDate(message.created_at)}</span></div>
      <div>${escapeHTML(message.content)}</div>
      ${
        message.tags
          ? `<div class="message-tags">${escapeHTML(
              message.tags
                .split(",")
                .map((t) => `#${t}`)
                .join(" "),
            )}</div>`
          : ""
      }
    `;
    elements.messageList.appendChild(bubble);
  });
  elements.messageList.scrollTop = elements.messageList.scrollHeight;
};

const renderHistory = (memories) => {
  elements.historyList.innerHTML = "";
  memories.slice(0, 25).forEach((memory) => {
    const item = document.createElement("div");
    item.className = "history-item";
    item.innerHTML = `
      <div class="history-header"><strong>${memory.sender === "user" ? "You" : "Quantio"}</strong><small>${formatDate(memory.created_at)}</small></div>
      <div>${escapeHTML(memory.content.slice(0, 100))}${memory.content.length > 100 ? "…" : ""}</div>
      <div class="memory-actions"><button class="action-button reply-btn">↩️ Reply</button><button class="action-button memory-delete">🗑 Delete</button></div>
    `;
    item.querySelector(".reply-btn").addEventListener("click", () => {
      elements.messageInput.value = memory.content;
      elements.messageInput.focus();
    });
    item
      .querySelector(".memory-delete")
      .addEventListener("click", async (e) => {
        e.stopPropagation();
        try {
          await apiRequest(`/memories/${memory.id}`, "DELETE");
          await loadHistory();
          showToast("Memory removed");
        } catch (error) {
          showToast(error.message, "error");
        }
      });
    elements.historyList.appendChild(item);
  });
};

const loadPreferencesToUI = () => {
  elements.settingApiKey.value = state.preferences.gemini_api_key || "";
  let style = "normal";
  if (state.preferences.funny === "true") style = "funny";
  else if (state.preferences.short_answers === "true") style = "short";
  elements.settingStyle.value = style;
  elements.settingVoice.value = state.preferences.voice || "auto";
  elements.settingCloudProvider.value =
    state.preferences.cloud_provider || "google";
  elements.settingCloudToken.value = state.preferences.cloud_access_token || "";
  document.documentElement.classList.toggle(
    "dark",
    state.preferences.theme === "dark",
  );
  if (state.preferences.theme === "light")
    document.documentElement.classList.add("light");
  else document.documentElement.classList.remove("light");
};

const loadHistory = async (search = "") => {
  try {
    const memories = await apiRequest(
      `/memories${search ? "?search=" + encodeURIComponent(search) : ""}`,
    );
    state.messages = memories.map((item) => ({ ...item, pending: false }));
    renderMessages();
    renderHistory(memories);
  } catch (error) {
    showToast(error.message, "error");
  }
};

const queueMessage = (message) => {
  const queuedItem = {
    id: Date.now(),
    message,
    created_at: new Date().toISOString(),
  };
  state.queue.push(queuedItem);
  saveQueue();
  state.messages.push({
    sender: "user",
    content: message,
    tags: "",
    created_at: queuedItem.created_at,
    pending: true,
  });
  renderMessages();
  showToast("📡 Offline: message queued");
};

const sendChatMessage = async (message, queued = false) => {
  const payload = {
    message,
    api_key: elements.settingApiKey.value || undefined,
  };
  const response = await apiRequest("/chat", "POST", payload);
  if (!queued)
    state.messages.push({
      sender: "user",
      content: message,
      tags: "",
      created_at: new Date().toISOString(),
      pending: false,
    });
  state.messages.push({
    sender: "assistant",
    content: response.reply,
    tags: "",
    created_at: new Date().toISOString(),
    pending: false,
  });
  renderMessages();
  saveLastSession();
  if (
    state.preferences.voice === "always" ||
    (state.preferences.voice === "auto" &&
      !navigator.userAgent.includes("Mobile"))
  )
    speak(response.reply);
};

const sendMessage = async () => {
  const message = elements.messageInput.value.trim();
  if (!message) return;
  elements.messageInput.value = "";
  if (!navigator.onLine) return queueMessage(message);
  await sendChatMessage(message);
};

const saveLastSession = () =>
  localStorage.setItem(
    "quantio_last_messages",
    JSON.stringify(state.messages.slice(-50)),
  );
const restoreLastSession = () => {
  const cached = localStorage.getItem("quantio_last_messages");
  if (cached) {
    state.messages = JSON.parse(cached);
    renderMessages();
  }
};
const showSettings = () => elements.settingsDrawer.classList.add("open");
const hideSettings = () => elements.settingsDrawer.classList.remove("open");

const persistPreferences = async () => {
  const style = elements.settingStyle.value;
  state.preferences.short_answers = style === "short" ? "true" : "false";
  state.preferences.funny = style === "funny" ? "true" : "false";
  state.preferences.voice = elements.settingVoice.value;
  state.preferences.gemini_api_key = elements.settingApiKey.value.trim();
  state.preferences.cloud_provider = elements.settingCloudProvider.value;
  state.preferences.cloud_access_token =
    elements.settingCloudToken.value.trim();
  state.preferences.theme = document.documentElement.classList.contains("light")
    ? "light"
    : "dark";
  await apiRequest("/preferences", "POST", { preferences: state.preferences });
  localStorage.setItem("quantio_theme", state.preferences.theme);
  showToast("✅ Preferences saved");
};

const syncCloudData = async () => {
  const provider = elements.settingCloudProvider.value;
  const token = elements.settingCloudToken.value.trim();
  if (!token) return showToast("🔐 Add cloud token first", "error");
  await apiRequest("/cloud/sync", "POST", { provider, access_token: token });
  showToast("☁️ Sync completed");
};

const restoreCloudData = async () => {
  const provider = elements.settingCloudProvider.value;
  const token = elements.settingCloudToken.value.trim();
  if (!token) return showToast("Token required", "error");
  await apiRequest("/cloud/restore", "POST", { provider, access_token: token });
  await loadHistory();
  showToast("📀 Restored from cloud");
};

const toggleTheme = () => {
  const isLight = document.documentElement.classList.toggle("light");
  state.preferences.theme = isLight ? "light" : "dark";
  localStorage.setItem("quantio_theme", state.preferences.theme);
  showToast(isLight ? "☀️ Light mode" : "🌙 Dark mode");
};

const speak = (text) => {
  if (!window.speechSynthesis || state.preferences.voice === "never") return;
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = 1;
  speechSynthesis.cancel();
  speechSynthesis.speak(utterance);
};
const startSpeechRecognition = () => {
  const SpeechRecognition =
    window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) return showToast("🎤 Voice not supported", "error");
  const recognition = new SpeechRecognition();
  recognition.lang = "en-US";
  recognition.onresult = (event) => {
    elements.messageInput.value = event.results[0][0].transcript;
    elements.messageInput.focus();
  };
  recognition.onerror = () => showToast("Voice failed", "error");
  recognition.start();
};

const loadCurrentUser = async () => {
  await apiRequest("/me");
  await loadSettingsFromServer();
  await loadHistory();
  setAuthVisibility(true);
  if (!navigator.onLine) restoreLastSession();
};

const loadSettingsFromServer = async () => {
  try {
    state.preferences = await apiRequest("/preferences");
    loadPreferencesToUI();
  } catch (e) {
    console.warn(e);
  }
};
const clearAuth = () => {
  state.token = null;
  localStorage.removeItem("quantio_token");
  setAuthVisibility(false);
  state.messages = [];
};

const flushQueue = async () => {
  if (!navigator.onLine || !state.queue.length) return;
  const copy = [...state.queue];
  state.queue = [];
  saveQueue();
  for (const item of copy)
    try {
      await sendChatMessage(item.message, true);
    } catch (e) {
      state.queue.unshift(item);
      saveQueue();
      showToast("Sync failed", "error");
      break;
    }
};

const bindEvents = () => {
  elements.authForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = elements.emailInput.value.trim(),
      password = elements.passwordInput.value.trim();
    const endpoint =
      state.authMode === "signup" ? "/auth/register" : "/auth/login";
    try {
      const data = await apiRequest(endpoint, "POST", { email, password });
      state.token = data.access_token;
      localStorage.setItem("quantio_token", state.token);
      elements.authMessage.textContent = "";
      await loadCurrentUser();
    } catch (error) {
      elements.authMessage.textContent = error.message;
    }
  });
  elements.toggleAuthMode.addEventListener("click", () => {
    state.authMode = state.authMode === "login" ? "signup" : "login";
    elements.authSubmit.textContent =
      state.authMode === "login" ? "Login" : "Sign Up";
    elements.toggleAuthMode.textContent =
      state.authMode === "login" ? "Switch to Sign Up" : "Switch to Login";
  });
  elements.sendButton.addEventListener("click", sendMessage);
  elements.messageInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });
  elements.micButton.addEventListener("click", startSpeechRecognition);
  elements.buttonLogout.addEventListener("click", clearAuth);
  elements.buttonSettings.addEventListener("click", showSettings);
  elements.closeSettings.addEventListener("click", hideSettings);
  elements.saveSettings.addEventListener("click", persistPreferences);
  elements.syncCloud.addEventListener("click", syncCloudData);
  elements.restoreCloud.addEventListener("click", restoreCloudData);
  elements.toggleTheme.addEventListener("click", toggleTheme);
  elements.buttonInsight.addEventListener("click", async () => {
    try {
      const res = await apiRequest("/insight", "POST");
      showToast(res.insight);
    } catch (e) {
      showToast(e.message, "error");
    }
  });
  elements.buttonExport.addEventListener("click", async () => {
    const data = await apiRequest("/export");
    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "quantio_export.json";
    a.click();
    URL.revokeObjectURL(url);
  });
  elements.buttonNewChat.addEventListener("click", () => {
    state.messages = [];
    renderMessages();
    showToast("✨ New session started");
  });
  elements.historySearch.addEventListener("input", (e) =>
    loadHistory(e.target.value.trim()),
  );
  elements.hamburger.addEventListener("click", () =>
    document.getElementById("sidebar").classList.toggle("open"),
  );
  window.addEventListener("online", () => {
    flushQueue();
    showToast("🟢 Back online");
  });
  window.addEventListener("offline", () =>
    showToast("🔴 Offline mode — messages queued"),
  );
};

const init = async () => {
  bindEvents();
  const savedTheme = localStorage.getItem("quantio_theme");
  if (savedTheme === "light") document.documentElement.classList.add("light");
  if (state.token)
    try {
      await loadCurrentUser();
    } catch (e) {
      showToast("Session expired");
      setAuthVisibility(false);
    }
  else setAuthVisibility(false);
  restoreLastSession();
  if ("serviceWorker" in navigator)
    navigator.serviceWorker.register("/sw.js").catch(console.warn);
};
init();
