/// <reference types="vite/client" />

interface AtherloomNativeBridge {
  getBackendUrl(): string;
  setBackendUrl(value: string): string;
  apiRequest(method: string, path: string, body: string): string;
  apiRequestAsync?(method: string, path: string, body: string, callbackId: string): void;
  getClipboard?(): string;
  setClipboard?(value: string): string;
  saveProvider?(raw: string): string;
  listProviders?(): string;
  deleteProvider?(id: string): string;
  providerOperationAsync?(operation: string, raw: string, callbackId: string): void;
  providerChatStream?(raw: string, callbackId: string): void;
  saveFile?(fileName: string, mimeType: string, base64: string, callbackId: string): void;
  chatStream(path: string, body: string, callbackId: string): void;
  cancelStream(callbackId: string): void;
}

interface Window {
  AtherloomNative?: AtherloomNativeBridge;
  AtherloomNativeRequest?: (callbackId: string, result: string) => void;
  AtherloomNativeFile?: (callbackId: string, result: string) => void;
  AtherloomNativeStream?: (callbackId: string, event: string) => void;
}
