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
const confirmClearModal = getElem("div", "confirmClearModal");
const confirmClearCancel = getElem("button", "confirmClearCancel");
const confirmClearAction = getElem("button", "confirmClearAction");
const clearButtonLabel = getElem("span", "clearBtnLabel");
const promptModal = getElem("div", "promptModal");
const systemPromptInput = getElem("textarea", "systemPromptInput");
const promptApply = getElem("button", "promptApply");
const promptCancel = getElem("button", "promptCancel");
const promptCancelTop = getElem("button", "promptCancelTop");
const promptReset = getElem("button", "promptReset");
const progressContainer = document.getElementById("progress-container");
const progressBar = document.getElementById("progress-bar");
const progressText = document.getElementById("progress-text");
const progressLabel = document.getElementById("progress-label");
const welcomeTemplate = getElem("template", "welcome-template");
const youMessageTemplate = getElem("template", "you-message-template");
const systemMessageTemplate = getElem("template", "system-message-template");
const aiMessageTemplate = getElem("template", "ai-message-template");
let progressHideTimer;

// Turn the lightweight Lucide placeholders into consistent SVG icons.
lucideCreateIcons();

// Listen for progress messages from the Service Worker. A cached response is
// streamed into LiteRT-LM too, so it gets its own progress state rather than
// appearing to finish instantly when the cache lookup succeeds.
navigator.serviceWorker.addEventListener("message", (event) => {
  const progress = event.data;
  if (
    !progress ||
    !["DOWNLOAD_PROGRESS", "CACHE_LOAD_PROGRESS"].includes(progress.type)
  ) {
    return;
  }

  const { loaded, total, type } = progress;
  const percent = Math.min(Math.round((loaded / total) * 100), 100);
  progressLabel.lastChild.textContent =
    type === "CACHE_LOAD_PROGRESS"
      ? " Loading model from cache…"
      : " Downloading model for offline use…";

  clearTimeout(progressHideTimer);
  progressContainer.classList.remove("hidden");
  progressBar.style.width = `${percent}%`;
  progressText.innerText = `${percent}% (${(loaded / 1024 / 1024).toFixed(1)} MB / ${(total / 1024 / 1024).toFixed(1)} MB)`;

  if (percent >= 100) {
    progressHideTimer = setTimeout(() => {
      progressContainer.classList.add("hidden");
    }, 800);
  }
});

/** @type {Engine} */
let aiEngine;
/** @type {import('@litert-lm/core').Conversation} */
let chatSession;
let isGenerating = false;
let hasConversationHistory = false;

const DEFAULT_SYSTEM_PROMPT =
  "You are a conversational bot running in a user browser. You can get real time details about the environment by running javascript snippets.";
const SYSTEM_PROMPT_STORAGE_KEY = "gemmatalk.systemPrompt";

function getSystemPrompt() {
  const savedPrompt = localStorage.getItem(SYSTEM_PROMPT_STORAGE_KEY);
  return savedPrompt?.trim() ? savedPrompt : DEFAULT_SYSTEM_PROMPT;
}

function updateConversationButton() {
  const hasHistory = hasConversationHistory;
  clearButtonLabel.textContent = hasHistory ? "Clear" : "System";
  clearButton
    .querySelector("[data-lucide]")
    ?.setAttribute(
      "data-lucide",
      hasHistory ? "trash-2" : "sliders-horizontal",
    );
  clearButton.setAttribute(
    "aria-label",
    hasHistory ? "Clear conversation history" : "Change system prompt",
  );
  clearButton.setAttribute(
    "title",
    hasHistory ? "Clear conversation history" : "Change system prompt",
  );
  lucideCreateIcons();
}

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
  javascriptWorker = new Worker("./app/javascript-runner.js");
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

function isAtBottom(container) {
  // Allow for fractional scroll positions and small rounding differences.
  return (
    container.scrollHeight - container.clientHeight - container.scrollTop <= 1
  );
}

function updateGenerationSpeed(responseNode, stats) {
  const speedNode =
    responseNode.parentElement.querySelector(".generation-speed");
  if (!speedNode || !stats.tokens) return;

  const wasAtBottom = isAtBottom(messagesContainer);
  const tokensPerSecond = stats.tokens / stats.seconds;
  speedNode.textContent = `${tokensPerSecond.toFixed(1)} tokens/s · ${stats.tokens} tokens`;
  speedNode.classList.remove("hidden");
  if (wasAtBottom) {
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  }
}

function setGenerationState(responseNode, label, active = true) {
  const message = responseNode.parentElement;
  const indicator = message.querySelector(".generation-indicator");
  const status = message.querySelector(".generation-status");
  if (!indicator || !status) return;

  const wasAtBottom = isAtBottom(messagesContainer);
  status.textContent = label;
  indicator.classList.toggle("hidden", !active);
  if (wasAtBottom) {
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  }
}

