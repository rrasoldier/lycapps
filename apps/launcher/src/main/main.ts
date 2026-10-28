import {
  app,
  BrowserWindow,
  dialog,
  globalShortcut,
  ipcMain,
  Menu,
  nativeImage,
  screen,
  session,
  shell,
  systemPreferences,
  Tray,
} from "electron";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import * as path from "node:path";
import { getProvider, PROVIDERS } from "../core/llm";
import { LauncherService, llmSecretName, SECRET_TRANSCRIPTION } from "../core/service";
import { HistoryStore, SettingsStore, type Settings } from "../core/settings";
import type { ConfirmRequest, Host } from "../core/types";
import { KeychainSecrets } from "./secrets";

const WIDTH = 720;
const MIN_HEIGHT = 84;
const MAX_HEIGHT = 720;

let win: BrowserWindow | null = null;
let tray: Tray | null = null;
let quitting = false;
let dialogOpen = false;
const pendingConfirms = new Map<string, (ok: boolean) => void>();

const userData = app.getPath("userData");
const settingsStore = new SettingsStore(path.join(userData, "settings.json"));
const history = new HistoryStore(path.join(userData, "history.json"));
const secrets = new KeychainSecrets(path.join(userData, "secrets.json"));

const host: Host = {
  confirm(req) {
    return new Promise<boolean>((resolve) => {
      if (!win || win.isDestroyed()) return resolve(false);
      const id = randomUUID();
      pendingConfirms.set(id, resolve);
      showWindow();
      const payload: ConfirmRequest = { id, ...req };
      win.webContents.send("confirm:request", payload);
    });
  },
  async openExternal(url) {
    await shell.openExternal(url);
  },
  openApp(name) {
    return new Promise<void>((resolve, reject) => {
      if (process.platform !== "darwin") return reject(new Error("open_app n'est disponible que sur macOS."));
      execFile("open", ["-a", name], (err) => (err ? reject(new Error(`Impossible d'ouvrir « ${name} ».`)) : resolve()));
    });
  },
  async trash(p) {
    await shell.trashItem(p);
  },
};

const service = new LauncherService({
  getSettings: () => settingsStore.get(),
  updateSettings: (patch) => settingsStore.update(patch),
  secrets,
  host,
});

function resolvePendingConfirms(ok: boolean): void {
  for (const resolve of pendingConfirms.values()) resolve(ok);
  pendingConfirms.clear();
}

