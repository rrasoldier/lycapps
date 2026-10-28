const api = window.launcher;

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} introuvable`);
  return el as T;
};

const card = $("card");
const promptEl = $<HTMLInputElement>("prompt");
const outputEl = $("output");
const planEl = $("plan");
const settingsEl = $("settings");
const hintEl = $("hint");
const folderChip = $("folder-chip");
const folderName = $("folder-name");
const micBtn = $<HTMLButtonElement>("mic-btn");
const confirmEl = $("confirm");

let state: LauncherState;
let folder: string | null = null;
let busy = false;
let historyIdx = -1;
let draft = "";
let currentPlanId: string | null = null;
let pendingConfirm: ConfirmView | null = null;
let canUndo = false;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function fit(): void {
  requestAnimationFrame(() => void api.resize(card.scrollHeight + 14));
}

function setHint(text: string | null): void {
  hintEl.hidden = !text;
  hintEl.textContent = text ?? "";
  fit();
}

function line(cls: string, text: string): void {
  outputEl.hidden = false;
  outputEl.appendChild(el("div", `line ${cls}`, text));
  outputEl.scrollTop = outputEl.scrollHeight;
  fit();
}

function resetOutput(): void {
  outputEl.replaceChildren();
  outputEl.hidden = true;
  planEl.replaceChildren();
  planEl.hidden = true;
  currentPlanId = null;
  canUndo = false;
}

function describeEvent(e: AgentEventView): void {
  switch (e.type) {
    case "tool_call":
      line("tool", `▶ ${e.name}(${Object.entries(e.args).map(([k, v]) => `${k}=${JSON.stringify(v).slice(0, 80)}`).join(", ")})`);
      break;
    case "tool_result":
      line(e.ok ? "ok" : "err", `${e.ok ? "✓" : "✗"} ${e.output.slice(0, 400)}`);
      break;
    case "message":
      line("final", e.text);
      break;
    case "error":
      line("err", e.text);
      break;
  }
}

function setFolder(path: string | null): void {
  folder = path;
  folderChip.hidden = !path;
  folderName.textContent = path ? path.split("/").filter(Boolean).pop() ?? path : "";
  folderName.title = path ?? "";
  promptEl.placeholder = path ? "Comment ranger ? (⏎ aperçu · ⌘⏎ par type)" : "Que puis-je faire pour vous ?";
  setHint(path ? "Mode dossier : aperçu uniquement, rien n'est modifié avant votre confirmation." : null);
}

async function submit(preset: "prompt" | "type"): Promise<void> {
  const text = promptEl.value.trim();
  if (busy) return;
  if (!folder && !text) return;
  resetOutput();
  setBusy(true);
  try {
    if (folder) {
      line("tool", `Analyse de ${folder}…`);
      const r = await api.planFolder(folder, text, preset);
      outputEl.replaceChildren();
      outputEl.hidden = true;
      if (!r.ok) return line("err", r.error);
      renderPlan(r.id, r.plan);
    } else {
      state = { ...state, history: [...state.history.filter((h) => h !== text), text] };
      historyIdx = -1;
      const r = await api.runPrompt(text);
      if (!r.ok) line("err", r.text);
    }
  } finally {
    setBusy(false);
  }
}

function setBusy(b: boolean): void {
  busy = b;
  promptEl.disabled = b;
  if (!b) promptEl.focus();
  setHint(b ? "En cours… (Échap pour annuler)" : folder ? "Mode dossier : aperçu uniquement, rien n'est modifié avant votre confirmation." : null);
}

function renderPlan(id: string, plan: PlanView): void {
  currentPlanId = id;
  planEl.replaceChildren();
  planEl.hidden = false;
  planEl.appendChild(el("div", "line", `${plan.summary} — ${plan.moves.length} déplacement(s) proposé(s). Aucune modification pour l'instant (aperçu).`));
  const boxes: Array<{ cb: HTMLInputElement; from: string }> = [];
  const list = el("div");
  list.style.maxHeight = "260px";
  list.style.overflow = "auto";
  for (const m of plan.moves) {
    const row = el("label", "move");
    const cb = el("input");
    cb.type = "checkbox";
    cb.checked = true;
    boxes.push({ cb, from: m.from });
    row.append(cb, el("span", "", m.fromRel), el("span", "", "→"), el("span", "to", m.toRel));
    list.appendChild(row);
  }
  planEl.appendChild(list);
  for (const s of plan.skipped) planEl.appendChild(el("div", "line err", `Ignoré : ${s.name} (${s.reason})`));
  const row = el("div", "row");
  const cancel = el("button", "", "Annuler");
  cancel.onclick = () => resetOutput();
  const apply = el("button", "primary", "Appliquer…");
  apply.disabled = plan.moves.length === 0;
  apply.onclick = async () => {
    const selected = boxes.filter((b) => b.cb.checked).map((b) => b.from);
    apply.disabled = true;
    const r = await api.applyPlan(id, selected);
    if (!r.ok) {
      apply.disabled = false;
      return line("err", r.error);
    }
    planEl.replaceChildren();
    planEl.hidden = true;
    line("ok", `✓ ${r.result.moved.length} fichier(s) déplacé(s).`);
    for (const f of r.result.failed) line("err", `✗ ${f.from} : ${f.reason}`);
    if (r.result.moved.length) addUndoButton();
  };
  row.append(cancel, apply);
  planEl.appendChild(row);
  fit();
}

