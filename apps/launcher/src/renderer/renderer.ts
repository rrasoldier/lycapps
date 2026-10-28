import { parseMarkdown, type Block, type Inline } from "./markdown.js";

const api = window.launcher;

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} introuvable`);
  return el as T;
};

const card = $("card");
const messagesEl = $("messages");
const promptEl = $<HTMLTextAreaElement>("prompt");
const settingsEl = $("settings");
const hintEl = $("hint");
const folderChip = $("folder-chip");
const folderName = $("folder-name");
const micBtn = $<HTMLButtonElement>("mic-btn");
const sendBtn = $<HTMLButtonElement>("send-btn");
const progressEl = $("progress");
const progressText = $("progress-text");

const CHAT_HEIGHT = 680;
const DEFAULT_PLACEHOLDER = "Que puis-je faire pour vous ?";
const FOLDER_HINT = "Mode dossier : aperçu uniquement, rien n'est modifié avant votre confirmation.";

interface PendingAsk {
  view: AskView;
  card: HTMLElement;
}
interface PendingConfirm {
  view: ConfirmView;
  card: HTMLElement;
}

let state: LauncherState;
let folder: string | null = null;
let busy = false;
let historyIdx = -1;
let draft = "";
let pendingAsk: PendingAsk | null = null;
let pendingConfirm: PendingConfirm | null = null;
let actions = 0;
let startedAt = 0;
let stepText = "";
let ticker: number | undefined;
let hideProgressTimer: number | undefined;
let stepsEl: HTMLElement | null = null;
let openSteps: HTMLElement[] = [];
let gotMessage = false;
const sendIcon = sendBtn.firstElementChild;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

/* Taille de la fenêtre et mode (compact = barre seule, chat = conversation) */
function updateMode(): void {
  const compact = messagesEl.childElementCount === 0 && settingsEl.hidden;
  card.classList.toggle("compact", compact);
}

function fit(): void {
  updateMode();
  requestAnimationFrame(() => {
    const compact = card.classList.contains("compact");
    void api.resize(compact ? card.scrollHeight + 14 : CHAT_HEIGHT);
  });
}

function setHint(text: string | null): void {
  hintEl.hidden = !text;
  hintEl.textContent = text ?? "";
  fit();
}

function baseHint(): string | null {
  if (pendingAsk) return null;
  if (busy) return "Échap pour interrompre";
  return folder ? FOLDER_HINT : null;
}

function scrollDown(): void {
  requestAnimationFrame(() => (messagesEl.scrollTop = messagesEl.scrollHeight));
}

function autosize(): void {
  promptEl.style.height = "auto";
  promptEl.style.height = `${Math.min(promptEl.scrollHeight, 120)}px`;
  fit();
}

/* Rendu Markdown (via l'arbre du parseur : jamais de HTML brut) */
function renderInlines(parent: HTMLElement, inlines: Inline[]): void {
  for (const n of inlines) {
    switch (n.t) {
      case "text":
        parent.append(n.text);
        break;
      case "code":
        parent.append(el("code", "", n.text));
        break;
      case "strong":
      case "em": {
        const e = el(n.t === "strong" ? "strong" : "em");
        renderInlines(e, n.children);
        parent.append(e);
        break;
      }
      case "link": {
        const a = el("a");
        a.title = n.href;
        a.addEventListener("click", (ev) => {
          ev.preventDefault();
          void api.openLink(n.href);
        });
        renderInlines(a, n.children);
        parent.append(a);
        break;
      }
    }
  }
}

function renderBlock(b: Block): HTMLElement {
  switch (b.t) {
    case "heading": {
      const h = el(`h${Math.min(b.level + 1, 4)}` as "h2" | "h3" | "h4");
      renderInlines(h, b.inlines);
      return h;
    }
    case "paragraph": {
      const p = el("p");
      renderInlines(p, b.inlines);
      return p;
    }
    case "code": {
      const pre = el("pre");
      pre.append(el("code", "", b.text));
      return pre;
    }
    case "list": {
      const list = el(b.ordered ? "ol" : "ul");
      for (const item of b.items) {
        const li = el("li");
        renderInlines(li, item);
        list.append(li);
      }
      return list;
    }
    case "table": {
      const table = el("table");
      const head = el("tr");
      for (const c of b.header) {
        const th = el("th");
        renderInlines(th, c);
        head.append(th);
      }
      const thead = el("thead");
      thead.append(head);
      table.append(thead);
      const body = el("tbody");
      for (const r of b.rows) {
        const tr = el("tr");
        for (const c of r) {
          const td = el("td");
          renderInlines(td, c);
          tr.append(td);
        }
        body.append(tr);
      }
      table.append(body);
      return table;
    }
    case "quote": {
      const q = el("blockquote");
      renderInlines(q, b.inlines);
      return q;
    }
    case "hr":
      return el("hr");
  }
}

function markdownInto(parent: HTMLElement, text: string): void {
  parent.classList.add("md");
  for (const b of parseMarkdown(text)) parent.append(renderBlock(b));
}

/* Messages */
function addMessage(kind: "user" | "assistant" | "error" | "note", text: string, markdown = false): HTMLElement {
  const row = el("div", `msg ${kind}`);
  const bubble = el("div", "bubble");
  if (markdown) markdownInto(bubble, text);
  else bubble.textContent = text;
  row.append(bubble);
  messagesEl.append(row);
  stepsEl = null;
  fit();
  scrollDown();
  return row;
}

function addCard(node: HTMLElement): void {
  const row = el("div", "msg assistant");
  node.classList.add("card");
  row.append(node);
  messagesEl.append(row);
  stepsEl = null;
  fit();
  scrollDown();
}

/* Étapes de l'agent (outils) */
function short(v: unknown, max = 70): string {
  const t = typeof v === "string" ? v : JSON.stringify(v);
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

function describeCall(name: string, args: Record<string, unknown>): string {
  switch (name) {
    case "list_files": return `Liste le dossier ${short(args.path)}`;
    case "read_file": return `Lit ${short(args.path)}`;
    case "write_file": return `Écrit ${short(args.path)}`;
    case "move_file": return `Déplace ${short(args.from)} → ${short(args.to)}`;
    case "trash_file": return `Met à la Corbeille ${short(args.path)}`;
    case "run_shell": return `Exécute : ${short(args.command, 90)}`;
    case "open_app": return `Ouvre l'application ${short(args.name)}`;
    case "open_url": return `Ouvre ${short(args.url)}`;
    case "create_project": return `Crée le projet ${short(args.name)}`;
    default: return `${name}(${Object.entries(args).map(([k, v]) => `${k}=${short(v, 40)}`).join(", ")})`;
  }
}

