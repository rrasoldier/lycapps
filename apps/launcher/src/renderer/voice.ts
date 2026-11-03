import { Endpointer, SAMPLE_RATE, encodeWav, resampleLinear } from "./audio.js";

export type ListenReason = "speech" | "timeout" | "cancelled";

export interface ListenResult {
  reason: ListenReason;
  /** WAV 16 kHz mono prêt pour Whisper (uniquement si `reason === "speech"`). */
  wav: Uint8Array | null;
}

export interface Listening {
  result: Promise<ListenResult>;
  /** Termine tout de suite en gardant ce qui a été dit (clic sur le micro). */
  finish(): void;
  cancel(): void;
}

/**
 * Micro du navigateur : flux ouvert pour toute la durée d'une conversation, échantillons découpés en phrases par
 * l'`Endpointer`. Rien n'est enregistré tant qu'aucune écoute n'est en cours (le son est jeté).
 */
export class Mic {
  private stream: MediaStream | null = null;
  private ctx: AudioContext | null = null;
  private node: ScriptProcessorNode | null = null;
  private sink: ((chunk: Float32Array) => void) | null = null;
  private floor: number | undefined;

  get isOpen(): boolean {
    return this.stream !== null;
  }

  async open(): Promise<void> {
    if (this.stream) return;
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    let ctx: AudioContext;
    try {
      ctx = new AudioContext({ sampleRate: SAMPLE_RATE });
    } catch {
      ctx = new AudioContext();
    }
    const source = ctx.createMediaStreamSource(stream);
    const node = ctx.createScriptProcessor(4096, 1, 1);
    const rate = ctx.sampleRate;
    node.onaudioprocess = (ev) => {
      const input = ev.inputBuffer.getChannelData(0);
      this.sink?.(rate === SAMPLE_RATE ? new Float32Array(input) : resampleLinear(input, rate, SAMPLE_RATE));
    };
    const mute = ctx.createGain();
    mute.gain.value = 0;
    source.connect(node);
    node.connect(mute);
    mute.connect(ctx.destination);
    this.stream = stream;
    this.ctx = ctx;
    this.node = node;
    void ctx.resume();
  }

  close(): void {
    this.sink = null;
    this.node?.disconnect();
    this.stream?.getTracks().forEach((t) => t.stop());
    void this.ctx?.close();
    this.stream = null;
    this.ctx = null;
    this.node = null;
  }

  listen(opts: { startTimeoutMs: number | null; maxMs?: number; onLevel?: (level: number) => void }): Listening {
    const ep = new Endpointer({ startTimeoutMs: opts.startTimeoutMs, maxMs: opts.maxMs, noiseFloor: this.floor });
    let settle!: (r: ListenResult) => void;
    const result = new Promise<ListenResult>((resolve) => (settle = resolve));
    let over = false;
    const end = (r: ListenResult) => {
      if (over) return;
      over = true;
      if (this.sink === sink) this.sink = null;
      if (ep.status !== "calibrating" && this.floor === undefined) this.floor = ep.noiseFloor;
      settle(r);
    };
    const wavOf = (samples: Float32Array | null): ListenResult =>
      samples && samples.length ? { reason: "speech", wav: encodeWav(samples) } : { reason: "timeout", wav: null };
    const sink = (chunk: Float32Array) => {
      const status = ep.push(chunk);
      opts.onLevel?.(ep.level);
      if (status === "done") end(wavOf(ep.audio()));
      else if (status === "timeout") end({ reason: "timeout", wav: null });
    };
    this.sink = sink;
    return {
      result,
      finish: () => end(wavOf(ep.finish())),
      cancel: () => end({ reason: "cancelled", wav: null }),
    };
  }
}