function createWindow(): BrowserWindow {
  const w = new BrowserWindow({
    width: WIDTH,
    height: MIN_HEIGHT,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    movable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: true,
    webPreferences: {
      preload: path.join(__dirname, "../preload/preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  w.setAlwaysOnTop(true, "screen-saver");
  w.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  w.loadFile(path.join(__dirname, "../renderer/index.html"));
  w.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  w.webContents.on("will-navigate", (e) => e.preventDefault());
  w.on("blur", () => {
    if (!dialogOpen && pendingConfirms.size === 0 && !w.webContents.isDevToolsOpened()) hideWindow();
  });
  w.on("close", (e) => {
    if (!quitting) {
      e.preventDefault();
      hideWindow();
    }
  });
  return w;
}

function positionWindow(): void {
  if (!win) return;
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const { x, y, width, height } = display.workArea;
  const [w] = win.getSize();
  win.setPosition(Math.round(x + (width - w) / 2), Math.round(y + height * 0.2));
}

function showWindow(): void {
  if (!win) return;
  if (!win.isVisible()) positionWindow();
  win.show();
  win.focus();
  win.webContents.send("ui:shown");
}

function hideWindow(): void {
  if (!win || !win.isVisible()) return;
  win.hide();
  if (process.platform === "darwin") app.hide();
}

function toggleWindow(): void {
  if (win?.isVisible() && win.isFocused()) hideWindow();
  else showWindow();
}

function toggleDictation(): void {
  showWindow();
  win?.webContents.send("ui:toggle-dictation");
}

function registerShortcuts(s: Settings): string[] {
  globalShortcut.unregisterAll();
  const errors: string[] = [];
  const reg = (accel: string, fn: () => void, label: string) => {
    try {
      if (!accel || !globalShortcut.register(accel, fn)) errors.push(`${label} : « ${accel} » est invalide ou déjà utilisé.`);
    } catch {
      errors.push(`${label} : raccourci « ${accel} » invalide.`);
    }
  };
  reg(s.shortcut, toggleWindow, "Raccourci principal");
  reg(s.dictationShortcut, toggleDictation, "Raccourci de dictée");
  return errors;
}

function applyLoginItem(s: Settings): void {
  if (process.platform !== "darwin" && process.platform !== "win32") return;
  try {
    if (app.getLoginItemSettings().openAtLogin === s.launchAtLogin) return;
    app.setLoginItemSettings({ openAtLogin: s.launchAtLogin, openAsHidden: true });
  } catch {
    /* app non signée (développement) : macOS peut refuser, sans conséquence */
  }
}

function buildState() {
  const s = settingsStore.get();
  const preset = getProvider(s.provider);
  return {
    settings: s,
    history: history.list(),
    llmKeySource: service.llmKeySource(),
    hasTranscriptionKey: Boolean(service.transcriptionKey()),
    secretsAvailable: secrets.available(),
    defaults: { baseUrl: preset.baseUrl, model: preset.defaultModel },
    providers: PROVIDERS.map((p) => ({ id: p.id, label: p.label, baseUrl: p.baseUrl, defaultModel: p.defaultModel })),
    platform: process.platform,
  };
}

async function withDialog<T>(fn: () => Promise<T>): Promise<T> {
  dialogOpen = true;
  try {
    return await fn();
  } finally {
    dialogOpen = false;
    win?.focus();
  }
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function registerIpc(): void {
  ipcMain.handle("state:get", () => buildState());

  ipcMain.handle("settings:update", (_e, patch: Partial<Settings>) => {
    const allowedKeys = new Set(Object.keys(settingsStore.get()));
    const clean = Object.fromEntries(Object.entries(patch ?? {}).filter(([k]) => allowedKeys.has(k))) as Partial<Settings>;
    const s = settingsStore.update(clean);
    const errors = registerShortcuts(s);
    applyLoginItem(s);
    refreshTrayMenu();
    return { state: buildState(), errors };
  });

  ipcMain.handle("secret:set", (_e, name: string, value: string | null) => {
    const key = name === "transcription" ? SECRET_TRANSCRIPTION : llmSecretName(settingsStore.get().provider);
    try {
      secrets.set(key, value);
      return { state: buildState(), error: null };
    } catch (e) {
      return { state: buildState(), error: errorMessage(e) };
    }
  });

  ipcMain.handle("agent:run", async (e, prompt: string) => {
    if (typeof prompt !== "string" || !prompt.trim()) return { ok: false, text: "Prompt vide." };
    history.add(prompt);
    try {
      const text = await service.runPrompt(prompt, (ev) => e.sender.send("agent:event", ev));
      return { ok: true, text };
    } catch (err) {
      return { ok: false, text: errorMessage(err) };
    }
  });
  ipcMain.handle("models:list", async () => {
    try {
      return { ok: true, models: await service.listModels() };
    } catch (err) {
      return { ok: false, error: errorMessage(err) };
    }
  });
  ipcMain.handle("agent:cancel", () => service.cancel());
  ipcMain.handle("history:clear", () => {
    history.clear();
    return [];
  });

  ipcMain.handle("folder:pick", () =>
    withDialog(async () => {
      const r = await dialog.showOpenDialog(win!, { properties: ["openDirectory", "createDirectory"] });
      return r.canceled ? null : r.filePaths[0];
    }),
  );
  ipcMain.handle("folder:add-allowed", () =>
    withDialog(async () => {
      const r = await dialog.showOpenDialog(win!, { properties: ["openDirectory"], message: "Dossier à autoriser pour l'agent" });
      if (r.canceled) return buildState();
      const s = settingsStore.get();
      settingsStore.update({ allowedRoots: [...s.allowedRoots, r.filePaths[0]] });
      return buildState();
    }),
  );
  ipcMain.handle("folder:plan", async (_e, folder: string, prompt: string, preset: "type" | "prompt") => {
    try {
      return { ok: true, ...(await service.planFolder(folder, prompt, preset === "type" ? "type" : "prompt")) };
    } catch (err) {
      return { ok: false, error: errorMessage(err) };
    }
  });
  ipcMain.handle("folder:apply", async (_e, id: string, selected: string[]) => {
    try {
      return { ok: true, result: await service.applyFolderPlan(id, selected) };
    } catch (err) {
      return { ok: false, error: errorMessage(err) };
    }
  });
  ipcMain.handle("folder:undo", () => {
    try {
      return { ok: true, result: service.undoLastOrganize() };
    } catch (err) {
      return { ok: false, error: errorMessage(err) };
    }
  });

  ipcMain.handle("mic:ensure", async () => {
    if (process.platform !== "darwin") return true;
    const status = systemPreferences.getMediaAccessStatus("microphone");
    if (status === "granted") return true;
    if (status === "not-determined") return systemPreferences.askForMediaAccess("microphone");
    return false;
  });
  ipcMain.handle("voice:transcribe", async (_e, audio: ArrayBuffer, mime: string) => {
    try {
      return { ok: true, text: await service.transcribe(new Uint8Array(audio), mime) };
    } catch (err) {
      return { ok: false, error: errorMessage(err) };
    }
  });

  ipcMain.handle("confirm:answer", (_e, id: string, ok: boolean) => {
    const resolve = pendingConfirms.get(id);
    pendingConfirms.delete(id);
    resolve?.(ok === true);
  });
  ipcMain.handle("ui:resize", (_e, height: number) => {
    if (!win || typeof height !== "number") return;
    const h = Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, Math.round(height)));
    win.setSize(WIDTH, h);
  });
  ipcMain.handle("ui:hide", () => {
    resolvePendingConfirms(false);
    hideWindow();
  });
}

function refreshTrayMenu(): void {
  if (!tray) return;
  const s = settingsStore.get();
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: `Afficher le lanceur (${s.shortcut})`, click: showWindow },
      { label: `Dicter (${s.dictationShortcut})`, click: toggleDictation },
      { label: "Réglages…", click: () => { showWindow(); win?.webContents.send("ui:open-settings"); } },
      { type: "separator" },
      {
        label: "Lancer au démarrage",
        type: "checkbox",
        checked: s.launchAtLogin,
        click: (item) => {
          const next = settingsStore.update({ launchAtLogin: item.checked });
          applyLoginItem(next);
        },
      },
      { type: "separator" },
      { label: "Quitter", click: () => { quitting = true; app.quit(); } },
    ]),
  );
}

