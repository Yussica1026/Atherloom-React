export async function readClipboardText() {
  const nativeValue = window.AtherloomNative?.getClipboard?.();
  if (typeof nativeValue === "string") return nativeValue;
  if (!navigator.clipboard?.readText) throw new Error("当前环境不支持读取剪贴板");
  return navigator.clipboard.readText();
}
