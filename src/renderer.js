const STORAGE_KEY_DEVICE = "webcamMonitor.lastDeviceId";
const STORAGE_KEY_VOLUME = "webcamMonitor.volume";

const RECONNECT_DELAY_MS = 1500;
const MAX_RECONNECT_ATTEMPTS = 5;
const DEVICE_CHANGE_DEBOUNCE_MS = 800;

const permissionOverlay = document.getElementById("permission-overlay");
const permissionError = document.getElementById("permission-error");
const permissionSettings = document.getElementById("permission-settings");
const requestPermissionBtn = document.getElementById("request-permission-btn");
const openCameraSettingsBtn = document.getElementById("open-camera-settings");
const openMicSettingsBtn = document.getElementById("open-mic-settings");
const appShell = document.getElementById("app-shell");
const fullscreenButton = document.getElementById("fullscreen-button");
const fullscreenHint = document.getElementById("fullscreen-hint");

const cameraSelect = document.getElementById("camera-select");
const volumeSlider = document.getElementById("volume-slider");
const volumeValue = document.getElementById("volume-value");
const muteButton = document.getElementById("mute-button");
const preview = document.getElementById("preview");
const audioOut = document.getElementById("audio-out");
const previewPlaceholder = document.getElementById("preview-placeholder");
const statusEl = document.getElementById("status");
const updateBanner = document.getElementById("update-banner");
const updateBannerVersion = document.getElementById("update-banner-version");
const updateDownloadBtn = document.getElementById("update-download-btn");
const updateDismissBtn = document.getElementById("update-dismiss-btn");
const updateNotesToggle = document.getElementById("update-notes-toggle");
const updateNotesPanel = document.getElementById("update-notes-panel");
const updateNotesText = document.getElementById("update-notes-text");

let cameras = [];
let currentStream = null;
let activeCamera = null;
let isMuted = false;
let volumeBeforeMute = 80;
let permissionsGranted = false;
let fullscreenHintTimer = null;
let reconnectAttempts = 0;
let reconnectTimer = null;
let deviceChangeTimer = null;
let isStartingStream = false;
let updateDismissedForSession = false;
let pendingUpdateDownloadUrl = null;

const lowLatencyAudioConstraints = {
  echoCancellation: false,
  noiseSuppression: false,
  autoGainControl: false,
  channelCount: { ideal: 2 },
  sampleRate: { ideal: 48000 },
  latency: { ideal: 0 },
};

function setStatus(message, type = "") {
  statusEl.textContent = message;
  statusEl.className = "status";
  if (type) {
    statusEl.classList.add(type);
  }
}

function showPermissionError(message) {
  permissionError.textContent = message;
  permissionError.classList.remove("hidden");
  permissionSettings.classList.remove("hidden");
}

function hidePermissionError() {
  permissionError.classList.add("hidden");
}

function showAppShell() {
  permissionOverlay.classList.add("hidden");
  appShell.classList.remove("hidden");
}

function loadSavedVolume() {
  const saved = localStorage.getItem(STORAGE_KEY_VOLUME);
  if (saved !== null) {
    const value = Number.parseInt(saved, 10);
    if (!Number.isNaN(value) && value >= 0 && value <= 100) {
      volumeSlider.value = String(value);
      volumeBeforeMute = value;
      updateVolumeDisplay(value);
    }
  }
}

function saveVolume(value) {
  localStorage.setItem(STORAGE_KEY_VOLUME, String(value));
}

function updateVolumeDisplay(value) {
  volumeValue.textContent = `${value} %`;
}

function applyVolume(valuePercent) {
  if (!audioOut) {
    return;
  }
  audioOut.volume = isMuted ? 0 : Math.min(1, Math.max(0, valuePercent / 100));
}

function clearReconnectTimer() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
}

function buildAudioConstraints(camera) {
  if (camera.groupId) {
    return {
      ...lowLatencyAudioConstraints,
      groupId: { exact: camera.groupId },
    };
  }
  return { ...lowLatencyAudioConstraints };
}

function getStreamHealth(stream) {
  if (!stream) {
    return { ok: false, reason: "Kein Stream" };
  }

  const videoTracks = stream.getVideoTracks();
  const audioTracks = stream.getAudioTracks();

  if (!videoTracks.length || videoTracks[0].readyState !== "live") {
    return { ok: false, reason: "Video unterbrochen" };
  }

  if (videoTracks[0].muted) {
    return { ok: false, reason: "Video pausiert" };
  }

  if (audioTracks.length && audioTracks[0].readyState !== "live") {
    return { ok: false, reason: "Audio unterbrochen" };
  }

  return { ok: true };
}

