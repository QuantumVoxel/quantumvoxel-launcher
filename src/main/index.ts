import {app, BrowserWindow, ipcMain, Menu, globalShortcut} from "electron";
import {join} from "node:path";
import {registerLauncher} from "./launcher";

let mainWindow: BrowserWindow;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    title: "QuantumVoxel Launcher",
    width: 1100,
    height: 780,
    minWidth: 700,
    minHeight: 550,
    frame: false,
    backgroundColor: "#101418",
    icon: join(app.getAppPath(), "icons/icon.png"),
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  const url = process.env.ELECTRON_RENDERER_URL;
  if (url) void mainWindow.loadURL(url);
  else void mainWindow.loadFile(join(__dirname, "../renderer/index.html"));
  mainWindow.on("maximize", () => mainWindow.webContents.send("window-state", true));
  mainWindow.on("unmaximize", () => mainWindow.webContents.send("window-state", false));
}

ipcMain.on("window-minimize", () => mainWindow.minimize());
ipcMain.on("window-close", () => mainWindow.close());
ipcMain.handle("window-maximize", () => {
  if (mainWindow.isMaximized()) mainWindow.unmaximize(); else mainWindow.maximize();
  return mainWindow.isMaximized();
});
ipcMain.handle("window-is-maximized", () => mainWindow.isMaximized());
app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  globalShortcut.register("CommandOrControl+Shift+I", () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.openDevTools();
    }
  });
  registerLauncher(() => mainWindow);
  createWindow();
  app.on("activate", () => {
    if (!BrowserWindow.getAllWindows().length) createWindow();
  });
});
app.on("will-quit", () => {
  globalShortcut.unregisterAll();
});
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
