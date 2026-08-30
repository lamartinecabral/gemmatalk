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

export function createJavascriptWorker() {
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

export const allTools = [javascriptTool];

export async function executeTool(toolCall) {
  const name = toolCall?.function?.name;
  let argumentsObject = toolCall?.function?.arguments || {};
  if (typeof argumentsObject === "string") {
    argumentsObject = JSON.parse(argumentsObject);
  }

  if (name === javascriptTool.function.name) {
    if (typeof argumentsObject.code !== "string") {
      throw new Error("run_javascript requires a string 'code' argument.");
    }

    return runJavascript(argumentsObject.code);
  }

  throw new Error(`Unknown tool: ${name || "(missing name)"}`);
}
