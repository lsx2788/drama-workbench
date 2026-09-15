export function isStoryText(mime: string) {
  return mime === "text/plain" || mime === "text/markdown";
}

/** Display-only decoding, explicitly chosen by the reader; never rewrites stored bytes. */
export function decodeStoryText(
  bytes: ArrayBuffer,
  encoding: string,
): { text: string; error?: never } | { error: string; text?: never } {
  try {
    return {
      text: new TextDecoder(encoding, { fatal: true, ignoreBOM: true }).decode(
        bytes,
      ),
    };
  } catch {
    return { error: "无法用当前编码显示，请切换显示编码或下载原文件。" };
  }
}
