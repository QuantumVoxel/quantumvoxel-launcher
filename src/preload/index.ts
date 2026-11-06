import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("electronAPI", {
  getClientVersions: () => ipcRenderer.invoke("launcher:versions"),
  getLaunchState: () => ipcRenderer.invoke("launcher:state"),
  launchClient: (options: import("../shared/launcher").LaunchOptions) => ipcRenderer.invoke("launcher:launch", options),
  onLaunchState: (callback: (state: import("../shared/launcher").LaunchState) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, state: import("../shared/launcher").LaunchState) => callback(state);
    ipcRenderer.on("launcher:state", listener);
    return () => ipcRenderer.removeListener("launcher:state", listener);
  },
  minimize: () => ipcRenderer.send("window-minimize"),
  maximize: () => ipcRenderer.invoke("window-maximize"),
  close: () => ipcRenderer.send("window-close"),
  isMaximized: () => ipcRenderer.invoke("window-is-maximized"),
  onWindowState: (callback: (maximized: boolean) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, maximized: boolean) => callback(maximized);
    ipcRenderer.on("window-state", listener);
    return () => ipcRenderer.removeListener("window-state", listener);
  },
  setKeybinds: (keybinds: Record<string, string>) =>
    ipcRenderer.send("keybinds-update", keybinds),
  onKeybindAction: (callback: (actionId: string) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, actionId: string) => callback(actionId);
    ipcRenderer.on("keybind-action", listener);
    return () => ipcRenderer.removeListener("keybind-action", listener);
  },
  getDownloads: () => ipcRenderer.invoke("downloads:list"),
  cancelDownload: (id: string) => ipcRenderer.send("downloads:cancel", id),
  revealDownload: (id: string) => ipcRenderer.send("downloads:reveal", id),
  onDownloadsUpdate: (callback: (download: DownloadUpdate) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, download: DownloadUpdate) => callback(download);
    ipcRenderer.on("downloads:update", listener);
    return () => ipcRenderer.removeListener("downloads:update", listener);
  },
  onOpenUrl: (callback: (url: string) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, url: string) => callback(url);
    ipcRenderer.on("open-url", listener);
    return () => ipcRenderer.removeListener("open-url", listener);
  },
  getSettings: () => ipcRenderer.invoke("settings:get"),
  setSettings: (patch: Record<string, unknown>) => ipcRenderer.invoke("settings:set", patch),
  onSettingsChange: (callback: (settings: BrowserSettings) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, settings: BrowserSettings) => callback(settings);
    ipcRenderer.on("settings:changed", listener);
    return () => ipcRenderer.removeListener("settings:changed", listener);
  },
  getWebviewPreloadPath: () => ipcRenderer.invoke("webview-preload-path"),
  onToggleWebviewFullscreen: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on("toggle-webview-fullscreen", listener);
    return () => ipcRenderer.removeListener("toggle-webview-fullscreen", listener);
  },
  setWebviewFullscreen: (enabled: boolean) => ipcRenderer.invoke("window-set-webview-fullscreen", enabled),
  onWebviewFullscreenChange: (callback: (enabled: boolean) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, enabled: boolean) => callback(enabled);
    ipcRenderer.on("webview-fullscreen-changed", listener);
    return () => ipcRenderer.removeListener("webview-fullscreen-changed", listener);
  }
});

interface BrowserSettings {
  homeUrl: string;
  searchEngine: "google" | "duckduckgo" | "bing";
  showBookmarksBar: boolean;
  multithreadedDownloads: boolean;
  downloadThreads: number;
}

interface DownloadUpdate {
  id: string;
  url: string;
  filename: string;
  savePath: string;
  totalBytes: number;
  receivedBytes: number;
  state: "progressing" | "completed" | "cancelled" | "interrupted";
  multithreaded?: boolean;
  threads?: number;
}
