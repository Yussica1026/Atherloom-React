import { unzipSync } from "fflate";
import type { Conversation, Message, Persona, ToolEvent } from "../../domain/types";
import type {
  ExternalConversationSummary,
  ExternalImportBatch,
  ExternalImportCommitRequest,
  ExternalImportWarning,
  ExternalSourceIdentity,
} from "../../features/imports/types";

const databaseName = "atherloom-standalone-external-imports-v1";
const objectStoreName = "batches";
const fallbackStorageKey = "atherloom-react:standalone-external-imports:v1";
let activeWorkspaceOperation = "";

type CanonicalRole = "user" | "assistant" | "system" | "tool" | "unknown";

interface CanonicalMessage {
  id: string;
  external_id?: string;
  role: CanonicalRole;
  author_name?: string;
  model?: string;
  created_at?: string;
  parent_external_id?: string;
  text: string;
  reasoning?: string;
  tool_events?: ToolEvent[];
  metadata?: Record<string, unknown>;
}

interface CanonicalConversation {
  id: string;
  external_id?: string;
  source: string;
  title?: string;
  created_at?: string;
  updated_at?: string;
  messages: CanonicalMessage[];
  source_identities: ExternalSourceIdentity[];
  branch_count: number;
  attachment_count: number;
  metadata?: Record<string, unknown>;
}

interface ImportedObjectRecord {
  conversation_id: string;
  message_ids: string[];
  source_key: string;
}

interface StoredImportBatch {
  public: ExternalImportBatch;
  canonical: CanonicalConversation[];
  source_keys: string[];
  imported: ImportedObjectRecord[];
}

export interface StandaloneImportWorkspace {
  personas: Persona[];
  conversations: Conversation[];
  messages: Record<string, Message[]>;
}

export interface StandaloneImportRuntime {
  readWorkspace: () => StandaloneImportWorkspace;
  writeWorkspace: (workspace: StandaloneImportWorkspace) => void;
}

