export const minimaxSpeechModels = [
  "speech-2.8-turbo",
  "speech-2.8-hd",
  "speech-2.6-turbo",
  "speech-2.6-hd",
] as const;

export type MiniMaxSpeechModel = (typeof minimaxSpeechModels)[number];
export type VoiceOutputProvider = "system" | "minimax";
export type VoiceInputProvider = "auto" | "native" | "browser";
export type MiniMaxRegion = "cn" | "global";

export interface SpeechProviderCapabilities {
  tts: boolean;
  tts_streaming: boolean;
  asr: boolean;
  voice_to_voice_realtime: boolean;
  can_interrupt: boolean;
}

export const speechProviderCapabilities: Record<VoiceOutputProvider, SpeechProviderCapabilities> = {
  system: { tts: true, tts_streaming: false, asr: false, voice_to_voice_realtime: false, can_interrupt: true },
  minimax: { tts: true, tts_streaming: true, asr: false, voice_to_voice_realtime: false, can_interrupt: true },
};

export interface VoiceConfig {
  input_provider: VoiceInputProvider;
  output_provider: VoiceOutputProvider;
  language: string;
  auto_continue: boolean;
  minimax: {
    region: MiniMaxRegion;
    model: MiniMaxSpeechModel;
    voice_id: string;
    speed: number;
    volume: number;
    pitch: number;
    has_api_key?: boolean;
  };
}

export type VoicePhase = "idle" | "requesting" | "listening" | "thinking" | "speaking" | "stopped" | "error";

export interface VoiceLine {
  role: "user" | "assistant";
  text: string;
}

export interface SpeechInputAdapter {
  readonly id: "native" | "browser";
  listenOnce(language: string): Promise<string>;
  stop(): void;
  destroy(): void;
}

export interface SpeechOutputAdapter {
  readonly id: "system" | "minimax";
  speak(text: string, language: string): Promise<void>;
  stop(): void;
  destroy(): void;
}

export interface VoiceSessionCallbacks {
  onPhase: (phase: VoicePhase, message: string) => void;
  onLine: (line: VoiceLine) => void;
}

export const defaultVoiceConfig: VoiceConfig = {
  input_provider: "auto",
  output_provider: "system",
  language: "zh-CN",
  auto_continue: true,
  minimax: {
    region: "cn",
    model: "speech-2.8-turbo",
    voice_id: "male-qn-qingse",
    speed: 1,
    volume: 1,
    pitch: 0,
    has_api_key: false,
  },
};

function numberInRange(value: unknown, fallback: number, minimum: number, maximum: number) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.min(maximum, Math.max(minimum, numeric)) : fallback;
}

export function normalizeVoiceConfig(value: unknown): VoiceConfig {
  const source = value && typeof value === "object" ? value as Partial<VoiceConfig> : {};
  const minimax: Partial<VoiceConfig["minimax"]> = source.minimax && typeof source.minimax === "object" ? source.minimax : {};
  const input = source.input_provider;
  const output = source.output_provider;
  const region = minimax.region;
  const model = minimax.model;
  return {
    input_provider: input === "native" || input === "browser" ? input : "auto",
    output_provider: output === "minimax" ? "minimax" : "system",
    language: typeof source.language === "string" && source.language.trim() ? source.language.trim() : "zh-CN",
    auto_continue: source.auto_continue !== false,
    minimax: {
      region: region === "global" ? "global" : "cn",
      model: minimaxSpeechModels.includes(model as MiniMaxSpeechModel) ? model as MiniMaxSpeechModel : "speech-2.8-turbo",
      voice_id: typeof minimax.voice_id === "string" && minimax.voice_id.trim() ? minimax.voice_id.trim() : "male-qn-qingse",
      speed: numberInRange(minimax.speed, 1, 0.5, 2),
      volume: numberInRange(minimax.volume, 1, 0, 10),
      pitch: numberInRange(minimax.pitch, 0, -12, 12),
      has_api_key: Boolean(minimax.has_api_key),
    },
  };
}
