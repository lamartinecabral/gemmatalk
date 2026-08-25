// @ts-check
import { Engine } from "@litert-lm/core";
import { lucideCreateIcons, getElem } from "./utils.js";

// The WebGPU compatible Gemma 4 E2B weights file (Approx 1.9GB)
const MODEL_URL =
  "https://huggingface.co/litert-community/gemma-4-E2B-it-litert-lm/resolve/main/gemma-4-E2B-it-web.litertlm";

const messagesContainer = document.getElementById("messages");
const inputField = getElem("textarea", "userInput");
const sendButton = getElem("button", "sendBtn");
const clearButton = getElem("button", "clearBtn");
const progressContainer = document.getElementById("progress-container");
const progressBar = document.getElementById("progress-bar");
const progressText = document.getElementById("progress-text");

// Turn the lightweight Lucide placeholders into consistent SVG icons.
lucideCreateIcons();

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

/** @type {Engine} */
let aiEngine;
/** @type {import('@litert-lm/core').Conversation} */
let chatSession;
let isGenerating = false;

/** @type {import('@litert-lm/core').FunctionTool} */
const javascriptTool = {
  type: "function",
  function: {
    name: "run_javascript",
    description: "Use this tool to run javascript snippets in a Web Worker.",
    parameters: {
      type: "object",
      properties: {
        code: {
          type: "string",
          description: "JavaScript source to execute.",
        },
      },
      required: ["code"],
    },
  },
};

/** @type {Worker} */
let javascriptWorker;
let nextJavascriptRequestId = 0;
const javascriptRequests = new Map();

function createJavascriptWorker() {
  javascriptWorker = new Worker("javascript-runner.js");
  javascriptWorker.addEventListener("message", ({ data }) => {
    const request = javascriptRequests.get(data.id);
    if (!request) return;
    javascriptRequests.delete(data.id);
    clearTimeout(request.timeout);
    data.ok
      ? request.resolve(data.value)
      : request.reject(new Error(data.error));
  });
  javascriptWorker.addEventListener("error", (error) => {
    for (const request of javascriptRequests.values()) {
      clearTimeout(request.timeout);
      request.reject(new Error(error.message || "JavaScript worker failed."));
    }
    javascriptRequests.clear();
    javascriptWorker.terminate();
    createJavascriptWorker();
  });
}

createJavascriptWorker();

function runJavascript(code = "") {
  console.log({ code });
  return new Promise((resolve, reject) => {
    const id = ++nextJavascriptRequestId;
    const timeout = setTimeout(() => {
      javascriptRequests.delete(id);
      javascriptWorker.terminate();
      createJavascriptWorker();
      reject(new Error("JavaScript execution timed out after 5 seconds."));
    }, 5000);

    javascriptRequests.set(id, { resolve, reject, timeout });
    javascriptWorker.postMessage({ id, code });
  });
}

async function executeTool(toolCall) {
  const name = toolCall?.function?.name;
  let argumentsObject = toolCall?.function?.arguments || {};
  if (typeof argumentsObject === "string") {
    argumentsObject = JSON.parse(argumentsObject);
  }

  if (name !== javascriptTool.function.name) {
    throw new Error(`Unknown tool: ${name || "(missing name)"}`);
  }
  if (typeof argumentsObject.code !== "string") {
    throw new Error("run_javascript requires a string 'code' argument.");
  }

  return runJavascript(argumentsObject.code);
}

async function streamModelMessage(message, responseNode) {
  const getResponseNode = () => {
    if (typeof responseNode === "function") return responseNode();
    return responseNode;
  };
  /** @type {import('@litert-lm/core').ToolCall[]} */
  let toolCalls = [];
  for await (const chunk of chatSession.sendMessageStreaming(message)) {
    if (chunk.tool_calls) toolCalls = chunk.tool_calls;
    for (const content of chunk.content || []) {
      if (content["type"] === "text") {
        getResponseNode().innerText += String(content["text"]);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
      }
    }
  }
  return toolCalls;
}

// 1. Register the Service Worker & wait for it to take over
async function setupServiceWorker() {
  if ("serviceWorker" in navigator) {
    await navigator.serviceWorker.register("service-worker.js");
    await navigator.serviceWorker.ready;

    // Hard reloads prevent the service from taking control. A normal reload fixes it.
    if (!navigator.serviceWorker.controller) location.reload();

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
    aiEngine = await Engine.create({ model: MODEL_URL });
    chatSession = await createChatSession();
    chatSession.delete;

    appendMessage(
      "System",
      "Model loaded successfully into WebGPU! Ready to chat.",
    );
    inputField.disabled = false;
    sendButton.disabled = false;
    clearButton.disabled = false;
    inputField.focus();
  } catch (err) {
    appendMessage("System", `Failed to load model: ${err.message}`);
    console.error(err);
  }
}