function addStep(label: string): void {
  if (!stepsEl) {
    const row = el("div", "msg steps");
    stepsEl = el("div", "steps-box");
    row.append(stepsEl);
    messagesEl.append(row);
  }
  const step = el("div", "step");
  step.append(el("span", "dot"), el("span", "label", label));
  stepsEl.append(step);
  openSteps.push(step);
  fit();
  scrollDown();
}

function finishStep(ok: boolean, output: string): void {
  const step = openSteps.shift();
  if (!step) return;
  step.classList.add(ok ? "ok" : "fail");
  const text = output.trim();
  if (text) {
    const details = el("details");
    details.append(el("summary", "", ok ? "résultat" : "erreur"), el("pre", "", text.slice(0, 1500)));
    step.querySelector(".label")?.after(details);
  }
}

/* Progression */
function formatElapsed(ms: number): string {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function renderProgress(): void {
  const elapsed = formatElapsed(Date.now() - startedAt);
  const count = actions ? ` · ${actions} action${actions > 1 ? "s" : ""}` : "";
  const waiting = pendingConfirm
    ? "⏸ En attente de votre confirmation"
    : pendingAsk
      ? "⏸ En attente de votre réponse"
      : stepText || "Démarrage…";
  progressText.textContent = `${elapsed}${count} — ${waiting}`;
  progressEl.classList.toggle("paused", Boolean(pendingConfirm || pendingAsk));
  fit();
}

function startProgress(label: string): void {
  window.clearTimeout(hideProgressTimer);
  actions = 0;
  startedAt = Date.now();
  stepText = label;
  progressEl.hidden = false;
  progressEl.className = "";
  window.clearInterval(ticker);
  ticker = window.setInterval(renderProgress, 1000);
  renderProgress();
}

function stopProgress(ok: boolean): void {
  window.clearInterval(ticker);
  const elapsed = formatElapsed(Date.now() - startedAt);
  progressEl.className = ok ? "done" : "";
  progressText.textContent = `${ok ? "Terminé" : "Arrêté"} en ${elapsed}${actions ? ` · ${actions} action${actions > 1 ? "s" : ""}` : ""}`;
  hideProgressTimer = window.setTimeout(() => {
    if (!busy) progressEl.hidden = true;
    fit();
  }, ok ? 5000 : 2500);
  fit();
}

function onAgentEvent(e: AgentEventView): void {
  switch (e.type) {
    case "tool_call":
      if (e.name === "ask_user") break;
      actions++;
      stepText = describeCall(e.name, e.args);
      addStep(stepText);
      renderProgress();
      break;
    case "tool_result":
      if (e.name === "ask_user") break;
      finishStep(e.ok, e.output);
      stepText = e.ok ? "Réflexion sur le résultat…" : "Une étape a échoué, l'agent réessaie…";
      renderProgress();
      break;
    case "progress":
      stepText = e.text.length > 160 ? `${e.text.slice(0, 160)}…` : e.text;
      renderProgress();
      break;
    case "message":
      gotMessage = true;
      addMessage("assistant", e.text, true);
      break;
    case "error":
      addMessage("error", e.text);
      break;
  }
}
api.onAgentEvent(onAgentEvent);

/* Dossier */
function setFolder(path: string | null): void {
  folder = path;
  folderChip.hidden = !path;
  folderName.textContent = path ? path.split("/").filter(Boolean).pop() ?? path : "";
  folderName.title = path ?? "";
  promptEl.placeholder = path ? "Comment ranger ? (⏎ aperçu · ⌘⏎ par type)" : DEFAULT_PLACEHOLDER;
  setHint(baseHint());
}

function updateSendButton(): void {
  const stop = busy && !pendingAsk;
  sendBtn.classList.toggle("stop", stop);
  sendBtn.title = stop ? "Interrompre (Échap)" : "Envoyer (Entrée)";
  if (stop) sendBtn.replaceChildren(el("span", "stop-square"));
  else if (sendIcon) sendBtn.replaceChildren(sendIcon);
}

function setBusy(b: boolean): void {
  busy = b;
  card.classList.toggle("busy", b);
  promptEl.disabled = b && !pendingAsk?.view.allowText;
  updateSendButton();
  if (!b) promptEl.focus();
  setHint(baseHint());
}

async function submit(preset: "prompt" | "type"): Promise<void> {
  const text = promptEl.value.trim();
  if (pendingAsk) {
    if (text && pendingAsk.view.allowText) answerAsk(text);
    return;
  }
  if (busy || (!folder && !text)) return;

  promptEl.value = "";
  autosize();
  historyIdx = -1;
  const target = folder;
  addMessage("user", target ? `📁 ${target.split("/").filter(Boolean).pop() ?? target}${text ? ` — ${text}` : " — ranger par type"}` : text);
  setBusy(true);
  startProgress(target ? "Analyse du dossier…" : "Envoi de la demande…");
  gotMessage = false;
  stepsEl = null;
  let ok = false;
  try {
    if (target) {
      const r = await api.planFolder(target, text, preset);
      setFolder(null);
      if (r.ok) {
        ok = true;
        renderPlan(r.id, r.plan);
      } else addMessage("error", r.error);
    } else {
      state = { ...state, history: [...state.history.filter((h) => h !== text), text] };
      const r = await api.runPrompt(text);
      ok = r.ok;
      if (!r.ok) addMessage("error", r.text);
      else if (!gotMessage && r.text) addMessage("assistant", r.text, true);
    }
  } finally {
    openSteps = [];
    stopProgress(ok);
    setBusy(false);
  }
}

/* Aperçu du rangement */
function renderPlan(id: string, plan: PlanView): void {
  const box = el("div", "plan");
  box.append(el("h3", "", "Aperçu du rangement"));
  const sub = el("div", "sub", `${plan.summary} — ${plan.moves.length} déplacement(s) proposé(s). Rien n'est modifié pour l'instant.`);
  box.append(sub);
  const boxes: Array<{ cb: HTMLInputElement; from: string }> = [];
  const list = el("div", "plan-list");
  for (const m of plan.moves) {
    const row = el("label", "move");
    const cb = el("input");
    cb.type = "checkbox";
    cb.checked = true;
    boxes.push({ cb, from: m.from });
    row.append(cb, el("span", "", m.fromRel), el("span", "", "→"), el("span", "to", m.toRel));
    list.append(row);
  }
  box.append(list);
  for (const s of plan.skipped) box.append(el("div", "line err", `Ignoré : ${s.name} (${s.reason})`));

  const row = el("div", "row");
  const cancel = el("button", "", "Annuler");
  const apply = el("button", "primary", "Appliquer…");
  apply.disabled = plan.moves.length === 0;
  cancel.onclick = () => {
    box.classList.add("done");
    row.replaceChildren(el("span", "sub", "Aperçu abandonné."));
  };
  apply.onclick = async () => {
    const selected = boxes.filter((b) => b.cb.checked).map((b) => b.from);
    apply.disabled = true;
    const r = await api.applyPlan(id, selected);
    if (!r.ok) {
      apply.disabled = false;
      return addMessage("error", r.error);
    }
    box.classList.add("done");
    row.replaceChildren();
    const lines = [`✓ ${r.result.moved.length} fichier(s) déplacé(s).`, ...r.result.failed.map((f) => `✗ ${f.from} : ${f.reason}`)];
    row.append(el("span", "sub", lines.join("\n")));
    if (r.result.moved.length) row.append(undoButton());
  };
  row.append(cancel, apply);
  box.append(row);
  addCard(box);
}

function undoButton(): HTMLButtonElement {
  const undo = el("button", "", "Annuler ce rangement");
  undo.onclick = async () => {
    undo.disabled = true;
    const r = await api.undoOrganize();
    undo.remove();
    addMessage(r.ok ? "note" : "error", r.ok ? `↩ ${r.result.moved.length} fichier(s) remis à leur place.` : r.error);
  };
  return undo;
}

/* Questions de l'agent : boutons ou texte libre */
function answerAsk(answer: string | null): void {
  if (!pendingAsk) return;
  const { view, card: cardEl } = pendingAsk;
  pendingAsk = null;
  cardEl.classList.add("done");
  for (const b of cardEl.querySelectorAll("button")) {
    b.disabled = true;
    if (b.dataset.value === answer) b.classList.add("picked");
  }
  cardEl.querySelector(".sub")?.remove();
  void api.answerAsk(view.id, answer);
  if (answer !== null) addMessage("user", answer);
  promptEl.value = "";
  promptEl.placeholder = folder ? "Comment ranger ?" : DEFAULT_PLACEHOLDER;
  promptEl.disabled = busy;
  updateSendButton();
  autosize();
  if (busy) renderProgress();
  setHint(baseHint());
}

api.onAsk((view) => {
  const box = el("div", "ask");
  const title = el("div", "ask-q");
  markdownInto(title, view.question);
  box.classList.add("ask-card");
  box.append(title);
  if (view.choices.length) {
    const row = el("div", "row");
    view.choices.forEach((c, i) => {
      const b = el("button", "choice");
      b.dataset.value = c;
      b.append(el("kbd", "", String(i + 1)), c);
      b.onclick = () => answerAsk(c);
      row.append(b);
    });
    box.append(row);
  }
  if (view.allowText) box.append(el("div", "sub", view.choices.length ? "Ou répondez par écrit ci-dessous." : "Répondez par écrit ci-dessous."));
  const row = el("div", "msg assistant");
  const wrap = el("div", "card ask");
  wrap.append(box);
  row.append(wrap);
  messagesEl.append(row);
  stepsEl = null;
  pendingAsk = { view, card: wrap };
  promptEl.disabled = !view.allowText;
  promptEl.placeholder = view.allowText ? "Votre réponse…" : "Choisissez une option ci-dessus";
  updateSendButton();
  setHint(null);
  if (busy) renderProgress();
  fit();
  scrollDown();
  if (view.allowText) promptEl.focus();
});

/* Confirmations */
api.onConfirm((req) => {
  const wrap = el("div", `card confirm${req.risk === "danger" ? " danger-risk" : ""}`);
  wrap.append(el("h3", "", `${req.risk === "danger" ? "⚠ " : "🔒 "}${req.title}`));
  if (req.detail) wrap.append(el("pre", "detail", req.detail));
  const row = el("div", "row end");
  const no = el("button", "", "Refuser");
  const yes = el("button", req.risk === "danger" ? "danger" : "primary", "Autoriser");
  no.dataset.role = "confirm-no";
  yes.dataset.role = "confirm-yes";
  no.onclick = () => answerConfirm(false);
  yes.onclick = () => answerConfirm(true);
  row.append(no, yes);
  wrap.append(row);
  const outer = el("div", "msg assistant");
  outer.append(wrap);
  messagesEl.append(outer);
  stepsEl = null;
  pendingConfirm = { view: req, card: wrap };
  if (busy) renderProgress();
  fit();
  scrollDown();
  (req.risk === "danger" ? no : yes).focus();
});

function answerConfirm(ok: boolean): void {
  if (!pendingConfirm) return;
  const { view, card: cardEl } = pendingConfirm;
  pendingConfirm = null;
  cardEl.classList.add("done");
  const row = cardEl.querySelector(".row");
  row?.replaceChildren(el("span", "sub", ok ? "✓ Autorisé" : "✗ Refusé"));
  void api.answerConfirm(view.id, ok);
  if (busy) renderProgress();
  fit();
  promptEl.focus();
}

/* Clavier */
promptEl.addEventListener("input", () => {
  autosize();
});

promptEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    void submit(folder && (e.metaKey || e.ctrlKey) ? "type" : "prompt");
  } else if ((e.key === "ArrowUp" || e.key === "ArrowDown") && !promptEl.value.includes("\n")) {
    const h = state.history;
    if (!h.length || pendingAsk) return;
    e.preventDefault();
    if (historyIdx === -1) draft = promptEl.value;
    if (e.key === "ArrowUp") historyIdx = Math.min(historyIdx + 1, h.length - 1);
    else historyIdx = Math.max(historyIdx - 1, -1);
    promptEl.value = historyIdx === -1 ? draft : h[h.length - 1 - historyIdx];
    autosize();
  } else if (e.key.length === 1 && !e.metaKey && !e.ctrlKey) {
    historyIdx = -1;
  }
});