function addUndoButton(): void {
  canUndo = true;
  const row = el("div", "row");
  const undo = el("button", "", "Annuler ce rangement");
  undo.onclick = async () => {
    const r = await api.undoOrganize();
    row.remove();
    if (!r.ok) return line("err", r.error);
    line("ok", `↩ ${r.result.moved.length} fichier(s) remis à leur place.`);
    for (const f of r.result.failed) line("err", `✗ ${f.from} : ${f.reason}`);
  };
  row.appendChild(undo);
  outputEl.appendChild(row);
  fit();
}

/* Confirmations */
api.onConfirm((req) => {
  pendingConfirm = req;
  $("confirm-title").textContent = req.title;
  $("confirm-detail").textContent = req.detail;
  confirmEl.className = req.risk === "danger" ? "danger" : "";
  $("confirm-yes").className = req.risk === "danger" ? "danger" : "primary";
  confirmEl.hidden = false;
  fit();
  $("confirm-yes").focus();
});

function answerConfirm(ok: boolean): void {
  if (!pendingConfirm) return;
  const id = pendingConfirm.id;
  pendingConfirm = null;
  confirmEl.hidden = true;
  void api.answerConfirm(id, ok);
  fit();
  promptEl.focus();
}
$("confirm-yes").onclick = () => answerConfirm(true);
$("confirm-no").onclick = () => answerConfirm(false);

api.onAgentEvent(describeEvent);

/* Entrée clavier + historique */
promptEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    void submit(folder && (e.metaKey || e.ctrlKey) ? "type" : "prompt");
  } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
    const h = state.history;
    if (!h.length) return;
    e.preventDefault();
    if (historyIdx === -1) draft = promptEl.value;
    if (e.key === "ArrowUp") historyIdx = Math.min(historyIdx + 1, h.length - 1);
    else historyIdx = Math.max(historyIdx - 1, -1);
    promptEl.value = historyIdx === -1 ? draft : h[h.length - 1 - historyIdx];
  } else {
    historyIdx = -1;
  }
});

document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  e.preventDefault();
  if (pendingConfirm) return answerConfirm(false);
  if (!settingsEl.hidden) return closeSettings();
  if (busy) return void api.cancel();
  if (recorder) return stopRecording();
  if (folder || !outputEl.hidden || !planEl.hidden) {
    resetOutput();
    setFolder(null);
    return;
  }
  void api.hide();
});

/* Dossier : sélection + glisser-déposer */
$("folder-btn").onclick = async () => {
  const p = await api.pickFolder();
  if (p) setFolder(p);
  promptEl.focus();
};
$("folder-clear").onclick = () => setFolder(null);

