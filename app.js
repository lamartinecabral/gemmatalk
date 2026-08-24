import { Engine } from "@litert-lm/core";

// The WebGPU compatible Gemma 4 E2B weights file (Approx 1.9GB)
const MODEL_URL =
  "https://huggingface.co/litert-community/gemma-4-E2B-it-litert-lm/resolve/main/gemma-4-E2B-it-web.litertlm";

const messagesContainer = document.getElementById("messages");
const inputField = document.getElementById("userInput");
const sendButton = document.getElementById("sendBtn");
const progressContainer = document.getElementById("progress-container");
const progressBar = document.getElementById("progress-bar");
const progressText = document.getElementById("progress-text");

// Turn the lightweight Lucide placeholders into consistent SVG icons.
window.lucide?.createIcons();

// Listen for progress messages from the Service Worker
navigator.serviceWorker.addEventListener("message", (event) => {
  if (event.data && event.data.type === "DOWNLOAD_PROGRESS") {
    const { loaded, total } = event.data;
    const percent = Math.min(Math.round((loaded / total) * 100), 100);

    // Show the bar if we are downloading
    if (progressContainer.classList.contains("hidden") && percent < 100) {
      progressContainer.classList.remove("hidden");
    }

    progressBar.style.width = `${percent}%`;
    progressText.innerText = `${percent}% (${(loaded / 1024 / 1024).toFixed(1)} MB / ${(total / 1024 / 1024).toFixed(1)} MB)`;

    // Hide it once fully downloaded
    if (percent >= 100) {
      setTimeout(() => {
        progressContainer.classList.add("hidden");
      }, 1000);
    }
  }
});

let chatSession;

// 1. Register the Service Worker & wait for it to take over
async function setupServiceWorker() {
  if ("serviceWorker" in navigator) {
    await navigator.serviceWorker.register("service-worker.js");

    // Pause execution until the service worker explicitly controls network requests
    // This prevents the 1.9GB fetch from bypassing the cache layer on the very first visit.
    if (!navigator.serviceWorker.controller) {
      await new Promise((resolve) => {
        navigator.serviceWorker.addEventListener("controllerchange", resolve);
      });
    }
    console.log("Service Worker is active and controlling requests.");
  }
}

// 2. Initialize the LiteRT-LM Engine
async function initAI() {
  appendMessage(
    "System",
    "Initializing WebGPU and checking cache for Gemma 4 E2B... (Downloading 1.9GB if not cached).",
  );

  try {
    const engine = await Engine.create({ model: MODEL_URL });
    chatSession = await engine.createConversation({
      preface: {
        messages: [
          {
            role: "system",
            content: "You are a conversational bot.",
          },
        ],
      },
    });

    appendMessage(
      "System",
      "Model loaded successfully into WebGPU! Ready to chat.",
    );
    inputField.disabled = false;
    sendButton.disabled = false;
    inputField.focus();
  } catch (err) {
    appendMessage("System", `Failed to load model: ${err.message}`);
    console.error(err);
  }
}

// 3. Handle Chat Interactions
function appendMessage(sender, text) {
  document.getElementById("welcome")?.remove();

  const msgDiv = document.createElement("div");
  const isUser = sender === "You";
  const isSystem = sender === "System";
  msgDiv.className = isSystem
    ? "message mx-auto max-w-xl py-2 text-center text-xs italic text-slate-500"
    : `message flex max-w-[88%] flex-col gap-1.5 rounded-2xl px-4 py-3 text-sm leading-6 shadow-sm ${isUser ? "ml-auto bg-indigo-500 text-white" : "mr-auto border border-line bg-slate-900/80 text-slate-200"}`;

  if (isSystem) {
    msgDiv.textContent = text;
  } else {
    msgDiv.innerHTML = `<div class="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider ${isUser ? "text-indigo-100" : "text-indigo-300"}"><span class="grid h-5 w-5 place-items-center rounded-md ${isUser ? "bg-white/15" : "bg-indigo-500/15"}"><i data-lucide="${isUser ? "user-round" : "sparkles"}" class="h-3 w-3"></i></span>${sender}</div><span class="content"></span>`;
    msgDiv.querySelector(".content").innerText = text;
  }
  messagesContainer.appendChild(msgDiv);
  // The message must be in the document before Lucide replaces its placeholder.
  window.lucide?.createIcons();
  messagesContainer.scrollTop = messagesContainer.scrollHeight;
  return msgDiv.querySelector(".content") || msgDiv;
}

async function handleSend() {
  const text = inputField.value.trim();
  if (!text) return;

  inputField.value = "";
  inputField.disabled = true;
  sendButton.disabled = true;

  appendMessage("You", text);
  const aiResponseNode = appendMessage("AI", "");

  try {
    // Stream response chunks from the local model back to the DOM
    for await (const chunk of chatSession.sendMessageStreaming(text)) {
      aiResponseNode.innerText += chunk.content[0].text;
      messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }
  } catch (err) {
    aiResponseNode.innerText += `\n\n[Error: ${err.message}]`;
  } finally {
    inputField.disabled = false;
    sendButton.disabled = false;
    inputField.focus();
  }
}

// Bind event listeners
sendButton.addEventListener("click", handleSend);
inputField.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    handleSend();
  }
});

// Boot the application
await setupServiceWorker();
await initAI();
