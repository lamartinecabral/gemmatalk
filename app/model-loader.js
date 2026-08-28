const progressContainer = document.getElementById("progress-container");
const progressBar = document.getElementById("progress-bar");
const progressText = document.getElementById("progress-text");
const progressLabel = document.getElementById("progress-label");
let progressHideTimer;

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

export async function setupServiceWorker() {
  if ("serviceWorker" in navigator) {
    await navigator.serviceWorker.register("service-worker.js");
    await navigator.serviceWorker.ready;

    // Hard reloads prevent the service from taking control. A normal reload fixes it.
    if (!navigator.serviceWorker.controller) location.reload();

    console.log("Service Worker is active and controlling requests.");
  }
}
