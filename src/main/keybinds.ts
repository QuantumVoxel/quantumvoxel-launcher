import type { BrowserWindow } from "electron";

let keybinds: Record<string, string> = {};

const MODIFIER_KEYS = ["Control", "Meta", "Alt", "Shift"];

const SYMBOLS: Record<string, string> = {
  " ": "Space",
  ArrowUp: "↑",
  ArrowDown: "↓",
  ArrowLeft: "←",
  ArrowRight: "→",
  Enter: "Enter",
  Tab: "Tab",
  Backspace: "⌫",
  Delete: "Del",
  Escape: "Esc",
  Home: "Home",
  End: "End",
  PageUp: "PgUp",
  PageDown: "PgDn",
  Insert: "Ins",
  CapsLock: "Caps",
};

function normalizeKey(key: string): string {
  if (SYMBOLS[key]) return SYMBOLS[key];
  if (key.length === 1) return key.toUpperCase();
  return key;
}

function comboFromInput(input: Electron.Input): string | null {
  if (!input.key || MODIFIER_KEYS.includes(input.key)) return null;
  const parts: string[] = [];
  if (input.control) parts.push("Ctrl");
  else if (input.meta) parts.push("Cmd");
  if (input.alt) parts.push("Alt");
  if (input.shift) parts.push("Shift");
  parts.push(normalizeKey(input.key));
  return parts.join("+");
}

export function setKeybinds(next: Record<string, string>): void {
  keybinds = next;
}

export function setupWebviewKeybinds(win: BrowserWindow): void {
  win.webContents.on("did-attach-webview", (_event, guest) => {
    guest.on("before-input-event", (event, input) => {
      if (input.type !== "keyDown") return;
      const combo = comboFromInput(input);
      if (!combo) return;
      const actionId = (Object.keys(keybinds) as string[]).find(
        (id) => keybinds[id] === combo
      );
      if (!actionId) return;
      event.preventDefault();
      win.webContents.send("keybind-action", actionId);
    });
  });
}