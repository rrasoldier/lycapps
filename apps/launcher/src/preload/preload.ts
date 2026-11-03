import { contextBridge, ipcRenderer, webUtils } from "electron";

type Listener<T> = (payload: T) => void;

function on<T>(channel: string, cb: Listener<T>): () => void {
  const handler = (_: unknown, payload: T) => cb(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

contextBridge.exposeInMainWorld("launcher", {
  getState: () => ipcRenderer.invoke("state:get"),
  updateSettings: (patch: unknown) => ipcRenderer.invoke("settings:update", patch),
  setSecret: (name: string, value: string | null) => ipcRenderer.invoke("secret:set", name, value),
  runPrompt: (prompt: string, opts?: { voice?: boolean }) => ipcRenderer.invoke("agent:run", prompt, opts),
  listModels: () => ipcRenderer.invoke("models:list"),
  cancel: () => ipcRenderer.invoke("agent:cancel"),
  clearHistory: () => ipcRenderer.invoke("history:clear"),
  pickFolder: () => ipcRenderer.invoke("folder:pick"),
  addAllowedFolder: () => ipcRenderer.invoke("folder:add-allowed"),
  pathForFile: (file: File) => webUtils.getPathForFile(file),
  planFolder: (folder: string, prompt: string, preset: "type" | "prompt") =>
    ipcRenderer.invoke("folder:plan", folder, prompt, preset),
  applyPlan: (id: string, selected: string[]) => ipcRenderer.invoke("folder:apply", id, selected),
  undoOrganize: () => ipcRenderer.invoke("folder:undo"),
  ensureMic: () => ipcRenderer.invoke("mic:ensure"),
  transcribe: (audio: ArrayBuffer, mime: string, opts?: { localOnly?: boolean }) => ipcRenderer.invoke("voice:transcribe", audio, mime, opts),
  voiceStatus: () => ipcRenderer.invoke("voice:status"),
  speak: (text: string) => ipcRenderer.invoke("voice:speak", text),
  stopSpeech: () => ipcRenderer.invoke("voice:stop"),
  parseVoice: (kind: string, text: string, arg?: unknown) => ipcRenderer.invoke("voice:parse", kind, text, arg),
  wake: () => ipcRenderer.invoke("ui:wake"),
  onHidden: (cb: Listener<void>) => on("ui:hidden", cb),
  answerAsk: (id: string, answer: string | null) => ipcRenderer.invoke("ask:answer", id, answer),
  getUpdate: () => ipcRenderer.invoke("update:get"),
  runUpdate: () => ipcRenderer.invoke("update:run"),
  resetConversation: () => ipcRenderer.invoke("agent:reset"),
  openLink: (url: string) => ipcRenderer.invoke("link:open", url),
  answerConfirm: (id: string, ok: boolean) => ipcRenderer.invoke("confirm:answer", id, ok),
  hide: () => ipcRenderer.invoke("ui:hide"),
  quit: () => ipcRenderer.invoke("app:quit"),
  reload: () => ipcRenderer.invoke("app:reload"),
  greeting: () => ipcRenderer.invoke("voice:greeting"),
  onReload: (cb: Listener<{ text: string; error: boolean }>) => on("ui:reload", cb),
  onShown: (cb: Listener<void>) => on("ui:shown", cb),
  onToggleDictation: (cb: Listener<void>) => on("ui:toggle-dictation", cb),
  onNotice: (cb: Listener<string>) => on("ui:notice", cb),
  onOpenSettings: (cb: Listener<void>) => on("ui:open-settings", cb),
  onAsk: (cb: Listener<unknown>) => on("ask:request", cb),
  onConfirm: (cb: Listener<unknown>) => on("confirm:request", cb),
  onAgentEvent: (cb: Listener<unknown>) => on("agent:event", cb),
});
