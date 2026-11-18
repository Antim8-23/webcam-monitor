const {
  app,
  BrowserWindow,
  session,
  shell,
  globalShortcut,
  screen,
  ipcMain,
} = require("electron");
const path = require("path");
const fs = require("fs");
const { spawn } = require("child_process");
const {
  checkForUpdates,
  downloadUpdateFile,
} = require("./update-check");

let mainWindow = null;
let lastValidatedUpdate = null;
let nativeAudioProcess = null;
const NATIVE_AUDIO_START_TIMEOUT_MS = 5000;
const NATIVE_AUDIO_OUTPUT_TIMEOUT_MS = 3000;

if (process.platform === "win32") {
  app.setAppUserModelId("de.webcam.monitor");
}

function createWindow() {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  const iconPath = path.join(__dirname, "../assets/icon.ico");

  mainWindow = new BrowserWindow({
    width,
    height,
    minWidth: 640,
    minHeight: 480,
    title: "Webcam Monitor",
    icon: iconPath,
    autoHideMenuBar: true,
    backgroundColor: "#000000",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.maximize();
  mainWindow.loadFile(path.join(__dirname, "../src/index.html"));

  mainWindow.on("enter-full-screen", () => {
    mainWindow.webContents.send("fullscreen-changed", true);
  });

  mainWindow.on("leave-full-screen", () => {
    mainWindow.webContents.send("fullscreen-changed", false);
  });

  mainWindow.on("closed", () => {
    globalShortcut.unregisterAll();
    mainWindow = null;
  });
}

function registerShortcuts() {
  globalShortcut.register("F11", () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.setFullScreen(!mainWindow.isFullScreen());
    }
  });

  globalShortcut.register("Escape", () => {
    if (mainWindow && !mainWindow.isDestroyed() && mainWindow.isFullScreen()) {
      mainWindow.setFullScreen(false);
    }
  });
}

function canInstallUpdatesInPlace() {
  return process.platform === "win32" && app.isPackaged && !process.env.PORTABLE_EXECUTABLE_FILE;
}

function getUpdateInstallerPath(update) {
  const safeFileName = path.basename(update.installer.fileName);
  return path.join(app.getPath("temp"), `${Date.now()}-${safeFileName}`);
}

function stopNativeAudio() {
  const process = nativeAudioProcess;
  nativeAudioProcess = null;
  if (process && !process.killed) process.kill();
}

function getNativeAudioHelperPath() {
  const root = app.isPackaged ? process.resourcesPath : path.join(__dirname, "..");
  return path.join(root, "native", "DirectShowAudio", "publish", "DirectShowAudio.exe");
}

function isSafeNativeText(value, maxLength = 512) {
  return typeof value === "string" && value.length > 0 && value.length <= maxLength && !value.includes("\0");
}

function normalizeNativeVolume(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return Math.round(Math.min(100, Math.max(0, numeric)));
}

function sendNativeAudioCommand(command) {
  if (!nativeAudioProcess || nativeAudioProcess.killed || !nativeAudioProcess.stdin?.writable) {
    return false;
  }

  try {
    nativeAudioProcess.stdin.write(`${command}\n`);
    return true;
  } catch (error) {
    console.warn("DirectShow-Audiobefehl konnte nicht gesendet werden:", error);
    return false;
  }
}

function getNativeAudioOutputs() {
  const helper = getNativeAudioHelperPath();
  if (!fs.existsSync(helper)) return Promise.resolve([]);

  return new Promise((resolve) => {
    const process = spawn(helper, ["--list-output"], {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let settled = false;
    const finish = (outputs = []) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve(outputs);
    };
    const timeout = setTimeout(() => {
      process.kill();
      finish();
    }, NATIVE_AUDIO_OUTPUT_TIMEOUT_MS);

    process.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
      if (stdout.length > 64 * 1024) {
        process.kill();
        finish();
      }
    });
    process.on("error", () => finish());
    process.on("exit", (code) => {
      if (code !== 0) return finish();
      try {
        const parsed = JSON.parse(stdout);
        const outputs = Array.isArray(parsed)
          ? parsed
            .filter((output) => output && isSafeNativeText(output.id, 512) && isSafeNativeText(output.label, 256))
            .map((output) => ({ id: output.id, label: output.label }))
          : [];
        finish(outputs);
      } catch {
        finish();
      }
    });
  });
}

