import type { SpeechInputAdapter, SpeechOutputAdapter, VoiceConfig, VoiceSessionCallbacks } from "./types";

function isAbort(error: unknown) {
  return error instanceof DOMException && error.name === "AbortError";
}

export class VoiceSession {
  private running = false;
  private generation = 0;
  private turnPending = false;

  constructor(
    private readonly input: SpeechInputAdapter,
    private readonly output: SpeechOutputAdapter,
    private readonly config: VoiceConfig,
    private readonly onTurn: (text: string) => Promise<string>,
    private readonly onCancelTurn: () => void,
    private readonly callbacks: VoiceSessionCallbacks,
  ) {}

  get active() { return this.running; }

  async start() {
    if (this.running) return;
    this.running = true;
    const generation = ++this.generation;
    this.callbacks.onPhase("requesting", this.input.id === "native" ? "正在请求 Android 麦克风权限…" : "正在请求麦克风权限…");
    while (this.running && generation === this.generation) {
      try {
        this.callbacks.onPhase("listening", "正在听…说完后会自动停止收音");
        const content = (await this.input.listenOnce(this.config.language)).trim();
        if (!this.running || generation !== this.generation) return;
        if (!content) throw new Error("没有听到完整语句，请重新开始通话。");
        this.callbacks.onLine({ role: "user", text: content });
        this.callbacks.onPhase("thinking", "正在等待人格回复…");
        this.turnPending = true;
        const reply = (await this.onTurn(content)).trim();
        this.turnPending = false;
        if (!this.running || generation !== this.generation) return;
        if (!reply) throw new Error("人格没有返回可朗读的正文");
        this.callbacks.onLine({ role: "assistant", text: reply });
        this.callbacks.onPhase("speaking", this.output.id === "minimax" ? "正在用 MiniMax 朗读…" : "正在用系统语音朗读…");
        await this.output.speak(reply, this.config.language);
        if (!this.config.auto_continue) {
          this.running = false;
          this.callbacks.onPhase("stopped", "这一轮已完成，点击继续可以再说一句。");
          return;
        }
      } catch (error) {
        this.turnPending = false;
        if (!this.running || generation !== this.generation || isAbort(error)) return;
        this.running = false;
        this.input.stop();
        this.output.stop();
        this.callbacks.onPhase("error", error instanceof Error ? error.message : "语音通话失败");
        return;
      }
    }
  }

  stop(message = "通话已结束") {
    if (!this.running && message === "通话已结束") {
      this.callbacks.onPhase("stopped", message);
      return;
    }
    this.running = false;
    this.generation += 1;
    if (this.turnPending) this.onCancelTurn();
    this.turnPending = false;
    this.input.stop();
    this.output.stop();
    this.callbacks.onPhase("stopped", message);
  }

  destroy() {
    this.running = false;
    this.generation += 1;
    if (this.turnPending) this.onCancelTurn();
    this.turnPending = false;
    this.input.destroy();
    this.output.destroy();
  }
}
