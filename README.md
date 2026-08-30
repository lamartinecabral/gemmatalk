# GemmaTalk

GemmaTalk is a small, client-only chat application that runs Gemma 4 E2B directly in your browser. It uses WebGPU through [`@litert-lm/core`](https://github.com/google-ai-edge/LiteRT-LM) and does not require an application server or API key.

The model is downloaded from Hugging Face on the first visit (approximately **1.9 GB**) and cached by a service worker for later use. Once loaded, inference runs on the device.

## Features

- Private, browser-local conversations
- Gemma 4 E2B instruction-tuned model
- WebGPU-accelerated streaming responses
- Download and cached-model loading progress indicators
- Service-worker caching for the model
- Model-requested JavaScript calculations and data transformations
- Responsive dark UI with keyboard-friendly message entry
- One-click conversation history clearing

## Requirements

- Node.js and npm (for the local static server and development checks)
- A modern browser with WebGPU support
- Approximately 1.9 GB of free storage for the model cache
- A connection to download the model and CDN-hosted frontend dependencies on the first visit

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

On the first launch, the app shows a welcome screen instead of immediately allocating the model's substantial memory footprint. Click **Start model** when you are ready to use it:

1. The service worker is registered.
2. LiteRT-LM initializes WebGPU.
3. The Gemma model is downloaded (or loaded from the browser cache) and initialized.
4. The input becomes available when the model is ready.

Subsequent launches reuse the cached model until the browser storage is cleared or the cache version changes.

## Usage

Type a message and press **Enter** to send it. Use **Shift + Enter** to insert a newline. Responses are streamed into the conversation as they are generated. Use **Clear** in the header to start a fresh conversation; this removes the displayed messages and resets the model's conversation context (the downloaded model remains cached).

GemmaTalk exposes one tool to the model, `run_javascript`, for calculations and data transformations. Tool code is executed in a dedicated Web Worker, must return a JSON-serializable value, and is stopped after five seconds. For example, the model may use it to calculate a result instead of doing arithmetic in generated text.

## Project structure

```text
.
├── index.html                     UI, styles, import map, and CDN dependencies
├── app/
│   ├── index.js                   Application startup and chat/tool loop
│   ├── javascript-runner.js       Web Worker for model-requested JavaScript
│   ├── model-loader.js            Setup service worker and track load progress
│   ├── tools.js                   Model tool definitions
│   └── utils.js                   Utilities and helpers
├── service-worker.js              Model caching and download/cache-load progress tracking
└── package.json                   Serve, typecheck, lint, and test scripts
```

## Privacy and security notes

- There is no backend, account system, analytics integration, or chat API in this repository.
- Prompts and generated messages are kept in the current page session and are not sent to an application server.
- The model file is fetched from Hugging Face. LiteRT-LM, Tailwind CSS, and Lucide are loaded from the URLs configured in `index.html`.
- `run_javascript` executes code requested by the model in a Worker. The Worker has no access to the chat DOM, but Worker code should not be treated as a strong security sandbox. Do not use this app with untrusted model files or sensitive environments without reviewing and hardening that feature.
- The model cache can be removed through the browser's site-storage settings.

## Development

The app is served as native JavaScript modules from the repository root; there is no build step. JavaScript is checked with TypeScript using `// @ts-check` and the repository's `tsconfig.json`.

Run the type checker and linter together:

```bash
npm test
```

Run either check separately when needed:

```bash
npm run typecheck
npm run lint
```

## Troubleshooting

### The input stays disabled

Check the browser console for WebGPU, service-worker, or model-loading errors. Confirm that hardware acceleration is enabled, that the browser supports WebGPU, and that the model URL is reachable. If the service worker does not take control after a hard reload, reload the page normally.

### WebGPU is unavailable on Linux

On Linux, Chromium's WebGPU implementation uses the Vulkan graphics stack. A missing Vulkan driver, a broken Vulkan installation, or Chromium's Linux WebGPU feature flags can therefore prevent GemmaTalk from starting.

1. Check the operating system first. Install the Vulkan runtime and the driver for your GPU using your distribution's packages, then run:

   ```bash
   vulkaninfo --summary
   ```

   This command should list a physical GPU without an initialization error. For example, Debian/Ubuntu systems commonly need `vulkan-tools` plus the appropriate Mesa or NVIDIA Vulkan driver package. Do not install a driver from a different GPU vendor just to make this command run; use the driver recommended for your hardware and distribution.

2. In Chromium, open `chrome://gpu` and confirm that **WebGPU** is hardware accelerated. Also check `chrome://settings/system` and enable **Use graphics acceleration when available**, then restart the browser.

3. If WebGPU is still missing on Linux, open `chrome://flags` and enable `#enable-vulkan` and `#enable-unsafe-webgpu`, then relaunch Chromium. These flags are experimental and may be renamed or removed as Linux support changes. Avoid relying on `#ignore-gpu-blocklist` except as a temporary diagnostic: it can cause crashes or unstable rendering.

If `vulkaninfo --summary` works but `chrome://gpu` reports **Software only, hardware acceleration unavailable**, update the GPU driver and browser and check the browser's GPU-process errors. Software Vulkan (such as SwiftShader) is not a practical substitute for this app's model inference. See Chrome's [WebGPU troubleshooting guide](https://developer.chrome.com/docs/web-platform/webgpu/troubleshooting-tips) and [Dawn's WebGPU implementation overview](https://github.com/google/dawn/blob/main/docs/dawn/overview.md) for more detail.

### The model downloads again

The model is stored in the browser's Cache Storage. Clearing site data, using private browsing, changing the service-worker cache name, or running out of storage can require a new download.

### The service worker does not register

Use `http://localhost` or HTTPS. Service workers are not available from ordinary insecure remote origins or from `file://` pages.

### Download progress is inaccurate

Some hosts do not expose `Content-Length` through CORS, so the app falls back to an estimated 1.93 GB total. This affects only the displayed progress percentage, not model loading.
