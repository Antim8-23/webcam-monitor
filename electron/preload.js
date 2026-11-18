const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  onAppClosing: (callback) => {
    ipcRenderer.on("app-closing", callback);
  },
  onFullscreenChanged: (callback) => {
    ipcRenderer.on("fullscreen-changed", (_event, isFullscreen) => {
      callback(isFullscreen);
    });
  },
  setFullscreen: (enabled) => ipcRenderer.invoke("set-fullscreen", enabled),
  isFullscreen: () => ipcRenderer.invoke("is-fullscreen"),
  openPrivacySettings: (type) =>
    ipcRenderer.invoke("open-privacy-settings", type),
  openExternal: (url) => ipcRenderer.invoke("open-external", url),
  getAppInfo: () => ipcRenderer.invoke("get-app-info"),
  checkForUpdates: () => ipcRenderer.invoke("check-for-updates"),
  openUpdateDownload: () => ipcRenderer.invoke("open-update-download"),
  downloadAndInstallUpdate: () => ipcRenderer.invoke("download-and-install-update"),
  getNativeAudioOutputs: () => ipcRenderer.invoke("get-native-audio-outputs"),
  startNativeCaptureAudio: (options) => ipcRenderer.invoke("start-native-capture-audio", options),
  stopNativeCaptureAudio: () => ipcRenderer.invoke("stop-native-capture-audio"),
  setNativeCaptureAudioVolume: (volume) => ipcRenderer.invoke("set-native-capture-audio-volume", volume),
  setNativeCaptureAudioMuted: (muted) => ipcRenderer.invoke("set-native-capture-audio-muted", muted),
  onNativeAudioStopped: (callback) => {
    ipcRenderer.on("native-audio-stopped", () => callback());
  },
});
