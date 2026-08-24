// Execute model-requested code away from the chat page and terminate it on timeout.
self.addEventListener("message", async ({ data }) => {
  try {
    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
    const value = await new AsyncFunction(data.code)();
    const serialized =
      typeof value === "undefined" ? null : JSON.parse(JSON.stringify(value));
    self.postMessage({ id: data.id, ok: true, value: serialized });
  } catch (error) {
    self.postMessage({
      id: data.id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});
