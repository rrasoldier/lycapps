export interface TranscribeConfig {
  baseUrl: string;
  model: string;
  apiKey: string;
  language?: string;
  fetchImpl?: typeof fetch;
}

/** Transcrit un enregistrement audio via l'endpoint compatible OpenAI /audio/transcriptions (Whisper). */
export async function transcribeAudio(audio: Uint8Array, mimeType: string, cfg: TranscribeConfig): Promise<string> {
  const ext = mimeType.includes("mp4") ? "mp4" : mimeType.includes("ogg") ? "ogg" : mimeType.includes("wav") ? "wav" : "webm";
  const form = new FormData();
  form.append("file", new Blob([audio as unknown as ArrayBuffer], { type: mimeType || "audio/webm" }), `dictation.${ext}`);
  form.append("model", cfg.model);
  if (cfg.language) form.append("language", cfg.language);
  const res = await (cfg.fetchImpl ?? fetch)(`${cfg.baseUrl.replace(/\/+$/, "")}/audio/transcriptions`, {
    method: "POST",
    headers: { authorization: `Bearer ${cfg.apiKey}` },
    body: form,
  });
  if (!res.ok) throw new Error(`Erreur de transcription ${res.status} : ${(await res.text().catch(() => "")).slice(0, 300)}`);
  const data = (await res.json()) as { text?: string };
  return (data.text ?? "").trim();
}
