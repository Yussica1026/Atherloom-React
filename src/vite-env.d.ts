/// <reference types="vite/client" />

interface AtherloomNativeBridge {
  getBackendUrl(): string;
  setBackendUrl(value: string): string;
  apiRequest(method: string, path: string, body: string): string;
  chatStream(path: string, body: string, callbackId: string): void;
  cancelStream(callbackId: string): void;
}

interface Window {
  AtherloomNative?: AtherloomNativeBridge;
  AtherloomNativeStream?: (callbackId: string, event: string) => void;
}
