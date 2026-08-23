type NativeVoiceEvent = {
  type?: string;
  transcript?: string;
  code?: string | number;
  message?: string;
  trace_id?: string;
};

type NativeVoiceHandler = (event: NativeVoiceEvent) => void;

const handlers = new Map<string, NativeVoiceHandler>();

function installCallback() {
  // Reinstall on subscription so Vite HMR cannot leave Android dispatching
  // into a stale module-level handlers map.
  window.AtherloomNativeVoice = (callbackId, rawEvent) => {
    const handler = handlers.get(callbackId);
    if (!handler) return;
    let event: NativeVoiceEvent;
    try {
      event = JSON.parse(rawEvent) as NativeVoiceEvent;
    } catch {
      event = { type: "error", message: "Android 返回了无法解析的语音事件" };
    }
    handler(event);
  };
}

export function subscribeNativeVoice(callbackId: string, handler: NativeVoiceHandler) {
  installCallback();
  handlers.set(callbackId, handler);
  return () => handlers.delete(callbackId);
}

export function voiceCallbackId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export type { NativeVoiceEvent };