async function streamModelMessage(message, responseNode, stats) {
  setGenerationState(responseNode, "Thinking…");
  /** @type {import('@litert-lm/core').ToolCall[]} */
  let toolCalls = [];
  for await (const chunk of chatSession.sendMessageStreaming(message)) {
    if (chunk.tool_calls) toolCalls = chunk.tool_calls;
    for (const content of chunk.content || []) {
      if (content["type"] === "text") {
        // Text has started streaming, so remove the waiting indicator
        // immediately rather than leaving "Thinking…" visible.
        setGenerationState(responseNode, "", false);
        const wasAtBottom = isAtBottom(messagesContainer);
        responseNode.innerText += String(content["text"]);
        if (wasAtBottom) {
          messagesContainer.scrollTop = messagesContainer.scrollHeight;
        }
      }
    }
  }

  const benchmark = await chatSession.getBenchmarkInfo();
  if (
    !toolCalls.length &&
    benchmark.lastDecodeTokenCount > 0 &&
    benchmark.lastDecodeTokensPerSecond > 0
  ) {
    stats.tokens += benchmark.lastDecodeTokenCount;
    stats.seconds +=
      benchmark.lastDecodeTokenCount / benchmark.lastDecodeTokensPerSecond;
    updateGenerationSpeed(responseNode, stats);
  }
  setGenerationState(
    responseNode,
    toolCalls.length ? "Preparing tool call…" : "",
    !toolCalls.length ? false : true,
  );
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
    aiEngine = await Engine.create({
      model: MODEL_URL,
      benchmarkEnabled: true,
    });
    chatSession = await createChatSession();
    chatSession.delete;
    updateConversationButton();

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
          content: getSystemPrompt(),
        },
      ],
      tools: [javascriptTool],
    },
  });
}

function clearDisplayedMessages() {
  messagesContainer.replaceChildren();
  const welcome = welcomeTemplate.content.firstElementChild.cloneNode(true);
  messagesContainer.appendChild(welcome);
  lucideCreateIcons();
}

function openPromptModal() {
  if (isGenerating) return;
  const savedPrompt = localStorage.getItem(SYSTEM_PROMPT_STORAGE_KEY);
  systemPromptInput.value = savedPrompt || "";
  promptModal.classList.remove("hidden");
  promptModal.classList.add("flex");
  systemPromptInput.focus();
}

function closePromptModal() {
  promptModal.classList.add("hidden");
  promptModal.classList.remove("flex");
}

function confirmClearConversation() {
  confirmClearModal.classList.remove("hidden");
  confirmClearModal.classList.add("flex");
  confirmClearAction.focus();

  return new Promise((resolve) => {
    const finish = (confirmed) => {
      confirmClearModal.classList.add("hidden");
      confirmClearModal.classList.remove("flex");
      confirmClearCancel.removeEventListener("click", cancel);
      confirmClearAction.removeEventListener("click", confirm);
      confirmClearModal.removeEventListener("click", backdropCancel);
      document.removeEventListener("keydown", escapeCancel);
      resolve(confirmed);
    };
    const cancel = () => finish(false);
    const confirm = () => finish(true);
    const backdropCancel = (event) => {
      if (event.target === confirmClearModal) cancel();
    };
    const escapeCancel = (event) => {
      if (event.key === "Escape") cancel();
    };

    confirmClearCancel.addEventListener("click", cancel);
    confirmClearAction.addEventListener("click", confirm);
    confirmClearModal.addEventListener("click", backdropCancel);
    document.addEventListener("keydown", escapeCancel);
  });
}

async function applySystemPrompt(prompt) {
  const trimmedPrompt = prompt.trim();
  if (trimmedPrompt) localStorage.setItem(SYSTEM_PROMPT_STORAGE_KEY, prompt);
  else localStorage.removeItem(SYSTEM_PROMPT_STORAGE_KEY);

  promptApply.disabled = true;
  try {
    chatSession = await createChatSession();
    hasConversationHistory = false;
    clearDisplayedMessages();
    closePromptModal();
  } catch (error) {
    appendMessage("System", `Failed to apply system prompt: ${error.message}`);
  } finally {
    promptApply.disabled = false;
    updateConversationButton();
    inputField.focus();
  }
}

async function resetSystemPrompt() {
  localStorage.removeItem(SYSTEM_PROMPT_STORAGE_KEY);
  await applySystemPrompt("");
}