document.addEventListener("dragover", (e) => {
  e.preventDefault();
  document.body.classList.add("drag");
});
document.addEventListener("dragleave", () => document.body.classList.remove("drag"));
document.addEventListener("drop", (e) => {
  e.preventDefault();
  document.body.classList.remove("drag");
  const file = e.dataTransfer?.files[0];
  if (!file) return;
  const p = api.pathForFile(file);
  if (p) setFolder(p);
  promptEl.focus();
});

/* Voix */
let recorder: MediaRecorder | null = null;
let recordTimer: number | undefined;
let recordStart = 0;

async function startRecording(): Promise<void> {
  if (recorder) return;
  if (!(await api.ensureMic())) {
    return setHint("Micro refusé : autorisez Cursor Launcher dans Réglages Système → Confidentialité → Micro.");
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? "audio/webm;codecs=opus" : "";
    const chunks: Blob[] = [];
    const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    rec.ondataavailable = (ev) => ev.data.size && chunks.push(ev.data);
    rec.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());
      micBtn.classList.remove("active");
      window.clearTimeout(recordTimer);
      recorder = null;
      const blob = new Blob(chunks, { type: rec.mimeType || "audio/webm" });
      if (blob.size < 1000) return setHint("Enregistrement trop court.");
      setHint("Transcription…");
      const r = await api.transcribe(await blob.arrayBuffer(), blob.type);
      if (!r.ok) return setHint(r.error);
      setHint(null);
      promptEl.value = `${promptEl.value}${promptEl.value && !promptEl.value.endsWith(" ") ? " " : ""}${r.text}`.trimStart();
      promptEl.focus();
    };
    rec.start();
    recorder = rec;
    recordStart = Date.now();
    micBtn.classList.add("active");
    setHint("🎙 J'écoute… (clic ou Échap pour terminer)");
    recordTimer = window.setTimeout(stopRecording, 90_000);
  } catch (err) {
    setHint(`Micro indisponible : ${err instanceof Error ? err.message : String(err)}`);
  }
}

function stopRecording(): void {
  if (recorder && recorder.state !== "inactive") recorder.stop();
}

/* Clic = bascule ; maintien (> 500 ms) = push-to-talk, relâcher arrête. */
let startedByThisPress = false;
micBtn.addEventListener("pointerdown", async () => {
  if (recorder) {
    stopRecording();
    startedByThisPress = false;
    return;
  }
  startedByThisPress = true;
  await startRecording();
});
micBtn.addEventListener("pointerup", () => {
  if (startedByThisPress && recorder && Date.now() - recordStart > 500) stopRecording();
  startedByThisPress = false;
});
api.onToggleDictation(() => (recorder ? stopRecording() : void startRecording()));

/* Réglages */
function closeSettings(): void {
  settingsEl.hidden = true;
  promptEl.focus();
  fit();
}
$("settings-btn").onclick = () => (settingsEl.hidden ? openSettings() : closeSettings());
api.onOpenSettings(openSettings);

function field(label: string, input: HTMLElement, note?: string): HTMLLabelElement {
  const l = el("label");
  l.append(el("span", "", label), input);
  if (note) {
    const s = el("small", "", note);
    s.style.gridColumn = "2";
    l.appendChild(s);
  }
  return l;
}

function textInput(value: string, placeholder = ""): HTMLInputElement {
  const i = el("input");
  i.type = "text";
  i.value = value;
  i.placeholder = placeholder;
  return i;
}