function createTray(): void {
  const icon = nativeImage.createFromPath(path.join(__dirname, "../../resources/trayTemplate.png"));
  icon.setTemplateImage(true);
  tray = new Tray(icon);
  tray.setToolTip("Cursor Launcher");
  tray.on("click", toggleWindow);
  refreshTrayMenu();
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", showWindow);
  app.on("before-quit", () => {
    quitting = true;
  });
  app.on("will-quit", () => globalShortcut.unregisterAll());
  app.on("window-all-closed", () => {
    /* application de barre de menus : on reste actif */
  });

  app.whenReady().then(() => {
    if (process.platform === "darwin") {
      app.setActivationPolicy("accessory");
      app.dock?.hide();
    }
    session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => cb(permission === "media"));
    session.defaultSession.setPermissionCheckHandler((_wc, permission) => permission === "media");

    registerIpc();
    win = createWindow();
    createTray();
    const s = settingsStore.get();
    const errors = registerShortcuts(s);
    applyLoginItem(s);
    if (process.argv.includes("--show")) win.once("ready-to-show", showWindow);
    if (errors.length) {
      dialog.showErrorBox("Raccourcis globaux", `${errors.join("\n")}\n\nModifiez-les dans les réglages (icône de la barre de menus).`);
    }
  });
}