function attachStreamMonitoring(stream, camera) {
  stream.getTracks().forEach((track) => {
    track.onended = () => {
      if (activeCamera?.deviceId !== camera.deviceId) {
        return;
      }
      scheduleReconnect("Track beendet");
    };

    track.onmute = () => {
      if (activeCamera?.deviceId !== camera.deviceId) {
        return;
      }
      setStatus(`Signal pausiert: ${camera.label}`, "error");
    };

    track.onunmute = () => {
      if (activeCamera?.deviceId !== camera.deviceId) {
        return;
      }
      reconnectAttempts = 0;
      setStatus(`Verbunden: ${camera.label}`, "success");
    };
  });
}

function scheduleReconnect(reason) {
  if (!activeCamera || reconnectTimer || isStartingStream) {
    return;
  }

  if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
    setStatus(
      `${reason} — Verbindung fehlgeschlagen. Bitte Kamera erneut wählen.`,
      "error"
    );
    return;
  }

  reconnectAttempts += 1;
  setStatus(
    `${reason} — Verbinde neu (${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS}) …`,
    "error"
  );

  reconnectTimer = setTimeout(async () => {
    reconnectTimer = null;
    if (!activeCamera) {
      return;
    }
    await startStream(activeCamera, { isReconnect: true });
  }, RECONNECT_DELAY_MS);
}

function stopCurrentStream() {
  clearReconnectTimer();

  if (currentStream) {
    currentStream.getTracks().forEach((track) => {
      track.onended = null;
      track.onmute = null;
      track.onunmute = null;
      track.stop();
    });
    currentStream = null;
  }

  preview.srcObject = null;
  audioOut.srcObject = null;
  preview.classList.remove("active");
  previewPlaceholder.classList.remove("hidden");
}

function setupAudioPlayback(stream) {
  const audioTracks = stream.getAudioTracks();
  if (!audioTracks.length) {
    audioOut.srcObject = null;
    return false;
  }

  audioOut.srcObject = new MediaStream(audioTracks);
  applyVolume(Number.parseInt(volumeSlider.value, 10));

  audioOut.play().catch((error) => {
    console.error("Audio-Wiedergabe:", error);
  });

  return true;
}

async function startStream(camera, options = {}) {
  if (isStartingStream) {
    return;
  }

  isStartingStream = true;
  stopCurrentStream();
  activeCamera = camera;

  const constraints = {
    video: {
      deviceId: { exact: camera.deviceId },
      width: { ideal: 3840 },
      height: { ideal: 2160 },
      frameRate: { ideal: 60, max: 60 },
    },
    audio: buildAudioConstraints(camera),
  };

  try {
    currentStream = await navigator.mediaDevices.getUserMedia(constraints);

    preview.srcObject = currentStream;
    preview.classList.add("active");
    previewPlaceholder.classList.add("hidden");

    const hasAudio = setupAudioPlayback(currentStream);
    attachStreamMonitoring(currentStream, camera);

    volumeSlider.disabled = !hasAudio;
    muteButton.disabled = !hasAudio;

    localStorage.setItem(STORAGE_KEY_DEVICE, camera.deviceId);
    reconnectAttempts = 0;

    if (hasAudio) {
      setStatus(`Verbunden: ${camera.label}`, "success");
    } else {
      setStatus(
        `Verbunden: ${camera.label} — kein Ton erkannt. Mikrofon-Berechtigung prüfen.`,
        "error"
      );
    }
  } catch (error) {
    console.error(error);
    activeCamera = null;

    if (options.isReconnect) {
      scheduleReconnect("Verbindung verloren");
    } else {
      setStatus(
        `Fehler beim Starten: ${error.message || "Unbekannter Fehler"}`,
        "error"
      );
      cameraSelect.value = "";
    }
  } finally {
    isStartingStream = false;
  }
}

