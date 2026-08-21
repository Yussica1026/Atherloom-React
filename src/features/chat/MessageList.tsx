import { useMemo, useState, type FormEvent } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { writeClipboardText } from "../../adapters/native/clipboard";
import type { Message } from "../../domain/types";

interface MessageListProps {
  messages: Message[];
  favoriteMessageIds: Set<string>;
  busy: boolean;
  onFavorite: (messageId: string) => Promise<void>;
  onEdit: (messageId: string, content: string) => Promise<unknown>;
  onRegenerate: (message: Message) => Promise<void>;
  onSelectVersion: (parentMessageId: string, assistantMessageId: string) => Promise<void>;
  onBranch: (messageId: string) => Promise<unknown>;
  onDeleteVersion: (messageId: string) => Promise<void>;
  onDeleteAllVersions: (messageId: string) => Promise<void>;
  onQuestionOption: (question: string, option: string) => void;
}

interface QuestionCard {
  question: string;
  options: string[];
}

interface VisibleMessage {
  message: Message;
  versions: Message[];
  versionIndex: number;
}

function sourceLabel(source: NonNullable<Message["memory_sources"]>[number]) {
  if (typeof source === "string") return source;
  return source.title || source.content || "相关记忆";
}

function assistantContentParts(content: string) {
  const match = content.match(/<questions>([\s\S]*?)<\/questions>/i);
  if (!match) return { text: content, questions: [] as QuestionCard[] };
  try {
    const parsed = JSON.parse(match[1]) as Array<{ question?: unknown; options?: unknown }>;
    const questions = Array.isArray(parsed) ? parsed.slice(0, 4).map((item) => ({
      question: String(item?.question || "").trim(),
      options: Array.isArray(item?.options) ? item.options.map((option) => String(option).trim()).filter(Boolean).slice(0, 5) : [],
    })).filter((item) => item.question && item.options.length >= 2) : [];
    return { text: content.replace(match[0], "").trim(), questions };
  } catch {
    return { text: content, questions: [] as QuestionCard[] };
  }
}

function visibleMessages(messages: Message[]): VisibleMessage[] {
  const output: VisibleMessage[] = [];
  const handledParents = new Set<string>();
  for (const message of messages) {
    if (message.role !== "assistant" || !message.parent_message_id) {
      output.push({ message, versions: [message], versionIndex: 0 });
      continue;
    }
    if (handledParents.has(message.parent_message_id)) continue;
    handledParents.add(message.parent_message_id);
    const versions = messages.filter((item) => item.role === "assistant" && item.parent_message_id === message.parent_message_id);
    const selected = versions.find((item) => Boolean(item.selected)) || versions.at(-1) || message;
    output.push({ message: selected, versions, versionIndex: Math.max(0, versions.indexOf(selected)) });
  }
  return output;
}

function errorText(error: unknown) {
  return error instanceof Error ? error.message : "操作失败";
}

function ReasoningDetails({ content }: { content: string }) {
  const [open, setOpen] = useState(true);
  return <details className="reasoning" open={open} onToggle={(event) => setOpen(event.currentTarget.open)}><summary>{open ? "思考过程（点击收起）" : "思考过程（点击展开）"}</summary><p>{content}</p></details>;
}

