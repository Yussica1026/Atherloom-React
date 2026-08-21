/// <reference types="vite/client" />

interface AtherloomNativeBridge {
  getBackendUrl(): string;
  setBackendUrl(value: string): string;
  apiRequest(method: string, path: string, body: string): string;
  apiRequestAsync?(method: string, path: string, body: string, callbackId: string): void;
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