async function loadCameras() {
  setStatus("Geräte werden geladen …");

  const devices = await navigator.mediaDevices.enumerateDevices();
  cameras = devices
    .filter((device) => device.kind === "videoinput")
    .map((device) => ({
      deviceId: device.deviceId,
      groupId: device.groupId,
      label: device.label || `Kamera ${device.deviceId.slice(0, 8)}`,
    }));

  cameraSelect.innerHTML = "";

  if (cameras.length === 0) {
    cameraSelect.innerHTML = '<option value="">Keine Kameras gefunden</option>';
    setStatus("Keine Kameras gefunden.", "error");
    return;
  }

  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "— Kamera wählen —";
  cameraSelect.appendChild(placeholder);

  cameras.forEach((camera) => {
    const option = document.createElement("option");
    option.value = camera.deviceId;
    option.textContent = camera.label;
    cameraSelect.appendChild(option);
  });

  cameraSelect.disabled = false;

  const savedDeviceId = localStorage.getItem(STORAGE_KEY_DEVICE);
  const preferredDeviceId =
    activeCamera?.deviceId || savedDeviceId || cameraSelect.value;

  if (preferredDeviceId && cameras.some((c) => c.deviceId === preferredDeviceId)) {
    cameraSelect.value = preferredDeviceId;
    const health = getStreamHealth(currentStream);
    if (!health.ok) {
      const camera = cameras.find((c) => c.deviceId === preferredDeviceId);
      await startStream(camera);
    } else {
      setStatus(`Verbunden: ${activeCamera?.label || "Kamera aktiv"}`, "success");
    }
  } else {
    setStatus(`${cameras.length} Kamera(s) gefunden. Bitte auswählen.`);
  }
}

async function requestPermissions() {
  hidePermissionError();
  requestPermissionBtn.disabled = true;
  requestPermissionBtn.textContent = "Wird angefragt …";

  try {
    const tempStream = await navigator.mediaDevices.getUserMedia({
      video: {
        width: { ideal: 1920 },
        height: { ideal: 1080 },
      },
      audio: lowLatencyAudioConstraints,
    });
    tempStream.getTracks().forEach((track) => track.stop());

    permissionsGranted = true;
    showAppShell();
    await loadCameras();
  } catch (error) {
    console.error(error);
    let message =
      "Zugriff verweigert. Bitte Kamera und Mikrofon in Windows erlauben.";

    if (error.name === "NotFoundError") {
      message = "Keine Kamera oder kein Mikrofon gefunden.";
    } else if (error.name === "NotReadableError") {
      message = "Gerät wird bereits von einer anderen Anwendung verwendet.";
    } else if (error.message) {
      message = error.message;
    }

    showPermissionError(message);
  } finally {
    requestPermissionBtn.disabled = false;
    requestPermissionBtn.textContent = "Berechtigung anfordern";
  }
}

async function toggleFullscreen() {
  if (!window.electronAPI) {
    return;
  }

  const isFullscreen = await window.electronAPI.isFullscreen();
  await window.electronAPI.setFullscreen(!isFullscreen);
}

function setFullscreenUi(isFullscreen) {
  document.body.classList.toggle("is-fullscreen", isFullscreen);
  fullscreenButton.textContent = isFullscreen ? "Vollbild beenden" : "Vollbild";

  if (isFullscreen) {
    fullscreenHint.classList.remove("hidden");
    fullscreenHint.classList.add("visible");
    clearTimeout(fullscreenHintTimer);
    fullscreenHintTimer = setTimeout(() => {
      fullscreenHint.classList.remove("visible");
    }, 3500);
  } else {
    fullscreenHint.classList.add("hidden");
    fullscreenHint.classList.remove("visible");
  }
}

function startHealthMonitor() {
  setInterval(() => {
    if (!activeCamera || !currentStream || isStartingStream) {
      return;
    }

    const health = getStreamHealth(currentStream);
    if (!health.ok) {
      scheduleReconnect(health.reason);
    }
  }, 3000);
}

cameraSelect.addEventListener("change", async () => {
  reconnectAttempts = 0;
  const deviceId = cameraSelect.value;

  if (!deviceId) {
    activeCamera = null;
    stopCurrentStream();
    volumeSlider.disabled = true;
    muteButton.disabled = true;
    setStatus("Keine Kamera ausgewählt.");
    return;
  }

  const camera = cameras.find((c) => c.deviceId === deviceId);
  if (camera) {
    await startStream(camera);
  }
});

volumeSlider.addEventListener("input", () => {
  const value = Number.parseInt(volumeSlider.value, 10);
  updateVolumeDisplay(value);
  saveVolume(value);

  if (!isMuted) {
    volumeBeforeMute = value;
    applyVolume(value);
  }
});

