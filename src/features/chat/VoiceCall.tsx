import { useEffect, useRef, useState } from "react";

interface SpeechResultEventLike {
  results: ArrayLike<{ 0: { transcript: string } }>;
}

interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  onresult: ((event: SpeechResultEventLike) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  abort(): void;
}

interface VoiceCallProps {
  open: boolean;
  personaName: string;
  assistantText: string;
  onClose: () => void;
  onTranscript: (text: string) => Promise<void>;
}

export function VoiceCall({ open, personaName, assistantText, onClose, onTranscript }: VoiceCallProps) {
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const activeRef = useRef(false);
  const spokenRef = useRef("");
  const [active, setActive] = useState(false);
  const [status, setStatus] = useState("点击开始后，我会听你说话并朗读模型回复。");
  const [transcript, setTranscript] = useState<Array<{ role: "user" | "assistant"; text: string }>>([]);

  const listen = () => {
    if (!activeRef.current) return;
    try {
      recognitionRef.current?.start();
      setStatus("正在听…");
    } catch {
      // Recognition may still be transitioning from the previous turn.
    }
  };

  useEffect(() => {
    if (!active || !assistantText || assistantText === spokenRef.current) return;
    spokenRef.current = assistantText;
    setTranscript((current) => [...current, { role: "assistant", text: assistantText }]);
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(assistantText);
    utterance.lang = "zh-CN";
    utterance.onend = listen;
    setStatus(`${personaName} 正在说话…`);
    window.speechSynthesis.speak(utterance);
  }, [active, assistantText, personaName]);

  useEffect(() => () => {
    activeRef.current = false;
    recognitionRef.current?.abort();
    window.speechSynthesis.cancel();
  }, []);

  if (!open) return null;

  const start = async () => {
    const source = window as unknown as { SpeechRecognition?: new () => SpeechRecognitionLike; webkitSpeechRecognition?: new () => SpeechRecognitionLike };
    const Recognition = source.SpeechRecognition || source.webkitSpeechRecognition;
    if (!Recognition) {
      setStatus("当前系统 WebView 没有语音识别能力。");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((track) => track.stop());
      const recognition = new Recognition();
      recognition.lang = "zh-CN";
      recognition.interimResults = false;
      recognition.onresult = (event) => {
        const result = event.results[event.results.length - 1]?.[0]?.transcript?.trim();
        if (!result) return;
        setTranscript((current) => [...current, { role: "user", text: result }]);
        setStatus(`${personaName} 正在回复…`);
        void onTranscript(result).catch((error) => {
          setStatus(error instanceof Error ? error.message : "通话消息发送失败");
          listen();
        });
      };
      recognition.onerror = (event) => {
        if (activeRef.current) setStatus(`没有听清：${event.error}`);
      };
      recognition.onend = () => {
        if (activeRef.current && !window.speechSynthesis.speaking) window.setTimeout(listen, 280);
      };
      recognitionRef.current = recognition;
      activeRef.current = true;
      spokenRef.current = assistantText;
      setActive(true);
      listen();
    } catch (error) {
      setStatus(`无法开始：${error instanceof Error ? error.message : "麦克风未授权"}`);
    }
  };

  const stop = () => {
    activeRef.current = false;
    setActive(false);
    recognitionRef.current?.abort();
    window.speechSynthesis.cancel();
    setStatus("通话已结束");
  };

  return <div className="voice-call-layer"><section className="voice-call" role="dialog" aria-modal="true" aria-label="语音通话"><button className="voice-call-close" type="button" aria-label="关闭通话" onClick={() => { stop(); onClose(); }}>×</button><div className={`call-orb-react${active ? " active" : ""}`}>{personaName.slice(0, 1).toUpperCase()}</div><h2>和 {personaName} 通话</h2><p>{status}</p><div className="call-transcript-react">{transcript.map((item, index) => <p className={item.role} key={`${item.role}-${index}`}><strong>{item.role === "user" ? "你" : personaName}</strong>{item.text}</p>)}</div><div className="form-actions">{!active ? <button className="primary-button" onClick={() => void start()}>开始通话</button> : <button className="secondary-button" onClick={stop}>结束</button>}</div></section></div>;
}
