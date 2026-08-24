const CACHE_NAME = "litert-gemma-cache-v1";
const MODEL_URL_PATTERN = /\.litertlm$/;

self.addEventListener("install", (event) => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(clients.claim()));

self.addEventListener("fetch", (event) => {
  if (MODEL_URL_PATTERN.test(event.request.url)) {
    event.respondWith(
      caches.open(CACHE_NAME).then(async (cache) => {
        const cachedResponse = await cache.match(event.request);
        if (cachedResponse) {
          // If cached, immediately report 100% to the UI
          broadcastProgress(1, 1);
          return cachedResponse;
        }

        const networkResponse = await fetch(event.request);

        // 1. Get total bytes. (Fallback to ~1.9GB for Gemma 4 E2B if CORS hides the header)
        const totalBytes =
          Number(networkResponse.headers.get("Content-Length")) || 1930000000;
        let loadedBytes = 0;

        // 2. Create a pass-through stream that counts chunks as they download
        const progressStream = new TransformStream({
          transform(chunk, controller) {
            loadedBytes += chunk.byteLength;
            broadcastProgress(loadedBytes, totalBytes);
            controller.enqueue(chunk); // Pass the chunk along unharmed
          },
        });

        // 3. Cache a clone of the raw network response
        cache.put(event.request, networkResponse.clone());

        // 4. Return the new tracked stream to LiteRT-LM in the browser
        return new Response(networkResponse.body.pipeThrough(progressStream), {
          headers: networkResponse.headers,
          status: networkResponse.status,
          statusText: networkResponse.statusText,
        });
      }),
    );
  }
});

// Helper function to send progress data back to app.js
async function broadcastProgress(loaded, total) {
  const allClients = await self.clients.matchAll();
  for (const client of allClients) {
    client.postMessage({ type: "DOWNLOAD_PROGRESS", loaded, total });
  }
}