function recordOf(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function arrayOf(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function textOf(value: unknown) {
  return typeof value === "string" ? value : value == null ? "" : String(value);
}

function jsonText(value: unknown) {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function parsedObject(value: unknown) {
  if (typeof value !== "string") return recordOf(value);
  try {
    return recordOf(JSON.parse(value) as unknown);
  } catch {
    return {};
  }
}

function makeId(prefix: string) {
  const suffix = globalThis.crypto?.randomUUID?.()
    || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${suffix}`;
}

function stableHash(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function isoDate(value: unknown): string | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    const millis = value < 10_000_000_000 ? value * 1000 : value;
    return new Date(millis).toISOString();
  }
  if (typeof value !== "string" || !value.trim()) return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : undefined;
}

function normalizeRole(value: unknown): CanonicalRole {
  const role = textOf(value).toLowerCase();
  if (["user", "human"].includes(role)) return "user";
  if (["assistant", "ai", "bot", "model"].includes(role)) return "assistant";
  if (role === "system") return "system";
  if (["tool", "function"].includes(role)) return "tool";
  return "unknown";
}

function contentParts(value: unknown): {
  text: string;
  reasoning?: string;
  attachmentCount: number;
  toolEvents: ToolEvent[];
} {
  const blocks = Array.isArray(value) ? value : [value];
  const texts: string[] = [];
  const reasoning: string[] = [];
  const toolEvents: ToolEvent[] = [];
  let attachmentCount = 0;
  for (const blockValue of blocks) {
    if (typeof blockValue === "string") {
      if (blockValue) texts.push(blockValue);
      continue;
    }
    const block = recordOf(blockValue);
    const type = textOf(block.type || block.content_type || block.kind).toLowerCase();
    const payload = parsedObject(block.payload);
    const directValue = block.text ?? block.content ?? block.value ?? block.thinking ?? block.payload;
    const direct = typeof directValue === "string" || typeof directValue === "number" || typeof directValue === "boolean"
      ? textOf(directValue)
      : "";
    if (["thinking", "reasoning", "analysis"].includes(type)) {
      if (direct) reasoning.push(direct);
    } else if (type.includes("tool") || block.tool_name || block.name && (block.arguments || block.input || block.result)) {
      const toolName = textOf(block.name || block.tool_name || payload.name || payload.tool_name);
      toolEvents.push({
        type: "historical_external_tool",
        name: toolName || undefined,
        status: "历史记录 · 未执行",
        result: block.result ?? block.output ?? block.content ?? payload.result ?? payload.output,
        arguments: block.arguments ?? block.input ?? payload.arguments ?? payload.input,
      });
      texts.push(`[历史工具记录${toolName ? `：${toolName}` : ""}]`);
    } else if (["image", "file", "attachment", "audio", "document", "pdf"].some((item) => type.includes(item)) || block.file_name || block.filename || block.asset_pointer) {
      attachmentCount += 1;
      const uri = textOf(payload.uri || block.uri || block.asset_pointer);
      const name = textOf(block.file_name || block.filename || block.name || payload.name || payload.filename)
        || uri.split("/").pop()
        || "原附件";
      texts.push(`[附件：${name}]`);
    } else if (direct) {
      texts.push(direct);
    } else if (Object.keys(block).length) {
      texts.push(`[未识别内容块：${jsonText(block)}]`);
    }
  }
  return {
    text: texts.join("\n").trim(),
    ...(reasoning.length ? { reasoning: reasoning.join("\n\n") } : {}),
    attachmentCount,
    toolEvents,
  };
}

function appendAttachmentMarkers(text: string, attachments: unknown[]) {
  const markers = attachments.map((raw) => {
    const item = recordOf(raw);
    const name = textOf(item.file_name || item.filename || item.name || item.file_uuid || item.id) || "原附件";
    return `[附件：${name}]`;
  });
  return [text, ...markers].filter(Boolean).join("\n").trim();
}

function identityFor(source: string, name: string, count: number): ExternalSourceIdentity {
  const displayName = name.trim() || (source === "claude" ? "Claude" : source === "chatgpt" ? "ChatGPT" : "外部助手");
  return {
    id: `${source}:assistant:${stableHash(displayName.toLowerCase())}`,
    platform: source,
    kind: "assistant",
    display_name: displayName,
    message_count: count,
    roles: ["assistant"],
  };
}

function chatGptRecords(root: unknown): Record<string, unknown>[] {
  if (Array.isArray(root)) return root.map(recordOf).filter((item) => Object.keys(item).length > 0);
  const value = recordOf(root);
  for (const key of ["conversations", "items", "data"]) {
    if (Array.isArray(value[key])) return arrayOf(value[key]).map(recordOf);
  }
  return value.mapping ? [value] : [];
}

function parseChatGpt(root: unknown): CanonicalConversation[] {
  const records = chatGptRecords(root).filter((item) => item.mapping && typeof item.mapping === "object");
  return records.map((conversation, conversationIndex) => {
    const mapping = recordOf(conversation.mapping);
    const nodes = Object.entries(mapping).map(([nodeId, raw]) => ({ nodeId, node: recordOf(raw) }));
    const parentIds = new Set(nodes.map(({ node }) => textOf(node.parent)).filter(Boolean));
    const currentNode = textOf(conversation.current_node);
    const fallbackLeaf = [...nodes].reverse().find(({ nodeId }) => !parentIds.has(nodeId))?.nodeId;
    const selectedLeaf = currentNode && mapping[currentNode] ? currentNode : fallbackLeaf || nodes.at(-1)?.nodeId || "";
    const selectedPath: string[] = [];
    const selectedIds = new Set<string>();
    let cursor = selectedLeaf;
    while (cursor && !selectedIds.has(cursor)) {
      selectedIds.add(cursor);
      selectedPath.push(cursor);
      cursor = textOf(recordOf(mapping[cursor]).parent);
    }
    const ordered = selectedPath.reverse().map((nodeId) => ({ nodeId, node: recordOf(mapping[nodeId]) }));
    let attachmentCount = 0;
    const messages = ordered.flatMap(({ nodeId, node }, messageIndex): CanonicalMessage[] => {
      const message = recordOf(node.message);
      if (!Object.keys(message).length) return [];
      const author = recordOf(message.author);
      const content = recordOf(message.content);
      const normalized = contentParts(content.parts ?? content.text ?? message.content);
      const messageMetadata = recordOf(message.metadata);
      const metadataAttachments = arrayOf(messageMetadata.attachments);
      attachmentCount += normalized.attachmentCount + metadataAttachments.length;
      const role = normalizeRole(author.role || message.role);
      return [{
        id: `chatgpt-message-${stableHash(`${nodeId}:${messageIndex}`)}`,
        external_id: textOf(message.id || nodeId),
        role,
        author_name: textOf(author.name),
        model: textOf(messageMetadata.model_slug || message.model),
        created_at: isoDate(message.create_time || message.created_at),
        parent_external_id: textOf(node.parent) || undefined,
        text: appendAttachmentMarkers(normalized.text, metadataAttachments),
        reasoning: normalized.reasoning,
        tool_events: normalized.toolEvents,
        metadata: { source_node_id: nodeId, content_type: content.content_type, attachments: metadataAttachments },
      }];
    });
    const assistantName = messages.find((message) => message.role === "assistant")?.author_name || "ChatGPT";
    const externalId = textOf(conversation.id || conversation.conversation_id) || `conversation-${conversationIndex}`;
    return {
      id: `chatgpt-${stableHash(externalId)}`,
      external_id: externalId,
      source: "chatgpt",
      title: textOf(conversation.title),
      created_at: isoDate(conversation.create_time || conversation.created_at),
      updated_at: isoDate(conversation.update_time || conversation.updated_at),
      messages,
      source_identities: [identityFor("chatgpt", assistantName, messages.filter((item) => item.role === "assistant").length)],
      branch_count: Math.max(1, nodes.filter(({ nodeId }) => !parentIds.has(nodeId)).length),
      attachment_count: attachmentCount,
      metadata: {
        selected_leaf: selectedLeaf,
        branch_node_ids: nodes.filter(({ nodeId }) => !selectedIds.has(nodeId)).map(({ nodeId }) => nodeId),
      },
    };
  });
}

function claudeRecords(root: unknown): Record<string, unknown>[] {
  if (Array.isArray(root)) return root.map(recordOf);
  const value = recordOf(root);
  for (const key of ["conversations", "chats", "data"]) {
    if (Array.isArray(value[key])) return arrayOf(value[key]).map(recordOf);
  }
  return Array.isArray(value.chat_messages) || Array.isArray(value.messages) ? [value] : [];
}

function parseClaude(root: unknown): CanonicalConversation[] {
  return claudeRecords(root)
    .filter((item) => Array.isArray(item.chat_messages) || Array.isArray(item.messages))
    .map((conversation, conversationIndex) => {
      const sourceMessages = arrayOf(conversation.chat_messages || conversation.messages).map(recordOf);
      let attachmentCount = 0;
      const allMessages = sourceMessages.map((message, messageIndex): CanonicalMessage => {
        const normalized = contentParts(message.content ?? message.text ?? message.message);
        const topLevelText = [message.text, message.message]
          .find((value): value is string => typeof value === "string")
          ?.trim() || "";
        const mergedText = topLevelText && !normalized.text.includes(topLevelText)
          ? [topLevelText, normalized.text].filter(Boolean).join("\n")
          : normalized.text || topLevelText;
        const externalAttachments = [
          ...arrayOf(message.attachments),
          ...arrayOf(message.files),
          ...arrayOf(message.files_v2),
        ];
        attachmentCount += normalized.attachmentCount + externalAttachments.length;
        const role = normalizeRole(message.sender || message.role || recordOf(message.author).role);
        const externalId = textOf(message.uuid || message.id) || `message-${messageIndex}`;
        return {
          id: `claude-message-${stableHash(`${externalId}:${messageIndex}`)}`,
          external_id: externalId,
          role,
          author_name: role === "assistant" ? "Claude" : undefined,
          model: textOf(message.model),
          created_at: isoDate(message.created_at || message.createdAt || message.timestamp),
          parent_external_id: textOf(message.parent_uuid || message.parent_id || message.parent_message_uuid) || undefined,
          text: appendAttachmentMarkers(mergedText, externalAttachments),
          reasoning: normalized.reasoning,
          tool_events: normalized.toolEvents,
          metadata: { attachments: externalAttachments },
        };
      });
      const externalId = textOf(conversation.uuid || conversation.id || conversation.conversation_id) || `conversation-${conversationIndex}`;
      const byMessageId = new Map(allMessages.map((message) => [message.external_id || message.id, message]));
      const explicitGraph = allMessages.some((message) => message.parent_external_id && byMessageId.has(message.parent_external_id));
      const parentIds = new Set(allMessages
        .map((message) => message.parent_external_id)
        .filter((id): id is string => typeof id === "string" && Boolean(id) && byMessageId.has(id)));
      const leaves = allMessages.filter((message) => !parentIds.has(message.external_id || message.id));
      const requestedLeaf = textOf(conversation.current_leaf_message_uuid || conversation.current_leaf_uuid || conversation.current_message_uuid);
      const selectedLeaf = requestedLeaf && byMessageId.has(requestedLeaf)
        ? requestedLeaf
        : leaves.at(-1)?.external_id || leaves.at(-1)?.id || "";
      const selectedIds = new Set<string>();
      const selectedPath: CanonicalMessage[] = [];
      if (explicitGraph) {
        let cursor = selectedLeaf;
        while (cursor && !selectedIds.has(cursor)) {
          const message = byMessageId.get(cursor);
          if (!message) break;
          selectedIds.add(cursor);
          selectedPath.push(message);
          cursor = message.parent_external_id || "";
        }
        selectedPath.reverse();
      }
      const messages = explicitGraph ? selectedPath : allMessages;
      const alternateMessages = explicitGraph
        ? allMessages.filter((message) => !selectedIds.has(message.external_id || message.id))
        : [];
      return {
        id: `claude-${stableHash(externalId)}`,
        external_id: externalId,
        source: "claude",
        title: textOf(conversation.name || conversation.title),
        created_at: isoDate(conversation.created_at || conversation.createdAt),
        updated_at: isoDate(conversation.updated_at || conversation.updatedAt),
        messages,
        source_identities: [identityFor("claude", "Claude", messages.filter((item) => item.role === "assistant").length)],
        branch_count: explicitGraph ? Math.max(1, leaves.length) : 1,
        attachment_count: attachmentCount,
        metadata: {
          account: conversation.account || conversation.account_uuid,
          selected_leaf: selectedLeaf || null,
          alternate_messages: alternateMessages,
        },
      };
    });
}

function astrBotRecords(root: unknown): Record<string, unknown>[] {
  if (Array.isArray(root)) return root.map(recordOf);
  const value = recordOf(root);
  const data = value.data;
  if (Array.isArray(data)) return data.map(recordOf);
  const dataRecord = recordOf(data);
  for (const key of ["conversations", "items", "list", "records"]) {
    if (Array.isArray(dataRecord[key])) return arrayOf(dataRecord[key]).map(recordOf);
    if (Array.isArray(value[key])) return arrayOf(value[key]).map(recordOf);
  }
  return value.history || value.content ? [value] : [];
}

function parseHistory(value: unknown) {
  if (typeof value !== "string") return arrayOf(value);
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed : arrayOf(recordOf(parsed).messages || recordOf(parsed).history);
  } catch {
    return [{ role: "unknown", content: value }];
  }
}

function parseAstrBot(root: unknown): CanonicalConversation[] {
  return astrBotRecords(root).map((conversation, conversationIndex) => {
    const history = parseHistory(conversation.history ?? conversation.content ?? conversation.messages);
    let attachmentCount = 0;
    const messages = history.map((raw, messageIndex): CanonicalMessage => {
      const message = recordOf(raw);
      const normalized = contentParts(message.content ?? message.message ?? message.text);
      attachmentCount += normalized.attachmentCount;
      const role = normalizeRole(message.role || message.sender || message.type);
      const externalId = textOf(message.id || message.message_id) || `message-${messageIndex}`;
      return {
        id: `astrbot-message-${stableHash(`${externalId}:${messageIndex}`)}`,
        external_id: externalId,
        role,
        author_name: textOf(message.author_name || message.name),
        model: textOf(message.model),
        created_at: isoDate(message.created_at || message.timestamp || message.time),
        text: normalized.text,
        reasoning: normalized.reasoning,
        tool_events: normalized.toolEvents,
        metadata: { platform_message: message.metadata },
      };
    });
    const externalId = textOf(conversation.conversation_id || conversation.cid || conversation.id) || `conversation-${conversationIndex}`;
    const personaName = textOf(conversation.persona_name || conversation.persona_id) || "AstrBot";
    const platformId = textOf(conversation.platform_id || conversation.platform || recordOf(conversation.unified_msg_origin).platform_id);
    const identity = identityFor("astrbot", personaName, messages.filter((item) => item.role === "assistant").length);
    identity.platform_id = platformId || null;
    identity.provenance = {
      source_user_id: conversation.user_id,
      source_persona_id: conversation.persona_id,
      unified_msg_origin: conversation.unified_msg_origin,
    };
    return {
      id: `astrbot-${stableHash(externalId)}`,
      external_id: externalId,
      source: "astrbot",
      title: textOf(conversation.title || conversation.name),
      created_at: isoDate(conversation.created_at),
      updated_at: isoDate(conversation.updated_at),
      messages,
      source_identities: [identity],
      branch_count: 1,
      attachment_count: attachmentCount,
      metadata: {
        platform_id: platformId,
        user_id: conversation.user_id,
        persona_id: conversation.persona_id,
        group_id: conversation.group_id,
        scope: conversation.group_id ? "group" : "private",
      },
    };
  });
}

function kelivoRecords(root: unknown): Record<string, unknown>[] {
  if (Array.isArray(root)) return root.map(recordOf);
  const value = recordOf(root);
  for (const key of ["conversations", "chats", "sessions", "data"]) {
    if (Array.isArray(value[key])) return arrayOf(value[key]).map(recordOf);
  }
  return Array.isArray(value.messages) ? [value] : [];
}

function kelivoSelectedMessages(backup: Record<string, unknown>, conversation: Record<string, unknown>) {
  const allMessages = arrayOf(backup.messages).map(recordOf);
  const messageById = new Map(allMessages.map((message) => [textOf(message.id || message.message_id), message]));
  const requestedIds = arrayOf(conversation.messageIds || conversation.message_ids).map(textOf).filter(Boolean);
  const conversationId = textOf(conversation.id || conversation.session_id || conversation.conversation_id);
  const candidates = requestedIds.length
    ? requestedIds.map((id) => messageById.get(id)).filter((item): item is Record<string, unknown> => Boolean(item))
    : allMessages.filter((message) => textOf(message.conversationId || message.conversation_id || message.session_id) === conversationId);
  const selections = recordOf(conversation.versionSelections || conversation.version_selections);
  const groups = new Map<string, Record<string, unknown>[]>();
  for (const message of candidates) {
    const groupId = textOf(message.groupId || message.group_id);
    if (!groupId) continue;
    const rows = groups.get(groupId) || [];
    rows.push(message);
    groups.set(groupId, rows);
  }
  const selectedMessageIds = new Set<string>();
  let branchCount = 1;
  for (const [groupId, rows] of groups) {
    branchCount += Math.max(0, rows.length - 1);
    const requestedVersion = selections[groupId];
    const selected = requestedVersion == null
      ? [...rows].sort((left, right) => Number(right.version || 0) - Number(left.version || 0))[0]
      : rows.find((message) => textOf(message.version) === textOf(requestedVersion)) || rows.at(-1);
    if (selected) selectedMessageIds.add(textOf(selected.id || selected.message_id));
  }
  return {
    messages: candidates.filter((message) => {
      const groupId = textOf(message.groupId || message.group_id);
      return !groupId || selectedMessageIds.has(textOf(message.id || message.message_id));
    }),
    branchCount,
  };
}

function parseKelivo(root: unknown): CanonicalConversation[] {
  const backup = recordOf(root);
  const isWholeBackup = Array.isArray(backup.conversations) && Array.isArray(backup.messages);
  const records = isWholeBackup ? arrayOf(backup.conversations).map(recordOf) : kelivoRecords(root);
  const rootToolEvents = recordOf(backup.toolEvents || backup.tool_events);
  const rootThoughtSignatures = recordOf(backup.geminiThoughtSigs || backup.gemini_thought_sigs || backup.thoughtSignatures);
  return records
    .filter((item) => isWholeBackup || Array.isArray(item.messages) || Array.isArray(item.history))
    .map((conversation, conversationIndex) => {
      const selected = isWholeBackup
        ? kelivoSelectedMessages(backup, conversation)
        : { messages: arrayOf(conversation.messages || conversation.history).map(recordOf), branchCount: 1 };
      const rawMessages = selected.messages;
      let attachmentCount = 0;
      const messages = rawMessages.map((raw, messageIndex): CanonicalMessage => {
        const message = recordOf(raw);
        const parts = Array.isArray(message.parts) && message.parts.length ? message.parts : message.content ?? message.text;
        const normalized = contentParts(parts);
        attachmentCount += normalized.attachmentCount + arrayOf(message.attachments).length;
        const role = normalizeRole(message.role || message.sender);
        const externalId = textOf(message.id || message.message_id) || `message-${messageIndex}`;
        const thoughtSignature = message.thought_signature || message.thoughtSignature || rootThoughtSignatures[externalId];
        const historicalToolEvents = arrayOf(rootToolEvents[externalId]).map((item) => ({
          ...recordOf(item),
          type: "historical_external_tool",
          status: "历史记录 · 未执行",
        }));
        return {
          id: `kelivo-message-${stableHash(`${externalId}:${messageIndex}`)}`,
          external_id: externalId,
          role,
          author_name: textOf(message.author_name || message.name),
          model: textOf(message.model || message.modelId || message.model_id),
          created_at: isoDate(message.created_at || message.createdAt || message.timestamp),
          text: normalized.text,
          reasoning: normalized.reasoning || textOf(message.reasoningText || message.reasoning_text) || undefined,
          tool_events: [...normalized.toolEvents, ...historicalToolEvents],
          metadata: {
            thought_signature: thoughtSignature,
            tool_events: message.toolEvents || message.tool_events || rootToolEvents[externalId],
            group_id: message.groupId || message.group_id,
            version: message.version,
          },
        };
      });
      const externalId = textOf(conversation.id || conversation.session_id || conversation.conversation_id) || `conversation-${conversationIndex}`;
      const assistantName = textOf(conversation.assistant_name || conversation.model_name) || "Kelivo Assistant";
      return {
        id: `kelivo-${stableHash(externalId)}`,
        external_id: externalId,
        source: "kelivo",
        title: textOf(conversation.title || conversation.name),
        created_at: isoDate(conversation.created_at || conversation.createdAt),
        updated_at: isoDate(conversation.updated_at || conversation.updatedAt),
        messages,
        source_identities: [identityFor("kelivo", assistantName, messages.filter((item) => item.role === "assistant").length)],
        branch_count: selected.branchCount,
        attachment_count: attachmentCount,
        metadata: {
          format_version: backup.version || backup.formatVersion || backup.format_version || conversation.formatVersion || conversation.format_version,
          assistant_id: conversation.assistantId || conversation.assistant_id,
          version_selections: conversation.versionSelections || conversation.version_selections,
        },
      };
    });
}

function looksLikeChatGpt(root: unknown) {
  return chatGptRecords(root).some((item) => item.mapping && typeof item.mapping === "object");
}

function looksLikeClaude(root: unknown) {
  return claudeRecords(root).some((item) => Array.isArray(item.chat_messages)
    || arrayOf(item.messages).some((message) => ["human", "assistant"].includes(textOf(recordOf(message).sender))));
}

function looksLikeAstrBot(root: unknown) {
  return astrBotRecords(root).some((item) => Boolean(item.platform_id || item.cid || item.conversation_id && item.persona_id));
}

function looksLikeKelivo(root: unknown) {
  const value = recordOf(root);
  const wholeBackup = Array.isArray(value.conversations)
    && Array.isArray(value.messages)
    && (Boolean(value.version || value.formatVersion || value.format_version || value.toolEvents || value.geminiThoughtSigs)
      || arrayOf(value.conversations).some((item) => Array.isArray(recordOf(item).messageIds || recordOf(item).message_ids)));
  return wholeBackup || Boolean(value.formatVersion || value.format_version || value.toolEvents || value.thoughtSignatures)
    || kelivoRecords(root).some((item) => Boolean(item.session_id || item.parts || item.assistant_name));
}

function parseKnownRoot(root: unknown, sourceName: string) {
  if (looksLikeChatGpt(root)) return { platform: "chatgpt", formatId: "chatgpt-standalone-json-v1", conversations: parseChatGpt(root) };
  if (looksLikeClaude(root)) return { platform: "claude", formatId: "claude-standalone-json-v1", conversations: parseClaude(root) };
  if (looksLikeAstrBot(root)) return { platform: "astrbot", formatId: "astrbot-standalone-jsonl-v1", conversations: parseAstrBot(root) };
  if (looksLikeKelivo(root) || /kelivo|session\.json/i.test(sourceName)) return { platform: "kelivo", formatId: "kelivo-standalone-json-v1", conversations: parseKelivo(root) };
  throw new Error("无法识别这个导出文件的内部结构；请确认它来自 ChatGPT、Claude、AstrBot 或 Kelivo 的官方导出。 ");
}

function parseJsonOrJsonl(text: string, sourceName: string) {
  const normalized = text.replace(/^\uFEFF/, "").trim();
  if (!normalized) throw new Error("导出文件为空");
  try {
    return parseKnownRoot(JSON.parse(normalized) as unknown, sourceName);
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
  }
  const rows: unknown[] = [];
  const warnings: ExternalImportWarning[] = [];
  normalized.split(/\r?\n/).forEach((line, index) => {
    if (!line.trim()) return;
    try {
      rows.push(JSON.parse(line) as unknown);
    } catch {
      warnings.push({ code: "invalid_jsonl_line", message: `第 ${index + 1} 行无法解析，已跳过。` });
    }
  });
  if (!rows.length) throw new Error("文件既不是有效 JSON，也没有可解析的 JSONL 记录");
  const parsed = parseKnownRoot(rows, sourceName);
  return { ...parsed, warnings };
}

function unzip(bytes: Uint8Array) {
  try {
    return new Map(Object.entries(unzipSync(bytes)));
  } catch {
    throw new Error("ZIP 文件不完整、带密码或使用了不支持的压缩格式；请检查导出文件，或连接 FastAPI 后重试。");
  }
}

function isSqlite(bytes: Uint8Array) {
  return new TextDecoder("ascii").decode(bytes.slice(0, 16)) === "SQLite format 3\u0000";
}

async function parseFile(file: File) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (isSqlite(bytes)) {
    throw new Error("检测到 Kelivo SQLite 备份。本机模式不会猜测数据库结构；请连接 FastAPI 后选择同一文件，即可一键导入。");
  }
  const lowerName = file.name.toLowerCase();
  if (!lowerName.endsWith(".zip")) {
    return parseJsonOrJsonl(new TextDecoder("utf-8").decode(bytes), file.name);
  }
  const entries = await unzip(bytes);
  for (const [name, entry] of entries) {
    if (isSqlite(entry)) {
      throw new Error("检测到 Kelivo SQLite 备份。本机模式不会误解析；请连接 FastAPI 后选择同一 ZIP，即可一键导入。");
    }
    if (name.toLowerCase().endsWith(".zip")) {
      const nested = await unzip(entry);
      for (const [nestedName, nestedEntry] of nested) entries.set(`${name}/${nestedName}`, nestedEntry);
    }
  }
  const candidates = [...entries.entries()].filter(([name]) => /(?:\.jsonl?|conversations[^/]*\.json)$/i.test(name));
  if (!candidates.length) throw new Error("ZIP 中没有找到可识别的 JSON / JSONL 对话文件");
  const parsed: Array<ReturnType<typeof parseJsonOrJsonl>> = [];
  const errors: string[] = [];
  for (const [name, entry] of candidates) {
    try {
      const item = parseJsonOrJsonl(new TextDecoder("utf-8").decode(entry), name);
      if (item.conversations.length) parsed.push(item);
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }
  if (!parsed.length) throw new Error(errors[0] || "ZIP 中的对话结构无法识别");
  const platform = parsed[0].platform;
  const samePlatform = parsed.filter((item) => item.platform === platform);
  return {
    platform,
    formatId: `${samePlatform[0].formatId.replace(/-jsonl?-v1$/, "")}-zip-v1`,
    conversations: samePlatform.flatMap((item) => item.conversations),
    warnings: samePlatform.flatMap((item) => "warnings" in item ? item.warnings || [] : []),
  };
}

function fallbackRead() {
  try {
    const value = JSON.parse(localStorage.getItem(fallbackStorageKey) || "[]") as StoredImportBatch[];
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

function fallbackWrite(rows: StoredImportBatch[]) {
  localStorage.setItem(fallbackStorageKey, JSON.stringify(rows));
}

function openDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(databaseName, 1);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(objectStoreName)) database.createObjectStore(objectStoreName, { keyPath: "public.id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("无法打开本机导入存储"));
  });
}

async function allBatches(): Promise<StoredImportBatch[]> {
  if (typeof indexedDB === "undefined") return fallbackRead();
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const request = database.transaction(objectStoreName, "readonly").objectStore(objectStoreName).getAll();
    request.onsuccess = () => { database.close(); resolve(request.result as StoredImportBatch[]); };
    request.onerror = () => { database.close(); reject(request.error || new Error("无法读取本机导入批次")); };
  });
}

async function getBatch(id: string): Promise<StoredImportBatch | null> {
  if (typeof indexedDB === "undefined") return fallbackRead().find((item) => item.public.id === id) || null;
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const request = database.transaction(objectStoreName, "readonly").objectStore(objectStoreName).get(id);
    request.onsuccess = () => { database.close(); resolve(request.result as StoredImportBatch | undefined || null); };
    request.onerror = () => { database.close(); reject(request.error || new Error("无法读取本机导入批次")); };
  });
}

async function putBatch(batch: StoredImportBatch) {
  if (typeof indexedDB === "undefined") {
    const rows = fallbackRead().filter((item) => item.public.id !== batch.public.id);
    rows.push(batch);
    fallbackWrite(rows.slice(-50));
    return;
  }
  const database = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(objectStoreName, "readwrite");
    transaction.objectStore(objectStoreName).put(batch);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error("无法保存本机导入批次"));
    transaction.onabort = () => reject(transaction.error || new Error("保存本机导入批次已中止"));
  });
  database.close();
}

async function withWorkspaceOperation<T>(label: string, operation: () => Promise<T>) {
  if (activeWorkspaceOperation) throw new Error("另一个导入操作正在提交或撤销，请稍候再试。");
  activeWorkspaceOperation = label;
  try {
    return await operation();
  } finally {
    if (activeWorkspaceOperation === label) activeWorkspaceOperation = "";
  }
}

function sourceKey(conversation: CanonicalConversation) {
  return `${conversation.source}:${conversation.external_id || conversation.id}:${stableHash(conversation.messages.map((message) => `${message.role}:${message.text}`).join("\n"))}`;
}

function publicBatch(batch: StoredImportBatch) {
  return structuredClone(batch.public);
}

function summarize(conversation: CanonicalConversation, duplicates: Set<string>): ExternalConversationSummary {
  const roleCounts: Record<string, number> = {};
  let nonText = 0;
  for (const message of conversation.messages) {
    roleCounts[message.role] = (roleCounts[message.role] || 0) + 1;
    nonText += (message.reasoning ? 1 : 0) + (message.tool_events?.length || 0);
  }
  const key = sourceKey(conversation);
  return {
    canonical_conversation_id: conversation.id,
    source_conversation_id: conversation.external_id || null,
    title: conversation.title || "未命名外部对话",
    created_at: conversation.created_at || null,
    updated_at: conversation.updated_at || null,
    message_count: conversation.messages.length,
    role_counts: roleCounts,
    branch_count: conversation.branch_count,
    non_text_block_count: nonText,
    attachment_count: conversation.attachment_count,
    warning_count: 0,
    warning_codes: [],
    selected: !duplicates.has(key),
    source_context: conversation.metadata,
    source_identities: conversation.source_identities,
    possible_duplicate: duplicates.has(key),
  };
}

export async function previewStandaloneExternalImportFile(file: File): Promise<ExternalImportBatch> {
  const parsed = await parseFile(file);
  if (!parsed.conversations.length) throw new Error("没有找到可导入的对话");
  const canonicalIdCounts = new Map<string, number>();
  const canonicalConversations = parsed.conversations.map((conversation) => {
    const occurrence = canonicalIdCounts.get(conversation.id) || 0;
    canonicalIdCounts.set(conversation.id, occurrence + 1);
    return occurrence ? { ...conversation, id: `${conversation.id}-duplicate-${occurrence + 1}` } : conversation;
  });
  const previous = await allBatches();
  const duplicates = new Set(previous
    .filter((item) => item.public.status === "committed")
    .flatMap((item) => item.source_keys));
  const parsedWarnings = (parsed as { warnings?: unknown }).warnings;
  const warnings: ExternalImportWarning[] = Array.isArray(parsedWarnings)
    ? parsedWarnings as ExternalImportWarning[]
    : [];
  const summaries = canonicalConversations.map((conversation) => {
    const summary = summarize(conversation, duplicates);
    duplicates.add(sourceKey(conversation));
    return summary;
  });
  const selectedIds = summaries.filter((summary) => !summary.possible_duplicate).map((summary) => summary.canonical_conversation_id);
  const roleCounts: Record<string, number> = {};
  for (const summary of summaries) {
    for (const [role, count] of Object.entries(summary.role_counts)) roleCounts[role] = (roleCounts[role] || 0) + count;
  }
  const stamp = new Date().toISOString();
  const publicValue: ExternalImportBatch = {
    id: makeId("standalone-import"),
    format_id: parsed.formatId,
    platform: parsed.platform,
    source_name: file.name,
    status: "previewed",
    conversation_count: summaries.length,
    message_count: summaries.reduce((sum, item) => sum + item.message_count, 0),
    warnings,
    created_at: stamp,
    defaults: { archived: true, provider_id: null, persona_id: null, memories_created: 0 },
    conversation_summaries: summaries,
    preview: summaries,
    statistics: {
      conversation_count: summaries.length,
      message_count: summaries.reduce((sum, item) => sum + item.message_count, 0),
      role_counts: roleCounts,
      branch_count: summaries.reduce((sum, item) => sum + item.branch_count, 0),
      non_text_block_count: summaries.reduce((sum, item) => sum + item.non_text_block_count, 0),
      attachment_count: summaries.reduce((sum, item) => sum + item.attachment_count, 0),
      warning_count: warnings.length,
      source_identity_count: new Set(summaries.flatMap((item) => item.source_identities.map((identity) => identity.id))).size,
      selected_conversation_count: selectedIds.length,
      possible_duplicate_count: summaries.filter((item) => item.possible_duplicate).length,
    },
    selection: {
      default: "exclude_duplicates",
      selected_conversation_ids: selectedIds,
      excluded_conversation_ids: summaries.filter((item) => !selectedIds.includes(item.canonical_conversation_id)).map((item) => item.canonical_conversation_id),
    },
  };
  await putBatch({
    public: publicValue,
    canonical: canonicalConversations,
    source_keys: canonicalConversations.map(sourceKey),
    imported: [],
  });
  return publicBatch({ public: publicValue, canonical: [], source_keys: [], imported: [] });
}

function importedMessage(
  message: CanonicalMessage,
  conversationId: string,
  index: number,
  batchId: string,
  importedAt: string,
  source: CanonicalConversation,
): Message {
  const id = `external-message-${stableHash(`${conversationId}:${message.external_id || message.id}:${index}`)}`;
  const role: Message["role"] = message.role === "user" ? "user" : message.role === "assistant" ? "assistant" : "system";
  const prefix = message.role === "tool" ? "[历史工具记录 · 未执行]\n" : message.role === "unknown" ? "[外部未知角色]\n" : "";
  return {
    id,
    role,
    content: `${prefix}${message.text || "[空消息]"}`,
    reasoning: message.reasoning,
    model: message.model,
    created_at: message.created_at,
    parent_message_id: null,
    selected: true,
    tool_events: message.tool_events,
    external_import: {
      source_domain: source.source,
      source_conversation_id: source.external_id || null,
      source_message_id: message.external_id || null,
      import_batch_id: batchId,
      imported_at: importedAt,
      original_timestamp: message.created_at || null,
      source_context: message.metadata,
    },
  };
}

async function commitBatch(id: string, body: ExternalImportCommitRequest, runtime: StandaloneImportRuntime) {
  const batch = await getBatch(id);
  if (!batch) throw new Error("导入批次不存在");
  if (batch.public.status === "committed") return publicBatch(batch);
  if (batch.public.status !== "previewed") throw new Error("这个导入批次已经撤销");
  const selected = new Set(arrayOf(body.selected_conversation_ids).map(textOf).filter(Boolean));
  if (!selected.size) throw new Error("请至少选择一段对话");
  const selectedCanonical = batch.canonical.filter((conversation) => selected.has(conversation.id));
  const selectedSourceKeys = new Set<string>();
  if (selectedCanonical.some((conversation) => {
    const key = sourceKey(conversation);
    if (selectedSourceKeys.has(key)) return true;
    selectedSourceKeys.add(key);
    return false;
  })) {
    throw new Error("所选内容包含重复对话，请保留其中一份后再导入。");
  }
  const committedSourceKeys = new Set((await allBatches())
    .filter((item) => item.public.status === "committed" && item.public.id !== id)
    .flatMap((item) => item.source_keys));
  if (selectedCanonical.some((conversation) => committedSourceKeys.has(sourceKey(conversation)))) {
    throw new Error("所选对话已由另一个导入批次写入，请重新选择文件刷新重复项预览。");
  }
  const workspace = runtime.readWorkspace();
  const next: StandaloneImportWorkspace = {
    personas: [...workspace.personas],
    conversations: [...workspace.conversations],
    messages: { ...workspace.messages },
  };
  const imported: ImportedObjectRecord[] = [];
  const publicRecords: NonNullable<ExternalImportBatch["conversations"]> = [];
  const mapping = body.persona_mapping && typeof body.persona_mapping === "object" ? body.persona_mapping : {};
  const committedAt = new Date().toISOString();
  for (const canonical of batch.canonical) {
    if (!selected.has(canonical.id)) continue;
    const identity = canonical.source_identities.find((item) => item.kind === "assistant");
    const mappedPersonaId = identity ? textOf(mapping[identity.id]).trim() : "";
    const persona = mappedPersonaId ? next.personas.find((item) => item.id === mappedPersonaId) : undefined;
    if (mappedPersonaId && !persona) throw new Error(`映射的 Persona 不存在：${mappedPersonaId}`);
    const conversationId = makeId("external-conversation");
    const createdAt = canonical.created_at || batch.public.created_at;
    const rows = canonical.messages.map((message, index) => importedMessage(
      message,
      conversationId,
      index,
      batch.public.id,
      committedAt,
      canonical,
    ));
    const providerId = persona?.provider_id || persona?.config?.provider_id || null;
    next.conversations.push({
      id: conversationId,
      title: canonical.title || "未命名外部对话",
      provider_id: providerId,
      persona_id: persona?.id || null,
      created_at: createdAt,
      updated_at: canonical.updated_at || createdAt,
      archived: true,
      summary: "",
      archived_message_ids: [],
      external_import: {
        source_domain: canonical.source,
        source_conversation_id: canonical.external_id || null,
        import_batch_id: batch.public.id,
        imported_at: committedAt,
        original_timestamp: canonical.created_at || null,
        source_context: canonical.metadata,
      },
    });
    next.messages[conversationId] = rows;
    imported.push({ conversation_id: conversationId, message_ids: rows.map((row) => row.id || "").filter(Boolean), source_key: sourceKey(canonical) });
    publicRecords.push({
      conversation_id: conversationId,
      source_conversation_id: canonical.external_id || null,
      canonical_conversation_id: canonical.id,
      imported_message_count: rows.length,
      created_at: batch.public.created_at,
    });
  }
  if (!imported.length) throw new Error("所选对话在批次中不存在");
  try {
    runtime.writeWorkspace(next);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/quota|storage|容量|空间/i.test(message)) {
      throw new Error("本机存储空间不足以容纳这个导出；请连接 FastAPI 后选择同一文件，服务器会流式导入。 ");
    }
    throw error;
  }
  batch.imported = imported;
  batch.source_keys = imported.map((item) => item.source_key);
  batch.public = {
    ...batch.public,
    status: "committed",
    committed_at: committedAt,
    conversations: publicRecords,
    created_conversation_ids: imported.map((item) => item.conversation_id),
    selection: {
      default: "user_selected",
      selected_conversation_ids: [...selected],
      excluded_conversation_ids: batch.canonical.filter((item) => !selected.has(item.id)).map((item) => item.id),
    },
  };
  try {
    await putBatch(batch);
  } catch (error) {
    try {
      runtime.writeWorkspace(workspace);
    } catch {
      throw new Error("导入账本保存失败，且聊天库无法自动恢复；请重新打开应用后撤销这个导入批次。");
    }
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`导入账本保存失败，聊天写入已自动撤销：${detail}`);
  }
  return publicBatch(batch);
}

async function rollbackBatch(id: string, runtime: StandaloneImportRuntime) {
  const batch = await getBatch(id);
  if (!batch) throw new Error("导入批次不存在");
  if (batch.public.status === "rolled_back") return publicBatch(batch);
  let workspaceBeforeRollback: StandaloneImportWorkspace | null = null;
  if (batch.public.status === "committed") {
    const workspace = runtime.readWorkspace();
    workspaceBeforeRollback = workspace;
    const next: StandaloneImportWorkspace = {
      personas: [...workspace.personas],
      conversations: [...workspace.conversations],
      messages: { ...workspace.messages },
    };
    const removeConversations = new Set<string>();
    for (const imported of batch.imported) {
      const importedIds = new Set(imported.message_ids);
      const current = next.messages[imported.conversation_id] || [];
      const remaining = current.filter((message) => !importedIds.has(message.id || message.client_id || ""));
      if (remaining.length) next.messages[imported.conversation_id] = remaining;
      else {
        delete next.messages[imported.conversation_id];
        removeConversations.add(imported.conversation_id);
      }
    }
    next.conversations = next.conversations.filter((conversation) => !removeConversations.has(conversation.id));
    runtime.writeWorkspace(next);
  }
  batch.public = { ...batch.public, status: "rolled_back", rolled_back_at: new Date().toISOString() };
  try {
    await putBatch(batch);
  } catch (error) {
    if (workspaceBeforeRollback) {
      try {
        runtime.writeWorkspace(workspaceBeforeRollback);
      } catch {
        throw new Error("撤销账本保存失败，且聊天库无法自动恢复；请重新打开应用后再次撤销。");
      }
    }
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`撤销账本保存失败，聊天内容已自动恢复：${detail}`);
  }
  return publicBatch(batch);
}

function bodyOf(init: RequestInit) {
  if (typeof init.body !== "string" || !init.body) return {};
  const parsed = JSON.parse(init.body) as unknown;
  return recordOf(parsed);
}

export function isStandaloneImportPath(path: string) {
  return path === "/api/imports/formats" || path.startsWith("/api/imports/") || path.startsWith("/api/imports?");
}

export async function requestStandaloneImportJson<T>(
  path: string,
  init: RequestInit,
  runtime: StandaloneImportRuntime,
): Promise<T> {
  const method = textOf(init.method || "GET").toUpperCase();
  if (path === "/api/imports/formats" && method === "GET") {
    return { formats: ["chatgpt", "claude", "astrbot", "kelivo"] } as T;
  }
  if (path.startsWith("/api/imports/batches?") && method === "GET") {
    const rows = (await allBatches()).sort((left, right) => right.public.created_at.localeCompare(left.public.created_at));
    return { batches: rows.slice(0, 30).map(publicBatch) } as T;
  }
  const match = path.match(/^\/api\/imports\/batches\/([^/?]+)(?:\/(commit|rollback))?$/);
  if (match) {
    const id = decodeURIComponent(match[1]);
    if (!match[2] && method === "GET") {
      const batch = await getBatch(id);
      if (!batch) throw new Error("导入批次不存在");
      return publicBatch(batch) as T;
    }
    if (match[2] === "commit" && method === "POST") {
      const body = bodyOf(init);
      return await withWorkspaceOperation(`commit:${id}`, async () => await commitBatch(id, {
        selected_conversation_ids: arrayOf(body.selected_conversation_ids).map(textOf),
        persona_mapping: recordOf(body.persona_mapping) as Record<string, string | null>,
      }, runtime)) as T;
    }
    if (match[2] === "rollback" && method === "POST") {
      return await withWorkspaceOperation(`rollback:${id}`, async () => await rollbackBatch(id, runtime)) as T;
    }
  }
  throw new Error(`Android 本机导入尚不支持 ${method} ${path}`);
}
