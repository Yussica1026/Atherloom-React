import { useEffect, useRef, useState } from "react";
import { createSpeechInput, createSpeechOutput } from "../voice/adapters";
import { VoiceSession } from "../voice/VoiceSession";
import { normalizeVoiceConfig, type VoiceLine, type VoicePhase } from "../voice/types";

interface VoiceCallProps {
  open: boolean;
  personaKey: string;
  personaName: string;
  voiceConfig: unknown;
  onClose: () => void;
  onOpenSettings: () => void;
  onTranscript: (text: string) => Promise<string>;
  onCancelTranscript: () => void;
}

const runningPhases: VoicePhase[] = ["requesting", "listening", "thinking", "speaking"];

export function VoiceCall({ open, personaKey, personaName, voiceConfig, onClose, onOpenSettings, onTranscript, onCancelTranscript }: VoiceCallProps) {
  const sessionRef = useRef<VoiceSession | null>(null);
  const [phase, setPhase] = useState<VoicePhase>("idle");
  const [status, setStatus] = useState("点击开始后，我会听一句、停止收音、等待回复，再朗读结果。");
  const [transcript, setTranscript] = useState<VoiceLine[]>([]);
  const config = normalizeVoiceConfig(voiceConfig);
  const active = runningPhases.includes(phase);

  const release = () => {
    sessionRef.current?.destroy();
    sessionRef.current = null;
  };

  useEffect(() => {
    if (open) {
      setPhase("idle");
      setStatus("点击开始后，我会听一句、停止收音、等待回复，再朗读结果。");
      setTranscript([]);
    } else {
      release();
    }
  }, [open]);

  useEffect(() => () => release(), []);

  useEffect(() => {
    if (!open) return;
    const suspend = () => {
      if (document.visibilityState !== "hidden") return;
      sessionRef.current?.stop("应用进入后台，通话已安全停止");
      release();
      setPhase("stopped");
      setStatus("应用进入后台，通话已安全停止");
    };
    const pageHide = () => release();
    document.addEventListener("visibilitychange", suspend);
    window.addEventListener("pagehide", pageHide);
    return () => {
      document.removeEventListener("visibilitychange", suspend);
      window.removeEventListener("pagehide", pageHide);
    };
  }, [open]);

  useEffect(() => {
    if (!open || !sessionRef.current) return;
    sessionRef.current.stop("人格已切换，通话已停止");
    release();
    setPhase("stopped");
    setStatus("人格已切换，通话已停止");
  }, [personaKey]);

  if (!open) return null;

  const start = () => {
    release();
    try {
      const input = createSpeechInput(config);
      const output = createSpeechOutput(config);
      const session = new VoiceSession(input, output, config, onTranscript, onCancelTranscript, {
        onPhase: (nextPhase, message) => {
          setPhase(nextPhase);
          setStatus(message);
        },
        onLine: (line) => setTranscript((current) => [...current, line].slice(-40)),
      });
      sessionRef.current = session;
      void session.start();
    } catch (error) {
      setPhase("error");
      setStatus(error instanceof Error ? error.message : "无法建立语音通话");
    }
  };

  const stop = () => {
    sessionRef.current?.stop();
    release();
    setPhase("stopped");
    setStatus("通话已结束");
  };

  const close = () => {
    stop();
    onClose();
  };

  return <div className="voice-call-layer"><section className="voice-call" role="dialog" aria-modal="true" aria-label="语音通话" data-phase={phase}>
    <button className="voice-call-close" type="button" aria-label="关闭通话" onClick={close}>×</button>
    <div className={`call-orb-react${active ? " active" : ""}`}>{personaName.slice(0, 1).toUpperCase()}</div>
    <h2>和 {personaName} 通话</h2>
    <p className="voice-call-status" aria-live="polite">{status}</p>
    <p className="voice-call-route">{window.AtherloomNative?.startSpeechRecognition && config.input_provider !== "browser" ? "Android 原生识别" : "系统语音识别"} → 人格线路 → {config.output_provider === "minimax" ? "MiniMax TTS" : "系统朗读"}</p>
    <div className="call-transcript-react" aria-label="通话文字记录">{transcript.map((item, index) => <p className={item.role} key={`${item.role}-${index}`}><strong>{item.role === "user" ? "你" : personaName}</strong>{item.text}</p>)}</div>
    <div className="form-actions voice-call-actions">
      {!active ? <button className="primary-button" onClick={start}>{phase === "error" || phase === "stopped" ? "重新开始" : "开始通话"}</button> : <button className="secondary-button" onClick={stop}>结束</button>}
      <button className="secondary-button" type="button" onClick={() => { stop(); onOpenSettings(); }}>语音设置</button>
    </div>
  </section></div>;
}
