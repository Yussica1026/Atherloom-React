import { useLayoutEffect, useRef, useState, type ChangeEvent } from "react";
import type { Attachment, Persona, Provider, Worldbook } from "../../domain/types";
import { PlusIcon, SendIcon, StopIcon } from "../../components/Icons";

interface ComposerProps {
  value: string;
  busy: boolean;
  attachments: Attachment[];
  providers: Provider[];
  personas: Persona[];
  worldbooks: Worldbook[];
  selectedWorldbookIds: string[];
  quickPhrases: string[];
  providerId: string | null;
  personaId: string | null;
  onChange: (value: string) => void;
  onProviderChange: (id: string) => void;
  onPersonaChange: (id: string | null) => void;
  onAddFiles: (files: File[]) => Promise<void>;
  onRemoveAttachment: (id: string) => void;
  onWorldbookSelectionChange: (ids: string[]) => void;
  onSend: () => void;
  onStop: () => void;
}

export function Composer({
  value,
  busy,
  attachments,
  providers,
  personas,
  worldbooks,
  selectedWorldbookIds,
  quickPhrases,
  providerId,
  personaId,
  onChange,
  onProviderChange,
  onPersonaChange,
  onAddFiles,
  onRemoveAttachment,
  onWorldbookSelectionChange,
  onSend,
  onStop,
}: ComposerProps) {
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [menu, setMenu] = useState<"add" | "worldbooks" | "phrases" | null>(null);
  const enabledWorldbooks = worldbooks.filter((item) => item.enabled !== false);

  useLayoutEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.style.height = "auto";
    input.style.height = `${Math.min(input.scrollHeight, 180)}px`;
  }, [value]);

  const pickFiles = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = [...(event.target.files || [])];
    event.target.value = "";
    if (files.length) await onAddFiles(files);
    setMenu(null);
  };

  const addPhrase = (phrase: string) => {
    onChange(`${value}${value && !/\s$/.test(value) ? "\n" : ""}${phrase}`);
    setMenu(null);
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  return (
    <section className="composer-wrap" aria-label="发送消息">
      {attachments.length || selectedWorldbookIds.length ? (
        <div className="composer-trays">
          {attachments.map((item) => (
            <span className="composer-chip" key={item.id}>
              <span aria-hidden="true">{item.kind === "image" ? "▧" : item.kind === "pdf" ? "PDF" : "▤"}</span>
              {item.name}
              <button type="button" aria-label={`移除附件 ${item.name}`} onClick={() => onRemoveAttachment(item.id)}>×</button>
            </span>
          ))}
          {selectedWorldbookIds.map((id) => {
            const book = worldbooks.find((item) => item.id === id);
            if (!book) return null;
            return (
              <span className="composer-chip instruction-chip" key={id}>
                指令 · {book.name}
                <button type="button" aria-label={`取消注入 ${book.name}`} onClick={() => onWorldbookSelectionChange(selectedWorldbookIds.filter((item) => item !== id))}>×</button>
              </span>
            );
          })}
        </div>
      ) : null}
      <div className="composer">
        <textarea
          ref={inputRef}
          rows={1}
          aria-label="消息"
          placeholder="输入消息…"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.ctrlKey || event.metaKey) && !event.nativeEvent.isComposing) {
              event.preventDefault();
              if (busy) onStop(); else if (value.trim() || attachments.length) onSend();
            }
          }}
        />
        <input ref={fileRef} className="sr-only" type="file" multiple accept="image/*,.pdf,.txt,.md,.json,.csv,.js,.ts,.tsx,.py,.html,.css" onChange={(event) => void pickFiles(event)} />
        <div className="composer-bottom">
          <div className="composer-tools">
            <div className="composer-popover-anchor">
              <button className="round-button" type="button" aria-label="添加附件或指令" aria-expanded={menu === "add"} onClick={() => setMenu((current) => current === "add" ? null : "add")}>
                <PlusIcon />
              </button>
              {menu === "add" ? (
                <div className="composer-popover attachment-popover">
                  <button type="button" onClick={() => fileRef.current?.click()}>选择图片或文件</button>
                  <button type="button" onClick={() => setMenu("worldbooks")}>注入世界书指令</button>
                </div>
              ) : null}
              {menu === "worldbooks" ? (
                <div className="composer-popover worldbook-popover">
                  <header><strong>本轮世界书</strong><button type="button" onClick={() => setMenu(null)}>完成</button></header>
                  {enabledWorldbooks.map((book) => (
                    <label key={book.id}>
                      <input
                        type="checkbox"
                        checked={selectedWorldbookIds.includes(book.id)}
                        onChange={(event) => onWorldbookSelectionChange(event.target.checked
                          ? [...selectedWorldbookIds, book.id]
                          : selectedWorldbookIds.filter((item) => item !== book.id))}
                      />
                      <span><strong>{book.name}</strong><small>{book.description || `${book.entries?.length || 0} 个条目`}</small></span>
                    </label>
                  ))}
                  {!enabledWorldbooks.length ? <p>请先在设置中添加并启用世界书。</p> : null}
                </div>
              ) : null}
            </div>
            {quickPhrases.length ? (
              <div className="composer-popover-anchor">
                <button className="phrase-button" type="button" aria-expanded={menu === "phrases"} onClick={() => setMenu((current) => current === "phrases" ? null : "phrases")}>常用语</button>
                {menu === "phrases" ? <div className="composer-popover phrase-popover">{quickPhrases.map((phrase) => <button type="button" key={phrase} onClick={() => addPhrase(phrase)}>{phrase}</button>)}</div> : null}
              </div>
            ) : null}
            <label className="compact-select">
              <span className="sr-only">模型线路</span>
              <select value={providerId ? `${providerId}::${encodeURIComponent(providers.find((item) => item.id === providerId)?.model || "")}` : ""} onChange={(event) => onProviderChange(event.target.value)}>
                <option value="">添加 API 线路</option>
                {providers.filter((provider) => provider.enabled !== false).flatMap((provider) => [...new Set([provider.model, ...(provider.models || [])])].map((model) => (
                  <option key={`${provider.id}:${model}`} value={`${provider.id}::${encodeURIComponent(model)}`}>{model} · {provider.name}</option>
                )))}
              </select>
            </label>
            <label className="compact-select persona-select">
              <span className="sr-only">人格</span>
              <select value={personaId || ""} onChange={(event) => onPersonaChange(event.target.value || null)}>
                <option value="">默认人格</option>
                {personas.map((persona) => <option key={persona.id} value={persona.id}>{persona.name}</option>)}
              </select>
            </label>
          </div>
          <button
            className={`send-button${busy ? " stop-button" : ""}`}
            type="button"
            aria-label={busy ? "停止生成" : "发送"}
            disabled={!busy && !value.trim() && !attachments.length}
            onClick={busy ? onStop : onSend}
          >
            {busy ? <StopIcon /> : <SendIcon />}
          </button>
        </div>
      </div>
    </section>
  );
}