export function MessageList({
  messages,
  favoriteMessageIds,
  busy,
  onFavorite,
  onEdit,
  onRegenerate,
  onSelectVersion,
  onBranch,
  onDeleteVersion,
  onDeleteAllVersions,
  onQuestionOption,
}: MessageListProps) {
  const [editing, setEditing] = useState<Message | null>(null);
  const [editContent, setEditContent] = useState("");
  const [moreMessage, setMoreMessage] = useState<Message | null>(null);
  const [working, setWorking] = useState(false);
  const [questionSelections, setQuestionSelections] = useState<Record<string, string>>({});
  const visible = useMemo(() => visibleMessages(messages).filter((item) => item.message.role !== "system"), [messages]);

  const invoke = async (action: () => Promise<unknown>) => {
    if (working) return;
    setWorking(true);
    try {
      await action();
    } catch (error) {
      window.alert(errorText(error));
    } finally {
      setWorking(false);
    }
  };

  const openEditor = (message: Message) => {
    if (!message.id) return;
    setEditing(message);
    setEditContent(message.content);
  };

  const submitEdit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!editing?.id || !editContent.trim()) return;
    setWorking(true);
    try {
      await onEdit(editing.id, editContent);
      setEditing(null);
    } catch (error) {
      window.alert(errorText(error));
    } finally {
      setWorking(false);
    }
  };

  return (
    <div className="messages" aria-live="polite">
      {visible.map(({ message, versions, versionIndex }, index) => {
        const content = message.role === "assistant" ? assistantContentParts(message.content) : null;
        const favorited = Boolean(message.id && favoriteMessageIds.has(message.id));
        return (
          <article
            className={`message message-${message.role}${message.error ? " message-error" : ""}`}
            key={message.id || message.client_id || `${message.role}-${index}`}
          >
            <div className="message-column">
              <div className="message-body">
                {message.reasoning ? (
                  <ReasoningDetails content={message.reasoning} />
                ) : null}
                {message.attachments?.length ? (
                  <div className="message-attachments" aria-label="消息附件">
                    {message.attachments.map((attachment) => attachment.kind === "image" && attachment.data ? (
                      <figure key={attachment.id}><img src={attachment.data} alt={attachment.name} /><figcaption>{attachment.name}</figcaption></figure>
                    ) : (
                      <span key={attachment.id}>{attachment.kind === "pdf" ? "PDF" : "文件"} · {attachment.name}</span>
                    ))}
                  </div>
                ) : null}
                <div className="message-content">
                  {message.role === "assistant" ? (
                    message.content ? (
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{content?.text || ""}</ReactMarkdown>
                    ) : (
                      <span className="generation-status">正在思考<span aria-hidden="true">···</span></span>
                    )
                  ) : (
                    <p>{message.content}</p>
                  )}
                </div>
                {content?.questions.length ? (
                  <section className="question-deck" aria-label="助手提问">
                    <strong className="question-deck-title">想听听你的选择</strong>
                    {content.questions.map((question, questionIndex) => (
                      <article className="question-card" key={`${question.question}-${questionIndex}`}>
                        <strong><span>{questionIndex + 1}</span>{question.question}</strong>
                        <div>
                          {question.options.map((option) => {
                            const selectionKey = `${message.id || message.client_id || index}:${questionIndex}`;
                            const selected = questionSelections[selectionKey] === option;
                            return <button type="button" className={selected ? "selected" : ""} aria-pressed={selected} key={option} onClick={() => { setQuestionSelections((current) => ({ ...current, [selectionKey]: option })); onQuestionOption(question.question, option); }}>{option}</button>;
                          })}
                        </div>
                        {questionSelections[`${message.id || message.client_id || index}:${questionIndex}`] ? <small className="question-selection-status" role="status">已放入输入框，可继续选择其他题或直接发送。</small> : null}
                      </article>
                    ))}
                  </section>
                ) : null}
                {message.memory_sources?.length ? (
                  <div className="memory-sources" aria-label="本轮使用的记忆">
                    {message.memory_sources.map((source, sourceIndex) => (
                      <span key={`${sourceLabel(source)}-${sourceIndex}`}>{sourceLabel(source)}</span>
                    ))}
                  </div>
                ) : null}
                {message.tool_events?.length ? (
                  <div className="tool-events" aria-label="工具调用记录">
                    {message.tool_events.map((tool, toolIndex) => (
                      <details key={`${String(tool.tool_name || tool.name || tool.type || "工具")}-${toolIndex}`}>
                        <summary>{String(tool.tool_name || tool.name || tool.type || "工具调用")} · {String(tool.status || "已完成")}</summary>
                        {tool.detail || tool.query ? <p>{String(tool.detail || tool.query)}</p> : null}
                      </details>
                    ))}
                  </div>
                ) : null}
                {message.role === "assistant" && (message.model || message.usage?.total_tokens) ? (
                  <div className="message-meta">
                    {[message.model, message.usage?.total_tokens ? `${message.usage.total_tokens.toLocaleString()} tokens` : ""]
                      .filter(Boolean)
                      .join(" · ")}
                  </div>
                ) : null}
              </div>

              {!message.pending ? (
                <div className="message-actions" aria-label="消息操作">
                  <button type="button" onClick={() => void writeClipboardText(message.content)}>复制</button>
                  {message.id ? <button type="button" className={favorited ? "active" : ""} onClick={() => void invoke(() => onFavorite(message.id!))}>{favorited ? "★ 已珍藏" : "☆ 珍藏"}</button> : null}
                  {message.id ? <button type="button" onClick={() => openEditor(message)}>修改</button> : null}
                  {(message.role === "user" ? message.id : message.parent_message_id) ? <button type="button" disabled={busy || working} onClick={() => void invoke(() => onRegenerate(message))}>重新 Roll</button> : null}
                  {message.id ? <button type="button" aria-label="更多消息操作" onClick={() => setMoreMessage(message)}>•••</button> : null}
                </div>
              ) : null}

              {message.role === "assistant" && versions.length > 1 && message.parent_message_id ? (
                <div className="version-switcher" aria-label="回答版本">
                  <button
                    type="button"
                    disabled={versionIndex === 0 || working}
                    onClick={() => {
                      const target = versions[versionIndex - 1];
                      if (target?.id) void invoke(() => onSelectVersion(message.parent_message_id!, target.id!));
                    }}
                  >‹</button>
                  <span>{versionIndex + 1} / {versions.length}</span>
                  <button
                    type="button"
                    disabled={versionIndex === versions.length - 1 || working}
                    onClick={() => {
                      const target = versions[versionIndex + 1];
                      if (target?.id) void invoke(() => onSelectVersion(message.parent_message_id!, target.id!));
                    }}
                  >›</button>
                </div>
              ) : null}
            </div>
          </article>
        );
      })}

      {editing ? (
        <div className="message-dialog-layer" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setEditing(null)}>
          <form className="message-dialog" role="dialog" aria-modal="true" aria-labelledby="message-edit-title" onSubmit={submitEdit}>
            <h3 id="message-edit-title">修改内容</h3>
            <textarea autoFocus rows={8} value={editContent} onChange={(event) => setEditContent(event.target.value)} />
            <div className="form-actions">
              <button className="secondary-button" type="button" onClick={() => setEditing(null)}>取消</button>
              <button className="primary-button" disabled={working || !editContent.trim()}>保存修改</button>
            </div>
          </form>
        </div>
      ) : null}

      {moreMessage?.id ? (
        <div className="message-dialog-layer" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setMoreMessage(null)}>
          <section className="message-menu" role="dialog" aria-modal="true" aria-label="更多消息操作">
            <button type="button" disabled={working} onClick={() => void invoke(async () => { await onBranch(moreMessage.id!); setMoreMessage(null); })}>从这里创建分支</button>
            <button type="button" onClick={() => { openEditor(moreMessage); setMoreMessage(null); }}>修改内容</button>
            <button className="danger-action" type="button" disabled={working} onClick={() => {
              if (!window.confirm(moreMessage.role === "user" ? "删除这条消息及它下面的全部回答？" : "只删除当前显示的回答版本？")) return;
              void invoke(async () => { await onDeleteVersion(moreMessage.id!); setMoreMessage(null); });
            }}>删除本版本</button>
            <button className="danger-action" type="button" disabled={working} onClick={() => {
              if (!window.confirm(moreMessage.role === "user" ? "删除这条消息及它下面的全部回答？" : "删除该提问下的全部回答版本？用户提问会保留。")) return;
              void invoke(async () => { await onDeleteAllVersions(moreMessage.id!); setMoreMessage(null); });
            }}>删除全部版本</button>
            <button type="button" onClick={() => setMoreMessage(null)}>取消</button>
          </section>
        </div>
      ) : null}
    </div>
  );
}
