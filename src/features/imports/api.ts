import { getApiBase, requestJson, requestNativeImportPreview } from "../../adapters/fastapi/client";
import { isStandaloneAndroid } from "../../adapters/standalone/store";
import { previewStandaloneExternalImportFile } from "../../adapters/standalone/imports";
import type { ExternalImportBatch, ExternalImportCommitRequest } from "./types";
import type { Message } from "../../domain/types";

export function externalImportAvailable() {
  return Boolean(getApiBase()) || isStandaloneAndroid();
}

function fileBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("无法读取导入文件"));
    reader.onload = () => {
      const value = typeof reader.result === "string" ? reader.result : "";
      const comma = value.indexOf(",");
      if (comma < 0) reject(new Error("无法读取导入文件"));
      else resolve(value.slice(comma + 1));
    };
    reader.readAsDataURL(file);
  });
}

async function readUploadResponse(response: Response) {
  const text = await response.text();
  if (response.ok) {
    try {
      return JSON.parse(text) as ExternalImportBatch;
    } catch {
      throw new Error("后端返回了无法识别的导入结果");
    }
  }
  let detail: unknown;
  try {
    const payload = JSON.parse(text) as { detail?: unknown; error?: unknown };
    detail = payload.detail ?? payload.error;
  } catch {
    detail = undefined;
  }
  throw new Error(typeof detail === "string" ? detail : `HTTP ${response.status}`);
}

async function previewBrowserFile(file: File) {
  const params = new URLSearchParams({ source_name: file.name });
  const response = await fetch(`${getApiBase()}/api/imports/preview-file?${params}`, {
    method: "POST",
    headers: { "Content-Type": "application/octet-stream" },
    body: file,
  });
  return readUploadResponse(response);
}

export async function previewExternalConversationFile(file: File) {
  if (isStandaloneAndroid()) {
    return previewStandaloneExternalImportFile(file);
  }
  if (window.AtherloomNative?.previewImportFileAsync) {
    return requestNativeImportPreview<ExternalImportBatch>(file.name);
  }
  if (!window.AtherloomNative) return previewBrowserFile(file);

  // Compatibility path for an older APK. New builds stream the selected
  // content URI natively and never materialize a base64 copy in the WebView.
  const lowerName = file.name.toLowerCase();
  if (lowerName.endsWith(".json") || lowerName.endsWith(".jsonl")) {
    return requestJson<ExternalImportBatch>("/api/imports/preview", {
      method: "POST",
      body: JSON.stringify({ payload: await file.text(), source_name: file.name }),
    });
  }
  return requestJson<ExternalImportBatch>("/api/imports/preview-encoded", {
    method: "POST",
    body: JSON.stringify({ source_name: file.name, content_base64: await fileBase64(file) }),
  });
}

export function commitExternalImport(batchId: string, body: ExternalImportCommitRequest) {
  return requestJson<ExternalImportBatch>(`/api/imports/batches/${encodeURIComponent(batchId)}/commit`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function listExternalImportBatches() {
  return requestJson<{ batches: ExternalImportBatch[] }>("/api/imports/batches?limit=30");
}

export function getExternalImportBatch(batchId: string) {
  return requestJson<ExternalImportBatch>(`/api/imports/batches/${encodeURIComponent(batchId)}`);
}

export function getImportedConversationMessages(conversationId: string) {
  return requestJson<Message[]>(`/api/conversations/${encodeURIComponent(conversationId)}/messages`);
}

export function rollbackExternalImport(batchId: string) {
  return requestJson<ExternalImportBatch>(`/api/imports/batches/${encodeURIComponent(batchId)}/rollback`, {
    method: "POST",
    body: "{}",
  });
}
