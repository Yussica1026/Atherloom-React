import { subscribeNativeVoice, voiceCallbackId, type NativeVoiceEvent } from "./nativeEvents";
import type { SpeechInputAdapter, SpeechOutputAdapter, VoiceConfig } from "./types";

interface SpeechResultEventLike {
  results: ArrayLike<{ 0: { transcript: string } }>;
}

interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((event: SpeechResultEventLike) => void) | null;
  onerror: ((event: { error: string; message?: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  abort(): void;
}

type RecognitionConstructor = new () => SpeechRecognitionLike;

function recognitionConstructor() {
  const source = window as unknown as { SpeechRecognition?: RecognitionConstructor; webkitSpeechRecognition?: RecognitionConstructor };
  return source.SpeechRecognition || source.webkitSpeechRecognition;
}

function permissionMessage(message: string) {
  const normalized = message.toLowerCase();
  if (normalized.includes("permission") || normalized.includes("not-allowed") || normalized.includes("denied") || (message.includes("权限") && (message.includes("麦克风") || message.includes("录音")))) {
    return "麦克风权限未授予，请在系统设置中允许 Atherloom 使用麦克风。";
  }
  if (normalized.includes("no-speech")) return "没有听到完整语句，请重新开始通话。";
  if (normalized.includes("network")) return "系统语音识别网络不可用，请检查网络或改用其他输入适配器。";
  return message || "语音识别失败";
}

export function splitSpeechText(text: string, maximumLength: number) {
  const limit = Math.max(40, Math.floor(maximumLength));
  const chunks: string[] = [];
  let remaining = text.trim();
  const boundaries = ["\n", "。", "！", "？", "!", "?", "；", ";", "，", ",", "、", " "];
  while (remaining.length > limit) {
    let cut = limit;
    let preferred = 0;
    for (const boundary of boundaries) {
      const index = remaining.lastIndexOf(boundary, limit - 1);
      if (index >= Math.floor(limit * 0.45)) preferred = Math.max(preferred, index + boundary.length);
    }
    if (preferred > 0) cut = preferred;
    const previous = remaining.charCodeAt(cut - 1);
    const next = remaining.charCodeAt(cut);
    if (previous >= 0xd800 && previous <= 0xdbff && next >= 0xdc00 && next <= 0xdfff) cut -= 1;
    const chunk = remaining.slice(0, cut).trim();
    if (chunk) chunks.push(chunk);
    remaining = remaining.slice(cut).trimStart();
  }
  if (remaining) chunks.push(remaining);
  return chunks;
}

class NativeSpeechInput implements SpeechInputAdapter {
  readonly id = "native" as const;
  private callbackId = "";
  private unsubscribe: (() => void) | null = null;
  private rejectPending: ((reason: Error) => void) | null = null;
  private timeoutId: number | null = null;

  listenOnce(language: string) {
    const bridge = window.AtherloomNative;
    const startRecognition = bridge?.startSpeechRecognition;
    if (!startRecognition) return Promise.reject(new Error("当前 Android 版本没有原生语音识别桥"));
    this.stop();
    const callbackId = voiceCallbackId("recognition");
    this.callbackId = callbackId;
    return new Promise<string>((resolve, reject) => {
      let settled = false;
      const finish = (action: () => void) => {
        if (settled) return;
        settled = true;
        this.unsubscribe?.();
        this.unsubscribe = null;
        if (this.timeoutId !== null) window.clearTimeout(this.timeoutId);
        this.timeoutId = null;
        this.rejectPending = null;
        this.callbackId = "";
        action();
      };
      this.rejectPending = (reason) => finish(() => reject(reason));
      this.unsubscribe = subscribeNativeVoice(callbackId, (event: NativeVoiceEvent) => {
        if (event.type === "result") {
          const text = String(event.transcript || "").trim();
          finish(() => text ? resolve(text) : reject(new Error("没有听到完整语句，请重新开始通话。")));
        } else if (event.type === "error") {
          finish(() => reject(new Error(permissionMessage(String(event.message || event.code || "语音识别失败")))));
        } else if (event.type === "end") {
          finish(() => reject(new Error("没有听到完整语句，请重新开始通话。")));
        }
      });
      this.timeoutId = window.setTimeout(() => {
        finish(() => reject(new Error("等待 Android 语音识别超时，请重新开始通话。")));
        try { bridge.stopSpeechRecognition?.(callbackId); } catch { /* best-effort native timeout cleanup */ }
      }, 35_000);
      try {
        startRecognition.call(bridge, callbackId, language);
      } catch (error) {
        finish(() => reject(error instanceof Error ? error : new Error("无法启动 Android 语音识别")));
      }
    });
  }

  stop() {
    const callbackId = this.callbackId;
    this.callbackId = "";
    if (callbackId) {
      try { window.AtherloomNative?.stopSpeechRecognition?.(callbackId); } catch { /* best-effort cleanup */ }
      this.rejectPending?.(new DOMException("语音识别已停止", "AbortError"));
    }
    this.unsubscribe?.();
    this.unsubscribe = null;
    if (this.timeoutId !== null) window.clearTimeout(this.timeoutId);
    this.timeoutId = null;
    this.rejectPending = null;
  }

  destroy() { this.stop(); }
}

class BrowserSpeechInput implements SpeechInputAdapter {
  readonly id = "browser" as const;
  private recognition: SpeechRecognitionLike | null = null;
  private rejectPending: ((reason: Error) => void) | null = null;
  private timeoutId: number | null = null;
  private generation = 0;

  async listenOnce(language: string) {
    const Recognition = recognitionConstructor();
    if (!Recognition) throw new Error("当前浏览器没有语音识别能力；Android 请升级到带原生语音桥的版本。");
    this.stop();
    const generation = ++this.generation;
    if (navigator.mediaDevices?.getUserMedia) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach((track) => track.stop());
      } catch (error) {
        throw new Error(permissionMessage(error instanceof Error ? error.message : "麦克风未授权"));
      }
    }
    if (generation !== this.generation) throw new DOMException("语音识别已停止", "AbortError");
    const recognition = new Recognition();
    this.recognition = recognition;
    recognition.lang = language;
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    return new Promise<string>((resolve, reject) => {
      let settled = false;
      const finish = (action: () => void) => {
        if (settled) return;
        settled = true;
        recognition.onresult = null;
        recognition.onerror = null;
        recognition.onend = null;
        this.rejectPending = null;
        this.recognition = null;
        if (this.timeoutId !== null) window.clearTimeout(this.timeoutId);
        this.timeoutId = null;
        action();
      };
      this.rejectPending = (reason) => finish(() => reject(reason));
      recognition.onresult = (event) => {
        const result = event.results[event.results.length - 1]?.[0]?.transcript?.trim() || "";
        finish(() => result ? resolve(result) : reject(new Error("没有听到完整语句，请重新开始通话。")));
      };
      recognition.onerror = (event) => finish(() => reject(new Error(permissionMessage(event.message || event.error))));
      recognition.onend = () => finish(() => reject(new Error("没有听到完整语句，请重新开始通话。")));
      this.timeoutId = window.setTimeout(() => {
        finish(() => reject(new Error("系统语音识别等待超时，请重新开始通话。")));
        try { recognition.abort(); } catch { /* already stopped */ }
      }, 30_000);
      try {
        recognition.start();
      } catch (error) {
        finish(() => reject(error instanceof Error ? error : new Error("无法启动系统语音识别")));
      }
    });
  }

  stop() {
    this.generation += 1;
    const recognition = this.recognition;
    this.recognition = null;
    if (recognition) {
      recognition.onend = null;
      recognition.onerror = null;
      recognition.onresult = null;
      try { recognition.abort(); } catch { /* already stopped */ }
    }
    this.rejectPending?.(new DOMException("语音识别已停止", "AbortError"));
    this.rejectPending = null;
    if (this.timeoutId !== null) window.clearTimeout(this.timeoutId);
    this.timeoutId = null;
  }

  destroy() { this.stop(); }
}