function openSettings(): void {
  settingsEl.hidden = false;
  settingsEl.replaceChildren();
  const s = state.settings;
  const messages = el("div", "line");

  const provider = el("select");
  for (const p of state.providers) provider.add(new Option(p.label, p.id, false, p.id === s.provider));
  const baseUrl = textInput(s.baseUrl, state.defaults.baseUrl);
  const model = textInput(s.model, state.defaults.model);
  const shortcut = textInput(s.shortcut, "Alt+Space");
  const dictation = textInput(s.dictationShortcut, "Alt+Shift+Space");
  const projects = textInput(s.projectsRoot);
  const apiKey = el("input");
  apiKey.type = "password";
  apiKey.placeholder = state.llmKeySource === "none" ? "Clé API (stockée dans le trousseau)" : `Clé déjà définie (${state.llmKeySource})`;
  const sttKey = el("input");
  sttKey.type = "password";
  sttKey.placeholder = state.hasTranscriptionKey ? "Clé déjà disponible" : "Clé Whisper (par défaut : OPENAI_API_KEY)";
  const login = el("input");
  login.type = "checkbox";
  login.checked = s.launchAtLogin;

  settingsEl.append(
    field("Fournisseur", provider),
    field("URL de base", baseUrl),
    field("Modèle", model),
    field("Clé API", apiKey, state.secretsAvailable ? "Variables d'environnement prioritaires (LAUNCHER_API_KEY, OPENAI_API_KEY…)." : "Trousseau indisponible : utilisez une variable d'environnement."),
    field("Clé dictée (Whisper)", sttKey),
    field("Raccourci principal", shortcut, "Format Electron, ex. Alt+Space, CommandOrControl+Shift+Space"),
    field("Raccourci dictée", dictation),
    field("Dossier des projets", projects),
    field("Lancer au démarrage", login),
  );

  const rootsBox = el("div", "roots");
  const renderRoots = () => {
    rootsBox.replaceChildren(el("div", "", "Dossiers autorisés pour l'agent :"));
    for (const r of state.settings.allowedRoots) {
      const row = el("div");
      row.append(el("span", "", r));
      const rm = el("button", "", "Retirer");
      rm.onclick = async () => {
        const res = await api.updateSettings({ allowedRoots: state.settings.allowedRoots.filter((x) => x !== r) });
        state = res.state;
        renderRoots();
      };
      row.appendChild(rm);
      rootsBox.appendChild(row);
    }
    const add = el("button", "", "Ajouter un dossier…");
    add.onclick = async () => {
      state = await api.addAllowedFolder();
      renderRoots();
    };
    rootsBox.appendChild(add);
    fit();
  };
  renderRoots();
  settingsEl.append(rootsBox);

  const row = el("div", "row");
  const clear = el("button", "", "Effacer l'historique");
  clear.onclick = async () => {
    await api.clearHistory();
    state = { ...state, history: [] };
    messages.textContent = "Historique effacé.";
  };
  const save = el("button", "primary", "Enregistrer");
  save.onclick = async () => {
    const errs: string[] = [];
    if (apiKey.value) {
      const r = await api.setSecret("llm", apiKey.value);
      if (r.error) errs.push(r.error);
      state = r.state;
    }
    if (sttKey.value) {
      const r = await api.setSecret("transcription", sttKey.value);
      if (r.error) errs.push(r.error);
      state = r.state;
    }
    const res = await api.updateSettings({
      provider: provider.value,
      baseUrl: baseUrl.value.trim(),
      model: model.value.trim(),
      shortcut: shortcut.value.trim(),
      dictationShortcut: dictation.value.trim(),
      projectsRoot: projects.value.trim(),
      launchAtLogin: login.checked,
    });
    state = res.state;
    errs.push(...res.errors);
    messages.textContent = errs.length ? errs.join("\n") : "Réglages enregistrés.";
    messages.className = errs.length ? "line err" : "line ok";
    fit();
  };
  row.append(clear, save);
  settingsEl.append(messages, row);
  fit();
}

api.onShown(() => {
  promptEl.focus();
  promptEl.select();
  void api.getState().then((s) => (state = s));
});

async function init(): Promise<void> {
  state = await api.getState();
  if (state.llmKeySource === "none" && state.settings.provider !== "ollama" && state.settings.provider !== "custom") {
    setHint("Aucune clé API : ouvrez les réglages (⚙) ou définissez OPENAI_API_KEY.");
  }
  promptEl.focus();
  fit();
}
void init();
