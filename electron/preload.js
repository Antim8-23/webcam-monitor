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
});