muteButton.addEventListener("click", () => {
  isMuted = !isMuted;

  if (isMuted) {
    volumeBeforeMute = Number.parseInt(volumeSlider.value, 10);
    muteButton.textContent = "🔇";
    muteButton.title = "Stummschaltung aufheben";
    muteButton.setAttribute("aria-label", "Stummschaltung aufheben");
    applyVolume(0);
  } else {
    muteButton.textContent = "🔊";
    muteButton.title = "Stummschalten";
    muteButton.setAttribute("aria-label", "Stummschalten");
    volumeSlider.value = String(volumeBeforeMute);
    updateVolumeDisplay(volumeBeforeMute);
    saveVolume(volumeBeforeMute);
    applyVolume(volumeBeforeMute);
  }
});

requestPermissionBtn.addEventListener("click", requestPermissions);
fullscreenButton.addEventListener("click", toggleFullscreen);

openCameraSettingsBtn.addEventListener("click", () => {
  window.electronAPI?.openPrivacySettings("camera");
});

openMicSettingsBtn.addEventListener("click", () => {
  window.electronAPI?.openPrivacySettings("microphone");
});

navigator.mediaDevices.addEventListener("devicechange", () => {
  if (!permissionsGranted) {
    return;
  }

  clearTimeout(deviceChangeTimer);
  deviceChangeTimer = setTimeout(() => {
    loadCameras();
  }, DEVICE_CHANGE_DEBOUNCE_MS);
});

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && activeCamera) {
    const health = getStreamHealth(currentStream);
    if (!health.ok) {
      scheduleReconnect("Verbindung nach Pause prüfen");
    } else if (audioOut?.srcObject) {
      audioOut.play().catch(() => {});
    }
  }
});

if (window.electronAPI) {
  window.electronAPI.onAppClosing(() => {
    activeCamera = null;
    stopCurrentStream();
  });

  window.electronAPI.onFullscreenChanged((isFullscreen) => {
    setFullscreenUi(isFullscreen);
  });
}

window.addEventListener("beforeunload", () => {
  activeCamera = null;
  stopCurrentStream();
});

loadSavedVolume();
startHealthMonitor();
setupAppInfo();
runUpdateCheck();
requestPermissions();

function hideUpdateBanner() {
  updateBanner.classList.add("hidden");
  updateNotesPanel.classList.add("hidden");
  updateNotesToggle.textContent = "Änderungen anzeigen";
}

function showUpdateBanner(result) {
  if (updateDismissedForSession || !result?.updateAvailable) {
    hideUpdateBanner();
    return;
  }

  pendingUpdateDownloadUrl = result.downloadUrl || null;
  updateBannerVersion.textContent = `Webcam Monitor v${result.latestVersion} ist verfügbar.`;
  updateBanner.classList.remove("hidden");

  const notes = typeof result.releaseNotes === "string" ? result.releaseNotes.trim() : "";
  if (notes) {
    updateNotesText.textContent = notes;
    updateNotesToggle.classList.remove("hidden");
  } else {
    updateNotesText.textContent = "";
    updateNotesToggle.classList.add("hidden");
    updateNotesPanel.classList.add("hidden");
  }
}

async function runUpdateCheck() {
  if (!window.electronAPI?.checkForUpdates) {
    return;
  }

  try {
    const result = await window.electronAPI.checkForUpdates();
    showUpdateBanner(result);
  } catch (error) {
    console.warn("Update check failed:", error);
  }
}

updateDownloadBtn.addEventListener("click", async () => {
  if (!window.electronAPI?.openUpdateDownload || !pendingUpdateDownloadUrl) {
    return;
  }
  await window.electronAPI.openUpdateDownload(pendingUpdateDownloadUrl);
});

updateDismissBtn.addEventListener("click", () => {
  updateDismissedForSession = true;
  hideUpdateBanner();
});

updateNotesToggle.addEventListener("click", () => {
  const isHidden = updateNotesPanel.classList.contains("hidden");
  updateNotesPanel.classList.toggle("hidden", !isHidden);
  updateNotesToggle.textContent = isHidden
    ? "Änderungen ausblenden"
    : "Änderungen anzeigen";
});

function openPublisherWebsite() {
  window.electronAPI?.openExternal("https://jati-digital.de");
}

function setupAppInfo() {
  document.getElementById("credit-link")?.addEventListener("click", openPublisherWebsite);
  document
    .getElementById("credit-link-permission")
    ?.addEventListener("click", openPublisherWebsite);

  window.electronAPI?.getAppInfo().then((info) => {
    if (info?.version) {
      const versionEl = document.getElementById("app-version");
      if (versionEl) {
        versionEl.textContent = `v${info.version}`;
      }
    }
  });
}