async function createChatSession() {
  return aiEngine.createConversation({
    preface: {
      messages: [
        {
          role: "system",
          content:
            "You are a conversational bot running in a user browser. You can get real time details about the environment by running javascript snippets.",
        },
      ],
      tools: [javascriptTool],
    },
  });
}

function clearDisplayedMessages() {
  messagesContainer.replaceChildren();
  const welcome = document.createElement("div");
  welcome.id = "welcome";
  welcome.className =
    "flex h-full min-h-64 flex-col items-center justify-center text-center";
  welcome.innerHTML = `<div class="mb-4 grid h-14 w-14 place-items-center rounded-2xl border border-indigo-400/20 bg-indigo-500/10 text-indigo-300"><i data-lucide="message-circle" aria-hidden="true" class="h-7 w-7"></i></div><h3 class="text-base font-medium">Your private conversation starts here</h3><p class="mt-2 max-w-sm text-sm leading-6 text-slate-400">Ask anything. The model is downloaded once and then runs entirely on your device.</p>`;
  messagesContainer.appendChild(welcome);
  lucideCreateIcons();
}

async function clearConversation() {
  if (!chatSession || isGenerating) return;
  if (!window.confirm("Clear this conversation history?")) return;

  clearButton.disabled = true;
  inputField.disabled = true;
  sendButton.disabled = true;
  try {
    chatSession = await createChatSession();
    clearDisplayedMessages();
  } catch (error) {
    appendMessage("System", `Failed to clear conversation: ${error.message}`);
  } finally {
    clearButton.disabled = false;
    inputField.disabled = false;
    sendButton.disabled = false;
    inputField.focus();
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
    msgDiv.querySelector(".content")["innerText"] = text;
  }
  messagesContainer.appendChild(msgDiv);
  // The message must be in the document before Lucide replaces its placeholder.
  lucideCreateIcons();
  messagesContainer.scrollTop = messagesContainer.scrollHeight;
  return msgDiv.querySelector(".content") || msgDiv;
}

function resizeInput() {
  // Let the composer grow with multi-line messages without taking over the chat.
  inputField.style.height = "auto";
  inputField.style.height = `${Math.min(inputField.scrollHeight, 160)}px`;
}

async function handleSend() {
  const text = inputField.value.trim();
  if (!text) return;

  inputField.value = "";
  resizeInput();
  inputField.disabled = true;
  sendButton.disabled = true;
  clearButton.disabled = true;
  isGenerating = true;

  appendMessage("You", text);
  let aiResponseNode;
  const getAiResponseNode = () => {
    if (aiResponseNode) return aiResponseNode;
    return (aiResponseNode = appendMessage("AI", ""));
  };

  try {
    /** @type {import('@litert-lm/core').MessageLike} */
    let message = text;
    for (let round = 0; round < 5; round += 1) {
      const toolCalls = await streamModelMessage(message, getAiResponseNode);
      if (!toolCalls.length) break;

      /** @type {import('@litert-lm/core').ToolResponsePart[]} */
      const toolResults = [];
      for (const toolCall of toolCalls) {
        appendMessage("System", `Running ${toolCall.function.name}…`);
        try {
          const result = await executeTool(toolCall);
          console.log({ result });
          toolResults.push({
            type: "tool_response",
            name: toolCall.function.name,
            response: { ok: true, result },
          });
        } catch (error) {
          console.log({ error });
          toolResults.push({
            type: "tool_response",
            name: toolCall.function.name,
            response: { ok: false, error: error.message },
          });
        }
      }

      message = { role: "tool", content: toolResults };
    }
  } catch (err) {
    getAiResponseNode().innerText += `\n\n[Error: ${err.message}]`;
  } finally {
    isGenerating = false;
    inputField.disabled = false;
    sendButton.disabled = false;
    clearButton.disabled = false;
    inputField.focus();
  }
}

// Bind event listeners
clearButton.addEventListener("click", clearConversation);
sendButton.addEventListener("click", handleSend);
inputField.addEventListener("input", resizeInput);
inputField.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    handleSend();
  }
});

// Boot the application
resizeInput();
await setupServiceWorker();
await initAI();