function startNativeAudio(videoLabel, outputName, volume, muted) {
  const helper = getNativeAudioHelperPath();
  if (!isSafeNativeText(videoLabel) || !fs.existsSync(helper)) {
    return Promise.resolve({ ok: false, message: "Der native Audiohelper ist nicht verfügbar." });
  }

  if (outputName !== null && outputName !== undefined && !isSafeNativeText(outputName, 256)) {
    return Promise.resolve({ ok: false, message: "Ungültiges Audioausgabegerät." });
  }

  const normalizedVolume = normalizeNativeVolume(volume);
  if (normalizedVolume === null || typeof muted !== "boolean") {
    return Promise.resolve({ ok: false, message: "Ungültige Audioeinstellungen." });
  }

  stopNativeAudio();
  const args = ["--monitor", videoLabel, "--volume", String(normalizedVolume), "--muted", muted ? "1" : "0"];
  if (outputName) args.push("--output", outputName);

  return new Promise((resolve) => {
    const process = spawn(helper, args, {
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    nativeAudioProcess = process;
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve(result);
    };
    const timeout = setTimeout(() => {
      if (nativeAudioProcess === process) stopNativeAudio();
      finish({ ok: false, message: "Der native Audiograph wurde nicht rechtzeitig gestartet." });
    }, NATIVE_AUDIO_START_TIMEOUT_MS);

    process.stdout.on("data", (chunk) => {
      if (chunk.toString().includes("DirectShow audio monitoring started.")) {
        finish({ ok: true });
      }
    });
    process.stderr.on("data", (chunk) => {
      console.warn("DirectShow-Audiofallback:", chunk.toString().trim());
    });
    process.on("error", () => finish({ ok: false, message: "Der native Audiohelper konnte nicht gestartet werden." }));
    process.on("exit", () => {
      const wasActive = nativeAudioProcess === process;
      if (wasActive) {
        nativeAudioProcess = null;
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send("native-audio-stopped");
        }
      }
      finish({ ok: false, message: "Der native Audiograph wurde beendet." });
    });
  });
}

app.whenReady().then(() => {
  session.defaultSession.setPermissionRequestHandler(
    (_webContents, permission, callback, details) => {
      const mediaPermissions = ["media", "mediaKeySystem"];
      if (mediaPermissions.includes(permission)) {
        callback(true);
        return;
      }
      callback(false);
    }
  );

  session.defaultSession.setPermissionCheckHandler(
    (_webContents, permission) => {
      return permission === "media" || permission === "mediaKeySystem";
    }
  );

  createWindow();
  registerShortcuts();

  ipcMain.handle("set-fullscreen", (_event, enabled) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.setFullScreen(Boolean(enabled));
      return mainWindow.isFullScreen();
    }
    return false;
  });

  ipcMain.handle("is-fullscreen", () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      return mainWindow.isFullScreen();
    }
    return false;
  });

  ipcMain.handle("open-privacy-settings", (_event, type) => {
    const urls = {
      camera: "ms-settings:privacy-webcam",
      microphone: "ms-settings:privacy-microphone",
    };
    const url = urls[type] || "ms-settings:privacy";
    return shell.openExternal(url);
  });

  ipcMain.handle("open-external", (_event, url) => {
    if (typeof url === "string" && /^https:\/\/jati-digital\.de/i.test(url)) {
      return shell.openExternal(url);
    }
    return false;
  });

  ipcMain.handle("get-app-info", () => ({
    name: "Webcam Monitor",
    version: app.getVersion(),
    publisher: "JaTi Digital",
    website: "https://jati-digital.de",
  }));

  ipcMain.handle("check-for-updates", async () => {
    const currentVersion = app.getVersion();
    const result = await checkForUpdates(currentVersion);
    lastValidatedUpdate = result.updateAvailable ? result : null;
    return {
      ...result,
      installMode: canInstallUpdatesInPlace() ? "installer" : "portable",
    };
  });

  ipcMain.handle("open-update-download", () => {
    const candidate = lastValidatedUpdate?.portable?.url;
    if (!candidate) {
      return false;
    }
    return shell.openExternal(candidate);
  });

  ipcMain.handle("get-native-audio-outputs", () => getNativeAudioOutputs());

  ipcMain.handle("start-native-capture-audio", (_event, options) => {
    if (!options || typeof options !== "object") {
      return { ok: false, message: "Ungültige Audioanfrage." };
    }
    return startNativeAudio(options.videoLabel, options.outputName, options.volume, options.muted);
  });

  ipcMain.handle("stop-native-capture-audio", () => { stopNativeAudio(); return true; });
  ipcMain.handle("set-native-capture-audio-volume", (_event, volume) => {
    const normalizedVolume = normalizeNativeVolume(volume);
    return normalizedVolume !== null && sendNativeAudioCommand(`volume ${normalizedVolume}`);
  });
  ipcMain.handle("set-native-capture-audio-muted", (_event, muted) => {
    if (typeof muted !== "boolean") return false;
    return sendNativeAudioCommand(muted ? "mute" : "unmute");
  });

  ipcMain.handle("download-and-install-update", async () => {
    if (!canInstallUpdatesInPlace() || !lastValidatedUpdate?.installer) {
      return { ok: false, message: "Dieses Update kann in dieser App-Version nicht installiert werden." };
    }

    try {
      const installerPath = getUpdateInstallerPath(lastValidatedUpdate);
      await downloadUpdateFile(lastValidatedUpdate.installer, installerPath);

      const installer = spawn(installerPath, ["/S"], {
        detached: true,
        stdio: "ignore",
        windowsHide: true,
      });
      installer.unref();

      setTimeout(() => app.quit(), 500);
      return { ok: true };
    } catch (error) {
      console.error("Update-Installation fehlgeschlagen:", error);
      return {
        ok: false,
        message: error?.message || "Update konnte nicht heruntergeladen werden.",
      };
    }
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
      registerShortcuts();
    }
  });
});

app.on("window-all-closed", () => {
  globalShortcut.unregisterAll();
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("will-quit", () => {
  stopNativeAudio();
  globalShortcut.unregisterAll();
});

app.on("before-quit", () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("app-closing");
  }
});
