import { useLayoutEffect, useRef } from "react";
import type { Persona, Provider } from "../../domain/types";
import { PlusIcon, SendIcon, StopIcon } from "../../components/Icons";

interface ComposerProps {
  value: string;
  busy: boolean;
  providers: Provider[];
  personas: Persona[];
  providerId: string | null;
  personaId: string | null;
  onChange: (value: string) => void;
  onProviderChange: (id: string) => void;
  onPersonaChange: (id: string | null) => void;
  onSend: () => void;
  onStop: () => void;
}

export function Composer({
  value,
  busy,
  providers,
  personas,
  providerId,
  personaId,
  onChange,
  onProviderChange,
  onPersonaChange,
  onSend,
  onStop,
}: ComposerProps) {
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.style.height = "auto";
    input.style.height = `${Math.min(input.scrollHeight, 180)}px`;
  }, [value]);

  return (
    <section className="composer-wrap" aria-label="发送消息">
      <div className="composer">
        <textarea
          ref={inputRef}
          rows={1}
          aria-label="消息"
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
        <div className="composer-bottom">
          <div className="composer-tools">
            <button className="round-button" type="button" aria-label="附件将在后续迁移" disabled>
              <PlusIcon />
            </button>
            <label className="compact-select">
              <span className="sr-only">模型线路</span>
              <select value={providerId || ""} onChange={(event) => onProviderChange(event.target.value)}>
                <option value="">添加 API 线路</option>
                {providers.map((provider) => (
                  <option key={provider.id} value={provider.id}>{provider.name} · {provider.model}</option>
                ))}
              </select>
            </label>
            <label className="compact-select persona-select">
              <span className="sr-only">人格</span>
              <select value={personaId || ""} onChange={(event) => onPersonaChange(event.target.value || null)}>
                <option value="">默认人格</option>
                {personas.map((persona) => (
                  <option key={persona.id} value={persona.id}>{persona.name}</option>
                ))}
              </select>
            </label>
          </div>
          <button
            className={`send-button${busy ? " stop-button" : ""}`}
            type="button"
            aria-label={busy ? "停止生成" : "发送"}
            disabled={!busy && !value.trim()}
            onClick={busy ? onStop : onSend}
          >
            {busy ? <StopIcon /> : <SendIcon />}
          </button>
        </div>
      </div>
    </section>
  );
}
