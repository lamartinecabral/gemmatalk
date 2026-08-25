# GemmaTalk

GemmaTalk is a small, client-only chat application that runs Gemma 4 E2B directly in your browser. It uses WebGPU through [`@litert-lm/core`](https://github.com/google-ai-edge/LiteRT-LM) and does not require an application server or API key.

The model is downloaded from Hugging Face on the first visit (approximately **1.9 GB**) and cached by a service worker for later use. Once loaded, inference runs on the device.

## Features

- Private, browser-local conversations
- Gemma 4 E2B instruction-tuned model
- WebGPU-accelerated streaming responses
- First-download progress indicator
- Service-worker caching for the model
- Model-requested JavaScript calculations and data transformations
- Responsive dark UI with keyboard-friendly message entry
- One-click conversation history clearing

## Requirements

- Node.js and npm (for the local static server)
- A modern browser with WebGPU support
- Approximately 1.9 GB of free storage for the model cache
- A connection to download the model and browser dependencies on the first visit

WebGPU availability varies by browser and hardware. Chromium-based browsers generally provide the broadest support; make sure hardware acceleration and WebGPU are enabled.

## Run locally

Install the project dependencies:

```bash
npm install
```

Start a static development server:

```bash
npm run serve
```

Open the URL printed by the server, usually [`http://localhost:3000`](http://localhost:3000). A static server is required because the app uses ES modules and a service worker; opening `index.html` directly with `file://` will not work.

On the first launch:

1. The service worker is registered.
2. LiteRT-LM initializes WebGPU.
3. The Gemma model is downloaded and cached.
4. The input becomes available when the model is ready.

Subsequent launches reuse the cached model until the browser storage is cleared or the cache version changes.

## Usage

Type a message and press **Enter** to send it. Use **Shift + Enter** to insert a newline. Responses are streamed into the conversation as they are generated. Use **Clear** in the header to start a fresh conversation; this removes the displayed messages and resets the model's conversation context (the downloaded model remains cached).

GemmaTalk exposes one tool to the model, `run_javascript`, for calculations and data transformations. Tool code is executed in a dedicated Web Worker, must return a JSON-serializable value, and is stopped after five seconds. For example, the model may use it to calculate a result instead of doing arithmetic in generated text.

## Project structure

```text
.
├── index.html                     UI, styles, import maps, and CDN dependencies
├── app.js                         Application startup and chat/tool loop
├── javascript-tool.js             Worker-backed tool dispatch
├── service-worker.js              Model caching and download tracking
├── package.json
└── biome.json
```

## Privacy and security notes

- There is no backend, account system, analytics integration, or chat API in this repository.
- Prompts and generated messages are kept in the current page session and are not sent to an application server.
- The model file is fetched from Hugging Face and frontend dependencies are fetched from their configured CDNs.
- `run_javascript` executes code requested by the model in a Worker. The Worker has no access to the chat DOM, but Worker code should not be treated as a strong security sandbox. Do not use this app with untrusted model files or sensitive environments without reviewing and hardening that feature.
- The model cache can be removed through the browser's site-storage settings.

## Development

Run the formatter/linter with:

```bash
npm run lint
```

There is no build step: the app is served as native JavaScript modules from the repository root.

## Troubleshooting

### The input stays disabled

Check the browser console for WebGPU or model-loading errors. Confirm that hardware acceleration is enabled, that the browser supports WebGPU, and that the model URL is reachable.

### The model downloads again

The model is stored in the browser's Cache Storage. Clearing site data, using private browsing, changing the service-worker cache name, or running out of storage can require a new download.

### The service worker does not register

Use `http://localhost` or HTTPS. Service workers are not available from ordinary insecure remote origins or from `file://` pages.

### Download progress is inaccurate

Some hosts do not expose `Content-Length` through CORS, so the app falls back to an estimated 1.93 GB total. This affects only the displayed progress percentage, not model loading.