class SystemSpeechOutput implements SpeechOutputAdapter {
  readonly id = "system" as const;
  private rejectPending: ((reason: Error) => void) | null = null;
  private timeoutId: number | null = null;
  private activeUtterance: SpeechSynthesisUtterance | null = null;
  private generation = 0;

  async speak(text: string, language: string) {
    if (!("speechSynthesis" in window) || typeof SpeechSynthesisUtterance === "undefined") {
      throw new Error("当前系统没有文字转语音能力");
    }
    this.stop();
    const generation = this.generation;
    for (const chunk of splitSpeechText(text, 180)) {
      if (generation !== this.generation) throw new DOMException("语音播放已停止", "AbortError");
      await this.speakChunk(chunk, language);
    }
  }

  private speakChunk(text: string, language: string) {
    return new Promise<void>((resolve, reject) => {
      let settled = false;
      const utterance = new SpeechSynthesisUtterance(text);
      this.activeUtterance = utterance;
      utterance.lang = language;
      const finish = (action: () => void) => {
        if (settled) return;
        settled = true;
        utterance.onend = null;
        utterance.onerror = null;
        if (this.activeUtterance === utterance) this.activeUtterance = null;
        if (this.timeoutId !== null) window.clearTimeout(this.timeoutId);
        this.timeoutId = null;
        this.rejectPending = null;
        action();
      };
      this.rejectPending = (reason) => finish(() => reject(reason));
      utterance.onend = () => finish(resolve);
      utterance.onerror = (event) => finish(() => reject(new Error(event.error === "canceled" ? "语音播放已停止" : `系统语音播放失败：${event.error}`)));
      this.timeoutId = window.setTimeout(() => {
        finish(() => reject(new Error("系统语音播放超时，已停止本轮通话。")));
        window.speechSynthesis.cancel();
      }, Math.min(120_000, Math.max(20_000, text.length * 320)));
      window.speechSynthesis.speak(utterance);
    });
  }

