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

let mainWindow = null;

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
  globalShortcut.unregisterAll();
});

app.on("before-quit", () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("app-closing");
  }
});
