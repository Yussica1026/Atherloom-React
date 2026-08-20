import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Message } from "../../domain/types";

interface MessageListProps {
  messages: Message[];
}

function sourceLabel(source: NonNullable<Message["memory_sources"]>[number]) {
  if (typeof source === "string") return source;
  return source.title || source.content || "相关记忆";
}

export function MessageList({ messages }: MessageListProps) {
  return (
    <div className="messages" aria-live="polite">
      {messages.filter((message) => message.role !== "system").map((message, index) => (
        <article
          className={`message message-${message.role}${message.error ? " message-error" : ""}`}
          key={message.id || message.client_id || `${message.role}-${index}`}
        >
          <div className="message-body">
            {message.reasoning ? (
              <details className="reasoning">
                <summary>思考过程</summary>
                <p>{message.reasoning}</p>
              </details>
            ) : null}
            <div className="message-content">
              {message.role === "assistant" ? (
                message.content ? (
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown>
                ) : (
                  <span className="generation-status">正在思考<span aria-hidden="true">···</span></span>
                )
              ) : (
                <p>{message.content}</p>
              )}
            </div>
            {message.memory_sources?.length ? (
              <div className="memory-sources" aria-label="本轮使用的记忆">
                {message.memory_sources.map((source, sourceIndex) => (
                  <span key={`${sourceLabel(source)}-${sourceIndex}`}>{sourceLabel(source)}</span>
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
        </article>
      ))}
    </div>
  );
}
