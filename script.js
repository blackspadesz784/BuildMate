/* ============================================================================
   BuildMate — script.js
   Handles: chat state, API communication (fetch/async-await), markdown +
   syntax highlighting rendering, sidebar/history management, animations,
   and all DOM interactions.
   ============================================================================ */

(() => {
  "use strict";

  // --------------------------------------------------------------------------
  // CONFIG & API BASE URL RESOLUTION
  // Explicit: points to Render backend unless served directly by Flask (onrender.com or port 5000)
  // --------------------------------------------------------------------------
  const RENDER_BACKEND_URL = "https://buildmate-vz8z.onrender.com";

  function getApiBaseUrl() {
    const origin = window.location.origin || "";
    const isFlaskOrigin = origin.includes("onrender.com") || origin.includes("5000");
    return isFlaskOrigin ? origin : RENDER_BACKEND_URL;
  }

  const API_BASE_URL = getApiBaseUrl();

  // --------------------------------------------------------------------------
  // DOM REFERENCES
  // --------------------------------------------------------------------------
  const sidebar = document.getElementById("sidebar");
  const sidebarOverlay = document.getElementById("sidebarOverlay");
  const sidebarOpenBtn = document.getElementById("sidebarOpenBtn");
  const sidebarCloseBtn = document.getElementById("sidebarCloseBtn");
  const newChatBtn = document.getElementById("newChatBtn");
  const clearChatBtn = document.getElementById("clearChatBtn");
  const conversationList = document.getElementById("conversationList");

  const chatScrollArea = document.getElementById("chatScrollArea");
  const heroSection = document.getElementById("heroSection");
  const heroCards = document.getElementById("heroCards");
  const chatLog = document.getElementById("chatLog");
  const typingIndicator = document.getElementById("typingIndicator");

  const messageInput = document.getElementById("messageInput");
  const sendBtn = document.getElementById("sendBtn");
  const toast = document.getElementById("toast");
  const typedLineEl = document.getElementById("typedLine");

  // --------------------------------------------------------------------------
  // STATE
  // --------------------------------------------------------------------------
  let conversations = {};
  let currentSessionId = null;
  let isWaitingForResponse = false;

  const STORAGE_KEY = "buildmate_conversations_v1";
  const ACTIVE_KEY = "buildmate_active_session_v1";

  // --------------------------------------------------------------------------
  // INIT
  // --------------------------------------------------------------------------
  document.addEventListener("DOMContentLoaded", init);

  function init() {
    configureMarked();
    loadConversationsFromStorage();

    if (!currentSessionId || !conversations[currentSessionId]) {
      startNewLocalSession();
    } else {
      renderConversationList();
      renderMessagesForSession(currentSessionId);
    }

    playHeroTypingAnimation();
    bindEvents();
    autoResizeTextarea();
  }

  function configureMarked() {
    if (window.marked) {
      marked.setOptions({
        breaks: true,
        gfm: true,
      });
    }
  }

  // --------------------------------------------------------------------------
  // EVENT BINDING
  // --------------------------------------------------------------------------
  function bindEvents() {
    sidebarOpenBtn.addEventListener("click", openSidebar);
    sidebarCloseBtn.addEventListener("click", closeSidebar);
    sidebarOverlay.addEventListener("click", closeSidebar);

    newChatBtn.addEventListener("click", handleNewChat);
    clearChatBtn.addEventListener("click", handleClearChat);

    sendBtn.addEventListener("click", handleSendMessage);

    messageInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSendMessage();
      }
    });
    messageInput.addEventListener("input", autoResizeTextarea);

    heroCards.addEventListener("click", (e) => {
      const card = e.target.closest(".hero-card");
      if (!card) return;
      const prompt = card.getAttribute("data-prompt");
      messageInput.value = prompt;
      autoResizeTextarea();
      handleSendMessage();
    });

    // Event delegation for copy buttons inside dynamically rendered messages
    chatLog.addEventListener("click", (e) => {
      const copyCodeBtn = e.target.closest(".copy-code-btn");
      if (copyCodeBtn) {
        handleCopyCode(copyCodeBtn);
        return;
      }
      const copyResponseBtn = e.target.closest(".copy-response-btn");
      if (copyResponseBtn) {
        handleCopyResponse(copyResponseBtn);
      }
    });
  }

  // --------------------------------------------------------------------------
  // SIDEBAR CONTROLS
  // --------------------------------------------------------------------------
  function openSidebar() {
    sidebar.classList.add("open");
    sidebarOverlay.classList.add("show");
  }
  function closeSidebar() {
    sidebar.classList.remove("open");
    sidebarOverlay.classList.remove("show");
  }

  // --------------------------------------------------------------------------
  // HERO TERMINAL TYPING ANIMATION
  // --------------------------------------------------------------------------
  function playHeroTypingAnimation() {
    const text = "npx buildmate --start";
    let i = 0;
    const interval = setInterval(() => {
      typedLineEl.textContent = text.slice(0, i + 1);
      i++;
      if (i >= text.length) clearInterval(interval);
    }, 38);
  }

  // --------------------------------------------------------------------------
  // SESSION / CONVERSATION MANAGEMENT
  // --------------------------------------------------------------------------
  function generateLocalId() {
    return "bm-sess-" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  }

  function startNewLocalSession() {
    const id = generateLocalId();
    conversations[id] = { id, title: "New Chat", messages: [] };
    currentSessionId = id;
    persistConversations();
    renderConversationList();
    showHero();
    chatLog.innerHTML = "";
  }

  async function handleNewChat() {
    try {
      const res = await fetch(`${API_BASE_URL}/new-chat`, { method: "POST" });
      if (res.ok) {
        const data = await res.json();
        const id = data.session_id;
        conversations[id] = { id, title: "New Chat", messages: [] };
        currentSessionId = id;
      } else {
        startNewLocalSession();
        return;
      }
    } catch (err) {
      console.warn("Backend unavailable, starting a local-only session.", err);
      startNewLocalSession();
      return;
    }

    persistConversations();
    renderConversationList();
    showHero();
    chatLog.innerHTML = "";
    closeSidebar();
    messageInput.focus();
  }

  async function handleClearChat() {
    if (!currentSessionId) return;
    if (!conversations[currentSessionId] || conversations[currentSessionId].messages.length === 0) {
      showToast("Chat is already empty.");
      return;
    }

    const confirmed = window.confirm("Clear all messages in this conversation? This cannot be undone.");
    if (!confirmed) return;

    try {
      await fetch(`${API_BASE_URL}/clear`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: currentSessionId }),
      });
    } catch (err) {
      console.warn("Could not reach backend to clear server-side history.", err);
    }

    conversations[currentSessionId].messages = [];
    conversations[currentSessionId].title = "New Chat";
    persistConversations();
    renderConversationList();
    chatLog.innerHTML = "";
    showHero();
    showToast("Conversation cleared.");
  }

  function switchToSession(id) {
    if (!conversations[id]) return;
    currentSessionId = id;
    persistConversations();
    renderConversationList();
    renderMessagesForSession(id);
    closeSidebar();
  }

  function renderConversationList() {
    const ids = Object.keys(conversations);
    conversationList.innerHTML = "";

    if (ids.length === 0) {
      conversationList.innerHTML = `<div class="empty-history-note">No conversations yet. Start a new chat to begin.</div>`;
      return;
    }

    const sorted = ids.sort((a, b) => {
      const aTime = lastMessageTime(conversations[a]);
      const bTime = lastMessageTime(conversations[b]);
      return bTime - aTime;
    });

    sorted.forEach((id) => {
      const convo = conversations[id];
      const item = document.createElement("button");
      item.className = "conversation-item" + (id === currentSessionId ? " active" : "");
      item.innerHTML = `<span class="conv-icon">#</span><span>${escapeHtml(convo.title || "New Chat")}</span>`;
      item.addEventListener("click", () => switchToSession(id));
      conversationList.appendChild(item);
    });
  }

  function lastMessageTime(convo) {
    if (!convo.messages || convo.messages.length === 0) return 0;
    return convo.messages[convo.messages.length - 1].timestamp || 0;
  }

  function renderMessagesForSession(id) {
    const convo = conversations[id];
    chatLog.innerHTML = "";

    if (!convo || convo.messages.length === 0) {
      showHero();
      return;
    }

    hideHero();
    convo.messages.forEach((msg) => {
      appendMessageBubble(msg.role, msg.text, msg.timestamp, false);
    });
    scrollToBottom(false);
  }

  function persistConversations() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(conversations));
      localStorage.setItem(ACTIVE_KEY, currentSessionId);
    } catch (err) {
      console.warn("Could not persist conversations to localStorage.", err);
    }
  }

  function loadConversationsFromStorage() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const activeId = localStorage.getItem(ACTIVE_KEY);
      if (raw) {
        conversations = JSON.parse(raw);
        if (activeId && conversations[activeId]) {
          currentSessionId = activeId;
        }
      }
    } catch (err) {
      console.warn("Could not load conversations from localStorage.", err);
      conversations = {};
    }
  }

  // --------------------------------------------------------------------------
  // HERO VISIBILITY
  // --------------------------------------------------------------------------
  function showHero() {
    heroSection.style.display = "block";
  }
  function hideHero() {
    heroSection.style.display = "none";
  }

  // --------------------------------------------------------------------------
  // SENDING MESSAGES
  // --------------------------------------------------------------------------
  async function handleSendMessage() {
    const text = messageInput.value.trim();
    if (!text || isWaitingForResponse) return;

    if (!currentSessionId) startNewLocalSession();

    hideHero();

    const timestamp = Date.now();
    appendMessageBubble("user", text, timestamp, true);
    saveMessageToSession("user", text, timestamp);
    updateConversationTitle(text);

    messageInput.value = "";
    autoResizeTextarea();

    showTypingIndicator();
    isWaitingForResponse = true;
    sendBtn.disabled = true;

    try {
      const reply = await sendMessageToBackend(text, currentSessionId);
      hideTypingIndicator();
      const replyTimestamp = Date.now();
      appendMessageBubble("ai", reply, replyTimestamp, true);
      saveMessageToSession("ai", reply, replyTimestamp);
    } catch (err) {
      hideTypingIndicator();
      const errorMessage = buildErrorMessage(err);
      appendMessageBubble("ai", errorMessage, Date.now(), true, true);
    } finally {
      isWaitingForResponse = false;
      sendBtn.disabled = false;
      messageInput.focus();
    }
  }

  async function sendMessageToBackend(message, sessionId) {
    const response = await fetch(`${API_BASE_URL}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, session_id: sessionId }),
    });

    let payload = null;
    try {
      payload = await response.json();
    } catch (_e) {
      payload = null;
    }

    if (!response.ok) {
      const message = (payload && payload.error) || `Request failed with status ${response.status}`;
      const error = new Error(message);
      error.status = response.status;
      throw error;
    }

    if (!payload || (typeof payload.reply !== "string" && typeof payload.prediction !== "string")) {
      throw new Error("Received an unexpected response format from BuildMate server.");
    }

    return payload.reply || payload.prediction;
  }

  function buildErrorMessage(err) {
    if (err && err.status === 429) {
      return `⚠️ **Rate limit reached.** ${err.message} Please wait a moment before sending another message.`;
    }
    if (err && err.message && err.message.includes("Failed to fetch")) {
      return `⚠️ **Could not reach BuildMate API.** Make sure the Flask server is running at \`${API_BASE_URL}\` and try again.`;
    }
    return `⚠️ **Something went wrong.** ${err && err.message ? err.message : "Please try again."}`;
  }

  function saveMessageToSession(role, text, timestamp) {
    if (!conversations[currentSessionId]) {
      conversations[currentSessionId] = { id: currentSessionId, title: "New Chat", messages: [] };
    }
    conversations[currentSessionId].messages.push({ role, text, timestamp });
    persistConversations();
    renderConversationList();
  }

  function updateConversationTitle(firstUserMessage) {
    const convo = conversations[currentSessionId];
    if (!convo) return;
    if (convo.title === "New Chat" || !convo.title) {
      convo.title = firstUserMessage.length > 42
        ? firstUserMessage.slice(0, 42).trim() + "…"
        : firstUserMessage;
      persistConversations();
      renderConversationList();
    }
  }

  // --------------------------------------------------------------------------
  // RENDERING MESSAGE BUBBLES
  // --------------------------------------------------------------------------
  function appendMessageBubble(role, text, timestamp, animate, isError = false) {
    const row = document.createElement("div");
    row.className = `message-row ${role === "user" ? "user" : "ai"}`;

    const avatar = document.createElement("div");
    avatar.className = `avatar ${role === "user" ? "avatar-user" : "avatar-ai"}`;
    avatar.textContent = role === "user" ? "You" : "BM";

    const col = document.createElement("div");
    col.className = "message-col";

    const bubble = document.createElement("div");
    bubble.className = "message-bubble";
    if (isError) bubble.style.borderColor = "rgba(248,113,113,0.4)";
    bubble.innerHTML = renderMarkdown(text);

    const meta = document.createElement("div");
    meta.className = "message-meta";
    const timeSpan = document.createElement("span");
    timeSpan.textContent = formatTimestamp(timestamp);
    meta.appendChild(timeSpan);

    if (role === "ai" && !isError) {
      const copyBtn = document.createElement("button");
      copyBtn.className = "copy-response-btn";
      copyBtn.setAttribute("data-raw-text", text);
      copyBtn.innerHTML = "📋 Copy";
      meta.appendChild(copyBtn);
    }

    col.appendChild(bubble);
    col.appendChild(meta);
    row.appendChild(avatar);
    row.appendChild(col);

    if (!animate) row.style.animation = "none";

    chatLog.appendChild(row);
    enhanceCodeBlocks(bubble);
    scrollToBottom(animate);
  }

  function renderMarkdown(text) {
    if (window.marked) {
      try {
        return marked.parse(text);
      } catch (err) {
        console.warn("Markdown parsing failed, falling back to plain text.", err);
      }
    }
    return escapeHtml(text).replace(/\n/g, "<br>");
  }

  function enhanceCodeBlocks(container) {
    const preBlocks = container.querySelectorAll("pre");
    preBlocks.forEach((pre) => {
      const codeEl = pre.querySelector("code");
      if (!codeEl) return;

      if (window.hljs) {
        try {
          hljs.highlightElement(codeEl);
        } catch (_e) { /* ignore highlight errors */ }
      }

      let language = "code";
      const match = Array.from(codeEl.classList).find((c) => c.startsWith("language-"));
      if (match) language = match.replace("language-", "");

      const wrapper = document.createElement("div");
      wrapper.className = "code-block-wrapper";

      const header = document.createElement("div");
      header.className = "code-block-header";
      header.innerHTML = `<span>${escapeHtml(language)}</span>`;

      const copyBtn = document.createElement("button");
      copyBtn.className = "copy-code-btn";
      copyBtn.innerHTML = "📋 Copy";

      header.appendChild(copyBtn);

      pre.parentNode.insertBefore(wrapper, pre);
      wrapper.appendChild(header);
      wrapper.appendChild(pre);
    });
  }

  // --------------------------------------------------------------------------
  // COPY HANDLERS
  // --------------------------------------------------------------------------
  function handleCopyCode(button) {
    const wrapper = button.closest(".code-block-wrapper");
    const codeEl = wrapper ? wrapper.querySelector("pre code") : null;
    if (!codeEl) return;

    copyToClipboard(codeEl.innerText).then(() => {
      const original = button.innerHTML;
      button.innerHTML = "✅ Copied";
      setTimeout(() => (button.innerHTML = original), 1500);
    });
  }

  function handleCopyResponse(button) {
    const rawText = button.getAttribute("data-raw-text") || "";
    copyToClipboard(rawText).then(() => {
      showToast("Response copied to clipboard.");
    });
  }

  async function copyToClipboard(text) {
    try {
      await navigator.clipboard.writeText(text);
    } catch (err) {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
    }
  }

  // --------------------------------------------------------------------------
  // TYPING INDICATOR / LOADING
  // --------------------------------------------------------------------------
  function showTypingIndicator() {
    typingIndicator.hidden = false;
    scrollToBottom(true);
  }
  function hideTypingIndicator() {
    typingIndicator.hidden = true;
  }

  // --------------------------------------------------------------------------
  // UTILITIES
  // --------------------------------------------------------------------------
  function scrollToBottom(smooth) {
    requestAnimationFrame(() => {
      chatScrollArea.scrollTo({
        top: chatScrollArea.scrollHeight,
        behavior: smooth ? "smooth" : "auto",
      });
    });
  }

  function autoResizeTextarea() {
    messageInput.style.height = "auto";
    messageInput.style.height = Math.min(messageInput.scrollHeight, 160) + "px";
    sendBtn.disabled = messageInput.value.trim().length === 0 && !isWaitingForResponse ? false : sendBtn.disabled;
  }

  function formatTimestamp(ts) {
    if (!ts) return "";
    const date = new Date(ts);
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  let toastTimeout = null;
  function showToast(message) {
    toast.textContent = message;
    toast.classList.add("show");
    clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => toast.classList.remove("show"), 2500);
  }
})();
