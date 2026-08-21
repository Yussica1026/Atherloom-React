interface NativeFileResult {
  ok?: boolean;
  message?: string;
  error?: string;
}

const pending = new Map<string, { resolve: (message: string) => void; reject: (error: Error) => void }>();

window.AtherloomNativeFile = (callbackId, raw) => {
  const request = pending.get(callbackId);
  if (!request) return;
  pending.delete(callbackId);
  try {
    const result = JSON.parse(raw) as NativeFileResult;
    if (!result.ok) throw new Error(result.error || "文件保存失败");
    request.resolve(result.message || "文件已保存");
  } catch (error) {
    request.reject(error instanceof Error ? error : new Error("Android 文件桥返回了无法识别的数据"));
  }
};

function asBase64(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error || new Error("无法读取待保存文件"));
    reader.onload = () => resolve(String(reader.result || "").split(",", 2)[1] || "");
    reader.readAsDataURL(blob);
  });
}

export async function saveFile(fileName: string, blob: Blob) {
  const bridge = window.AtherloomNative;
  if (bridge?.saveFile) {
    const callbackId = `file-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const base64 = await asBase64(blob);
    return new Promise<string>((resolve, reject) => {
      pending.set(callbackId, { resolve, reject });
      try {
        bridge.saveFile?.(fileName, blob.type || "application/octet-stream", base64, callbackId);
      } catch (error) {
        pending.delete(callbackId);
        reject(error instanceof Error ? error : new Error("无法打开 Android 文件保存器"));
      }
    });
  }

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
  return `已交给浏览器下载：${fileName}`;
}