document.addEventListener("keydown", (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "n") {
    e.preventDefault();
    void newConversation();
    return;
  }
  if (pendingAsk && promptEl.value === "" && /^[1-9]$/.test(e.key) && !e.metaKey && !e.ctrlKey) {
    const choice = pendingAsk.view.choices[Number(e.key) - 1];
    if (choice) {
      e.preventDefault();
      answerAsk(choice);
    }
    return;
  }
  if (e.key !== "Escape") return;
  e.preventDefault();
  if (pendingConfirm) return answerConfirm(false);
  if (pendingAsk) {
    answerAsk(null);
    return void api.cancel();
  }
  if (!settingsEl.hidden) return closeSettings();
  if (busy) return void api.cancel();
  if (recorder) return stopRecording();
  if (folder) return setFolder(null);
  void api.hide();
});

sendBtn.onclick = () => {
  if (busy && !pendingAsk) return void api.cancel();
  void submit("prompt");
};

async function newConversation(): Promise<void> {
  if (pendingConfirm) answerConfirm(false);
  if (pendingAsk) answerAsk(null);
  if (busy) await api.cancel();
  await api.resetConversation();
  messagesEl.replaceChildren();
  openSteps = [];
  stepsEl = null;
  progressEl.hidden = true;
  setFolder(null);
  closeSettings();
  fit();
}
$("new-btn").onclick = () => void newConversation();

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
      setHint(baseHint());
      promptEl.value = `${promptEl.value}${promptEl.value && !promptEl.value.endsWith(" ") ? " " : ""}${r.text}`.trimStart();
      autosize();
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

  const heading = el("h2", "", "Réglages");
  const closeBtn = el("button", "ghost", "Fermer");
  closeBtn.onclick = closeSettings;
  heading.append(closeBtn);

  const provider = el("select");
  for (const p of state.providers) provider.add(new Option(p.label, p.id, false, p.id === s.provider));
  const baseUrl = textInput(s.baseUrl, state.defaults.baseUrl);
  const model = textInput(s.model, state.defaults.model);
  const shortcut = textInput(s.shortcut, "Alt+Space");
  const dictation = textInput(s.dictationShortcut, "Alt+Shift+Space");
  const projects = textInput(s.projectsRoot);
  provider.onchange = () => {
    const preset = state.providers.find((p) => p.id === provider.value);
    baseUrl.value = "";
    model.value = "";
    baseUrl.placeholder = preset?.baseUrl ?? "";
    model.placeholder = preset?.defaultModel ?? "";
  };
  const modelsBtn = el("button", "", "Lister les modèles");
  const modelList = el("datalist");
  modelList.id = "model-list";
  model.setAttribute("list", "model-list");
  modelsBtn.onclick = async () => {
    messages.className = "line";
    messages.textContent = "Chargement des modèles…";
    const r = await api.listModels();
    if (!r.ok) {
      messages.className = "line err";
      messages.textContent = r.error;
      return;
    }
    modelList.replaceChildren(...r.models.map((m) => new Option(m.displayName, m.id)));
    messages.textContent = `${r.models.length} modèle(s) : cliquez dans le champ Modèle pour choisir.`;
  };
  const apiKey = el("input");
  apiKey.type = "password";
  apiKey.placeholder = state.llmKeySource === "none" ? "Clé API (stockée dans le trousseau)" : `Clé déjà définie (${state.llmKeySource})`;
  const sttKey = el("input");
  sttKey.type = "password";
  sttKey.placeholder = state.hasTranscriptionKey ? "Clé déjà disponible" : "Clé Whisper (par défaut : OPENAI_API_KEY)";
  const login = el("input");
  login.type = "checkbox";
  login.checked = s.launchAtLogin;
  const autoUpdate = el("input");
  autoUpdate.type = "checkbox";
  autoUpdate.checked = s.autoUpdate;
  const updateInfo = el("div", "update-info", "Vérification…");
  const updateBtn = el("button", "", "Vérifier / mettre à jour");
  const showUpdate = (u: UpdateView) => {
    updateBtn.disabled = Boolean(u.busy);
    const st = u.status;
    updateInfo.replaceChildren();
    if (u.busy) updateInfo.append(`⏳ ${u.busy}`);
    else if (!st) updateInfo.append("Pas encore vérifié.");
    else if (st.state === "up-to-date") updateInfo.append(`À jour (version ${st.version}).`);
    else if (st.state === "unavailable") updateInfo.append(st.reason);
    else {
      updateBtn.textContent = `Mettre à jour (${st.behind})`;
      updateInfo.append(`${st.behind} nouveauté(s) disponible(s) :`);
      const ul = el("ul");
      for (const t of st.subjects) ul.append(el("li", "", t));
      updateInfo.append(ul);
    }
  };
  updateBtn.onclick = async () => {
    updateBtn.disabled = true;
    updateInfo.textContent = "⏳ Mise à jour en cours (l'application redémarrera si une nouvelle version est installée)…";
    showUpdate(await api.runUpdate());
  };
  void api.getUpdate().then(showUpdate);

  settingsEl.append(
    heading,
    modelList,
    field("Fournisseur", provider),
    field("URL de base", baseUrl, "Ignorée par le fournisseur Cursor."),
    field("Modèle", model, "Fournisseur Cursor : « Lister les modèles » interroge le catalogue de votre compte (ex. modèles Claude)."),
    field("", modelsBtn),
    field("Clé API", apiKey, state.secretsAvailable ? "Variables d'environnement prioritaires (CURSOR_API_KEY, LAUNCHER_API_KEY, OPENAI_API_KEY…)." : "Trousseau indisponible : utilisez une variable d'environnement."),
    field("Clé dictée (Whisper)", sttKey),
    field("Raccourci principal", shortcut, "Format Electron, ex. Alt+Space, CommandOrControl+Shift+Space"),
    field("Raccourci dictée", dictation),
    field("Dossier des projets", projects),
    field("Lancer au démarrage", login),
    field("Mises à jour auto", autoUpdate, "Vérifie au démarrage (git pull + compilation) et redémarre si une nouvelle version est installée."),
    field("Version", updateInfo),
    field("", updateBtn),
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
      autoUpdate: autoUpdate.checked,
    });
    state = res.state;
    errs.push(...res.errors);
    messages.textContent = errs.length ? errs.join("\n") : "Réglages enregistrés.";
    messages.className = errs.length ? "line err" : "line ok";
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
    setHint("Aucune clé API : ouvrez les réglages (⚙) ou définissez CURSOR_API_KEY.");
  }
  promptEl.focus();
  fit();
}

if (location.hash === "#e2e") {
  (window as unknown as { __e2e: unknown }).__e2e = { setFolder };
}

void init();
