// Execute model-requested code away from the chat page and terminate it on timeout.
self.onmessage = async function (event) {
  const { id, code } = event.data;
  const logs = [];

  // 1. Intercept standard console methods
  const originalConsole = {
    log: console.log,
    warn: console.warn,
    error: console.error,
    info: console.info,
    debug: console.debug,
  };

  function captureLog(level, ...args) {
    // Sanitize arguments to prevent DataCloneError during postMessage
    const safeArgs = args.map((arg) => {
      if (arg === undefined) return "undefined";
      if (typeof arg === "function")
        return `[Function: ${arg.name || "anonymous"}]`;
      if (arg instanceof Error) return arg.stack || arg.message;
      if (typeof arg === "symbol") return arg.toString();
      return arg;
    });
    logs.push({ level, args: safeArgs });
  }

  console.log = (...args) => captureLog("log", ...args);
  console.warn = (...args) => captureLog("warn", ...args);
  console.error = (...args) => captureLog("error", ...args);
  console.info = (...args) => captureLog("info", ...args);
  console.debug = (...args) => captureLog("debug", ...args);

  let result;
  let error = null;

  try {
    // 2. Execute the code
    // 'eval' automatically returns the value of the last evaluated expression.
    // We await it in case the evaluated code returns a Promise.
    result = await eval2(code);
  } catch (err) {
    error = err instanceof Error ? err.stack || err.message : String(err);
  } finally {
    // 3. Restore the original console
    Object.assign(console, originalConsole);
  }

  // 4. Sanitize the result
  let safeResult;
  try {
    // structuredClone throws if the result contains non-cloneable items (like DOM nodes or Functions)
    structuredClone(result);
    safeResult = JSON.parse(JSON.stringify(result));
  } catch (e) {
    safeResult =
      typeof result === "function"
        ? `[Function: ${result.name || "anonymous"}]`
        : String(result);
  }

  logs.forEach((log) => {
    log.args = log.args.map(String);
  });

  const value = {
    logs: !logs.length ? undefined : logs.length === 1 ? logs[0].args : logs,
    result: safeResult,
  };

  // 5. Send everything back to the main thread
  self.postMessage({ id, value, ok: !error, error });
};

const eval2 = async (source) => {
  if (String(source).startsWith("return ")) {
    const AsyncFunction = Object.getPrototypeOf(
      async function () {},
    ).constructor;
    return await new AsyncFunction(source)();
  }
  return await eval(source);
};