async function clearConversation() {
  if (!chatSession || isGenerating) return;
  if (!hasConversationHistory) {
    openPromptModal();
    return;
  }
  if (!(await confirmClearConversation())) return;

  clearButton.disabled = true;
  inputField.disabled = true;
  sendButton.disabled = true;
  try {
    chatSession = await createChatSession();
    hasConversationHistory = false;
    clearDisplayedMessages();
    updateConversationButton();
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
function appendMessage(sender, text, beforeNode) {
  const wasAtBottom = isAtBottom(messagesContainer);
  document.getElementById("welcome")?.remove();

  const isUser = sender === "You";
  const isSystem = sender === "System";
  const template = isUser
    ? youMessageTemplate
    : isSystem
      ? systemMessageTemplate
      : aiMessageTemplate;
  const msgDiv = /** @type {HTMLDivElement} */ (
    template.content.firstElementChild.cloneNode(true)
  );

  if (isSystem) {
    msgDiv.textContent = text;
  } else {
    msgDiv.querySelector(".content").textContent = text;
  }
  const beforeMessage = beforeNode?.parentElement;
  if (beforeMessage) {
    messagesContainer.insertBefore(msgDiv, beforeMessage);
  } else {
    messagesContainer.appendChild(msgDiv);
  }
  // The message must be in the document before Lucide replaces its placeholder.
  lucideCreateIcons();
  if (wasAtBottom || isUser) {
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  }
  return msgDiv.querySelector(".content") || msgDiv;
}

function resizeInput() {
  // Let the composer grow with multi-line messages without taking over the chat.
  inputField.style.height = "auto";
  inputField.style.height = `${Math.min(inputField.scrollHeight, 160)}px`;
}

async function copyResponse(button) {
  const message = button.closest(".message");
  const content = message?.querySelector(".content");
  if (!content) return;

  await navigator.clipboard.writeText(content.innerText || "");

  const label = button.querySelector("span");
  const originalLabel = label?.textContent || "Copy";
  if (label) label.textContent = "Copied!";
  button.setAttribute("aria-label", "Response copied");
  button.setAttribute("title", "Response copied");
  setTimeout(() => {
    if (!button.isConnected) return;
    if (label) label.textContent = originalLabel;
    button.setAttribute("aria-label", "Copy response");
    button.setAttribute("title", "Copy response");
  }, 1500);
}

messagesContainer.addEventListener("click", (event) => {
  const target = /** @type {Element} */ (event.target);
  const copyButton = target.closest(".copy-response");
  if (copyButton) copyResponse(/** @type {HTMLButtonElement} */ (copyButton));
});

async function handleSend() {
  const text = inputField.value.trim();
  if (!text) return;

  inputField.value = "";
  resizeInput();
  inputField.disabled = true;
  sendButton.disabled = true;
  clearButton.disabled = true;
  isGenerating = true;

  hasConversationHistory = true;
  updateConversationButton();
  appendMessage("You", text);
  // Create the assistant bubble before awaiting the model. Some responses
  // contain only tool calls, so there may be no streamed text to trigger it.
  const aiResponseNode = appendMessage("AI", "");
  const generationStats = { tokens: 0, seconds: 0 };

  try {
    /** @type {import('@litert-lm/core').MessageLike} */
    let message = text;
    for (let round = 0; round < 5; round += 1) {
      const toolCalls = await streamModelMessage(
        message,
        aiResponseNode,
        generationStats,
      );
      if (!toolCalls.length) break;

      /** @type {import('@litert-lm/core').ToolResponsePart[]} */
      const toolResults = [];
      for (const toolCall of toolCalls) {
        setGenerationState(
          aiResponseNode,
          `Running ${toolCall.function.name}…`,
        );
        appendMessage(
          "System",
          `Running ${toolCall.function.name}…`,
          aiResponseNode,
        );
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
    aiResponseNode.textContent += `\n\n[Error: ${err.message}]`;
  } finally {
    setGenerationState(aiResponseNode, "", false);
    aiResponseNode.parentElement
      .querySelector(".copy-response")
      ?.classList.replace("hidden", "inline-flex");
    isGenerating = false;
    inputField.disabled = false;
    sendButton.disabled = false;
    clearButton.disabled = false;
    inputField.focus();
  }
}

// Bind event listeners
clearButton.addEventListener("click", clearConversation);
promptApply.addEventListener("click", () =>
  applySystemPrompt(systemPromptInput.value),
);
promptReset.addEventListener("click", resetSystemPrompt);
promptCancel.addEventListener("click", closePromptModal);
promptCancelTop.addEventListener("click", closePromptModal);
promptModal.addEventListener("click", (event) => {
  if (event.target === promptModal) closePromptModal();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !promptModal.classList.contains("hidden")) {
    closePromptModal();
  }
});
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
