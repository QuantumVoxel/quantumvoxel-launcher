export interface ElectronAPI {
  readonly platform: string;
  getClientVersions(): Promise<import("../shared/launcher").VersionResult>;
  getLaunchState(): Promise<import("../shared/launcher").LaunchState>;
  launchClient(options: import("../shared/launcher").LaunchOptions): Promise<import("../shared/launcher").LaunchState>;
  onLaunchState(callback: (state: import("../shared/launcher").LaunchState) => void): () => void;
  minimize(): void;
  maximize(): Promise<boolean>;
  close(): void;
  isMaximized(): Promise<boolean>;
  onWindowState(callback: (maximized: boolean) => void): () => void;
  setKeybinds(keybinds: Record<string, string>): void;
  onKeybindAction(callback: (actionId: string) => void): () => void;
  getDownloads(): Promise<DownloadRecord[]>;
  cancelDownload(id: string): void;
  revealDownload(id: string): void;
  onDownloadsUpdate(callback: (download: DownloadRecord) => void): () => void;
  onOpenUrl(callback: (url: string) => void): () => void;
  getSettings(): Promise<BrowserSettings>;
  setSettings(patch: Partial<BrowserSettings>): Promise<BrowserSettings>;
  onSettingsChange(callback: (settings: BrowserSettings) => void): () => void;
  getWebviewPreloadPath(): Promise<string>;
  onToggleWebviewFullscreen(callback: () => void): () => void;
  setWebviewFullscreen(enabled: boolean): Promise<boolean>;
  onWebviewFullscreenChange(callback: (enabled: boolean) => void): () => void;
}

export interface BrowserSettings {
  homeUrl: string;
  searchEngine: "google" | "duckduckgo" | "bing";
  showBookmarksBar: boolean;
  multithreadedDownloads: boolean;
  downloadThreads: number;
}

export interface DownloadRecord {
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

export interface Bookmark {
  id: string;
  title: string;
  url: string;
}

export interface TabInfo {
  id: number;
  title: string;
  url: string;
  active: boolean;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}

export {};
