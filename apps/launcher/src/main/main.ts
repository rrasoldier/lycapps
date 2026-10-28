import {
  app,
  BrowserWindow,
  dialog,
  globalShortcut,
  ipcMain,
  Menu,
  nativeImage,
  Notification,
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
import { isSafeUrl } from "../core/security";
import { makeRunner, Updater, type UpdateStatus } from "../core/updater";
import type { AskRequest, ConfirmRequest, Host } from "../core/types";
import { KeychainSecrets } from "./secrets";

const WIDTH = 780;
const MIN_HEIGHT = 84;
const MAX_HEIGHT = 760;

let win: BrowserWindow | null = null;
let tray: Tray | null = null;
let quitting = false;
let dialogOpen = false;
const pendingConfirms = new Map<string, (ok: boolean) => void>();
const pendingAsks = new Map<string, (answer: string | null) => void>();

const updater = new Updater(path.join(__dirname, "../.."), makeRunner({ loginShell: process.platform === "darwin" ? "/bin/zsh" : undefined }));
let updateStatus: UpdateStatus | null = null;
let updateBusy: string | null = null;
const E2E = process.argv.includes("--e2e");

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
  ask(req: AskRequest) {
    return new Promise<string | null>((resolve) => {
      if (!win || win.isDestroyed()) return resolve(null);
      const id = randomUUID();
      pendingAsks.set(id, resolve);
      showWindow();
      win.webContents.send("ask:request", { id, ...req });
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

function resolvePending(): void {
  for (const resolve of pendingConfirms.values()) resolve(false);
  pendingConfirms.clear();
  for (const resolve of pendingAsks.values()) resolve(null);
  pendingAsks.clear();
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
  w.loadFile(path.join(__dirname, "../renderer/index.html"), process.argv.includes("--e2e") ? { hash: "e2e" } : undefined);
  w.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  w.webContents.on("will-navigate", (e) => e.preventDefault());
  w.on("blur", () => {
    if (!dialogOpen && pendingConfirms.size === 0 && pendingAsks.size === 0 && !w.webContents.isDevToolsOpened()) hideWindow();
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
  win.setPosition(Math.round(x + (width - w) / 2), Math.round(y + height * 0.12));
  keepOnScreen();
}

function keepOnScreen(): void {
  if (!win) return;
  const { workArea } = screen.getDisplayMatching(win.getBounds());
  const [x, y] = win.getPosition();
  const [, h] = win.getSize();
  const maxY = workArea.y + workArea.height - h - 8;
  if (y > maxY) win.setPosition(x, Math.max(workArea.y + 8, maxY));
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
  ipcMain.handle("ask:answer", (_e, id: string, answer: string | null) => {
    const resolve = pendingAsks.get(id);
    pendingAsks.delete(id);
    resolve?.(typeof answer === "string" ? answer : null);
  });
  ipcMain.handle("update:get", () => ({ busy: updateBusy, status: updateStatus }));
  ipcMain.handle("update:run", async () => {
    const status = await (updateStatus?.state === "available" ? applyUpdate() : checkForUpdate(true));
    return { busy: updateBusy, status };
  });
  ipcMain.handle("agent:reset", () => service.resetConversation());
  ipcMain.handle("link:open", async (_e, url: string) => {
    if (typeof url === "string" && isSafeUrl(url)) await shell.openExternal(url);
  });
  ipcMain.handle("ui:resize", (_e, height: number) => {
    if (!win || typeof height !== "number") return;
    const h = Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, Math.round(height)));
    win.setSize(WIDTH, h);
    keepOnScreen();
  });
  ipcMain.handle("ui:hide", () => {
    resolvePending();
    hideWindow();
  });
}

function notify(body: string): void {
  if (Notification.isSupported()) new Notification({ title: "Cursor Launcher", body, silent: true }).show();
}

function setUpdateBusy(text: string | null): void {
  updateBusy = text;
  refreshTrayMenu();
}

async function checkForUpdate(manual: boolean): Promise<UpdateStatus> {
  if (updateBusy) return updateStatus ?? { state: "unavailable", reason: updateBusy };
  setUpdateBusy("Recherche de mises à jour…");
  try {
    const before = updateStatus?.state === "available" ? updateStatus.behind : 0;
    updateStatus = await updater.check();
    if (updateStatus.state === "available" && !manual && settingsStore.get().autoUpdate && !startupDone) {
      return await applyUpdate();
    }
    if (updateStatus.state === "available" && updateStatus.behind !== before) {
      notify(`Mise à jour disponible (${updateStatus.behind} nouveauté${updateStatus.behind > 1 ? "s" : ""}) : menu de la barre de menus → Mettre à jour.`);
    } else if (manual && updateStatus.state === "up-to-date") {
      notify("Vous êtes à jour.");
    }
    return updateStatus;
  } finally {
    setUpdateBusy(null);
  }
}

async function applyUpdate(): Promise<UpdateStatus> {
  setUpdateBusy("Mise à jour…");
  try {
    const result = await updater.apply((text) => setUpdateBusy(text));
    if (!result.changed) return (updateStatus = await updater.check());
    notify("Mise à jour installée : redémarrage de l'application.");
    resolvePending();
    quitting = true;
    app.relaunch();
    app.exit(0);
  } catch (err) {
    dialog.showErrorBox("Mise à jour impossible", errorMessage(err));
    updateStatus = await updater.check().catch(() => updateStatus);
  } finally {
    setUpdateBusy(null);
  }
  return updateStatus ?? { state: "unavailable", reason: "Mise à jour non effectuée." };
}

async function updateAction(): Promise<UpdateStatus> {
  if (updateStatus?.state === "available") return applyUpdate();
  const status = await checkForUpdate(true);
  if (status.state === "unavailable") dialog.showErrorBox("Mises à jour indisponibles", status.reason);
  return status;
}

function updateLabel(): string {
  if (updateBusy) return `⏳ ${updateBusy}`;
  if (updateStatus?.state === "available") return `Mettre à jour (${updateStatus.behind} nouveauté${updateStatus.behind > 1 ? "s" : ""})…`;
  if (updateStatus?.state === "up-to-date") return `Vérifier les mises à jour (version ${updateStatus.version})`;
  return "Vérifier les mises à jour";
}

let startupDone = false;

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
      { label: updateLabel(), enabled: !updateBusy, click: () => void updateAction() },
      {
        label: "Mettre à jour automatiquement au démarrage",
        type: "checkbox",
        checked: s.autoUpdate,
        click: (item) => settingsStore.update({ autoUpdate: item.checked }),
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
    if (!E2E) {
      void checkForUpdate(false).finally(() => (startupDone = true));
      setInterval(() => void checkForUpdate(false), 6 * 3600_000).unref();
    }
    if (process.argv.includes("--show")) win.once("ready-to-show", showWindow);
    if (errors.length) {
      dialog.showErrorBox("Raccourcis globaux", `${errors.join("\n")}\n\nModifiez-les dans les réglages (icône de la barre de menus).`);
    }
  });
}
