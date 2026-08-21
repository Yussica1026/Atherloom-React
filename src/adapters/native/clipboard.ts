export async function readClipboardText() {
  const nativeValue = window.AtherloomNative?.getClipboard?.();
  if (typeof nativeValue === "string") return nativeValue;
  if (!navigator.clipboard?.readText) throw new Error("当前环境不支持读取剪贴板");
  return navigator.clipboard.readText();
}

export async function writeClipboardText(value: string) {
  if (window.AtherloomNative?.setClipboard) {
    const raw = window.AtherloomNative.setClipboard(value);
    try {
      const result = JSON.parse(raw) as { ok?: boolean; error?: string };
      if (!result.ok) throw new Error(result.error || "复制失败");
      return;
    } catch (error) {
      if (error instanceof SyntaxError) return;
      throw error;
    }
  }
  if (!navigator.clipboard?.writeText) throw new Error("当前环境不支持写入剪贴板");
  await navigator.clipboard.writeText(value);
}
