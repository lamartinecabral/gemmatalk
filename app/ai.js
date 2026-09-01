import { Engine } from "@litert-lm/core";
import { allTools } from "./tools.js";

// The WebGPU compatible Gemma 4 E2B weights file (Approx 1.9GB)
const MODEL_URL =
  "https://huggingface.co/litert-community/gemma-4-E2B-it-litert-lm/resolve/main/gemma-4-E2B-it-web.litertlm";

const DEFAULT_SYSTEM_PROMPT = systemPromptInput.placeholder;
const SYSTEM_PROMPT_STORAGE_KEY = "gemmatalk.systemPrompt";

/** @type {Engine} */
let aiEngine;

async function createChatSession(systemPrompt) {
  if (!aiEngine) {
    aiEngine = await Engine.create({
      model: MODEL_URL,
      benchmarkEnabled: true,
    });
  }

  return aiEngine.createConversation({
    preface: {
      messages: [
        {
          role: "system",
          content: systemPrompt,
        },
      ],
      tools: allTools,
    },
  });
}

export function getSystemPrompt(options = { useDefault: true }) {
  const savedPrompt = localStorage.getItem(SYSTEM_PROMPT_STORAGE_KEY);
  return savedPrompt?.trim()
    ? savedPrompt
    : options.useDefault === false
      ? null
      : DEFAULT_SYSTEM_PROMPT;
}

export function setSystemPrompt(prompt) {
  const trimmedPrompt = prompt ? String(prompt).trim() : "";
  if (trimmedPrompt)
    localStorage.setItem(SYSTEM_PROMPT_STORAGE_KEY, trimmedPrompt);
  else localStorage.removeItem(SYSTEM_PROMPT_STORAGE_KEY);
}

async function streamModelResponse(chatSession, message, onText) {
  /** @type {import('@litert-lm/core').ToolCall[]} */
  let toolCalls = [];
  for await (const chunk of chatSession.sendMessageStreaming(message)) {
    if (chunk.tool_calls) toolCalls = chunk.tool_calls;
    for (const content of chunk.content || []) {
      if (content["type"] === "text") onText(String(content["text"]));
    }
  }
  const benchmark = await chatSession.getBenchmarkInfo();
  return { toolCalls, benchmark };
}

export async function createChat() {
  let chatSession = await createChatSession(getSystemPrompt());
  return {
    sendMessage: (message, onText) =>
      streamModelResponse(chatSession, message, onText),
    reset: async () => {
      chatSession = await createChatSession(getSystemPrompt());
    },
  };
}