  stop() {
    this.generation += 1;
    this.rejectPending?.(new DOMException("语音播放已停止", "AbortError"));
    this.rejectPending = null;
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    this.activeUtterance = null;
    if (this.timeoutId !== null) window.clearTimeout(this.timeoutId);
    this.timeoutId = null;
  }

  destroy() { this.stop(); }
}

class MiniMaxSpeechOutput implements SpeechOutputAdapter {
  readonly id = "minimax" as const;
  private callbackId = "";
  private unsubscribe: (() => void) | null = null;
  private rejectPending: ((reason: Error) => void) | null = null;
  private timeoutId: number | null = null;
  private generation = 0;
  constructor(private readonly config: VoiceConfig["minimax"]) {}

  async speak(text: string, language: string) {
    const bridge = window.AtherloomNative;
    const synthesizeSpeech = bridge?.synthesizeSpeechAsync;
    if (!synthesizeSpeech) throw new Error("MiniMax 语音当前只在带安全原生桥的 Android 版本可用");
    this.stop();
    const generation = this.generation;
    for (const chunk of splitSpeechText(text, 240)) {
      if (generation !== this.generation) throw new DOMException("语音播放已停止", "AbortError");
      await this.speakChunk(bridge, synthesizeSpeech, chunk, language);
    }
  }

  private speakChunk(
    bridge: NonNullable<typeof window.AtherloomNative>,
    synthesizeSpeech: NonNullable<NonNullable<typeof window.AtherloomNative>["synthesizeSpeechAsync"]>,
    text: string,
    language: string,
  ) {
    const callbackId = voiceCallbackId("synthesis");
    this.callbackId = callbackId;
    return new Promise<void>((resolve, reject) => {
      let settled = false;
      const finish = (action: () => void) => {
        if (settled) return;
        settled = true;
        this.unsubscribe?.();
        this.unsubscribe = null;
        if (this.timeoutId !== null) window.clearTimeout(this.timeoutId);
        this.timeoutId = null;
        this.rejectPending = null;
        this.callbackId = "";
        action();
      };
      this.rejectPending = (reason) => finish(() => reject(reason));
      this.unsubscribe = subscribeNativeVoice(callbackId, (event) => {
        if (event.type === "end") finish(() => resolve());
        else if (event.type === "error") {
          const trace = event.trace_id ? `（trace_id: ${event.trace_id}）` : "";
          finish(() => reject(new Error(`${String(event.message || "MiniMax 语音合成失败")}${trace}`)));
        }
      });
      this.timeoutId = window.setTimeout(() => {
        finish(() => reject(new Error("MiniMax 语音合成超时，已停止本轮通话。")));
        try { bridge.cancelSpeechSynthesis?.(callbackId); } catch { /* best-effort native cancellation */ }
      }, Math.min(240_000, Math.max(45_000, text.length * 800 / Math.max(0.5, this.config.speed))));
      try {
        synthesizeSpeech.call(bridge, JSON.stringify({ text, language, ...this.config }), callbackId);
      } catch (error) {
        finish(() => reject(error instanceof Error ? error : new Error("无法启动 MiniMax 语音合成")));
      }
    });
  }

  stop() {
    this.generation += 1;
    const callbackId = this.callbackId;
    this.callbackId = "";
    if (callbackId) {
      this.rejectPending?.(new DOMException("语音播放已停止", "AbortError"));
      try { window.AtherloomNative?.cancelSpeechSynthesis?.(callbackId); } catch { /* best-effort cleanup */ }
    }
    this.unsubscribe?.();
    this.unsubscribe = null;
    if (this.timeoutId !== null) window.clearTimeout(this.timeoutId);
    this.timeoutId = null;
    this.rejectPending = null;
  }

  destroy() { this.stop(); }
}

export function createSpeechInput(config: VoiceConfig): SpeechInputAdapter {
  const nativeAvailable = Boolean(window.AtherloomNative?.startSpeechRecognition);
  if (config.input_provider === "native" && !nativeAvailable) throw new Error("当前 Android 版本没有原生语音识别桥");
  if (config.input_provider !== "browser" && nativeAvailable) return new NativeSpeechInput();
  return new BrowserSpeechInput();
}

export function createSpeechOutput(config: VoiceConfig): SpeechOutputAdapter {
  return config.output_provider === "minimax" ? new MiniMaxSpeechOutput(config.minimax) : new SystemSpeechOutput();
}
