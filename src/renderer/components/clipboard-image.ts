export type CopyImageStage =
  | "svg-load"
  | "canvas-context"
  | "png-encode"
  | "png-convert"
  | "clipboard-item-write"
  | "clipboard-blob-write"
  | "clipboard-exec-command";

export class CopyImageError extends Error {
  constructor(
    readonly stage: CopyImageStage,
    readonly reason: unknown,
  ) {
    super(`${stage}: ${describeReason(reason)}`);
    this.name = "CopyImageError";
  }
}

function describeReason(reason: unknown): string {
  if (reason instanceof Error) return `${reason.name}: ${reason.message}`;
  return String(reason);
}

export function describeCopyImageError(error: unknown): string {
  return error instanceof CopyImageError ? error.message : describeReason(error);
}

function asCopyImageError(error: unknown): CopyImageError {
  return error instanceof CopyImageError ? error : new CopyImageError("png-convert", error);
}

function logStage(stage: CopyImageStage, error: unknown): void {
  console.error(`[freelens-oci-cluster] copy image stage failed: ${stage}`, error);
}

const BASE64_CHUNK = 0x8000;

async function toDataUrl(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  // 全バイトを一度に spread すると引数の個数上限で RangeError になる。
  for (let offset = 0; offset < bytes.length; offset += BASE64_CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + BASE64_CHUNK));
  }
  return `data:${blob.type || "image/png"};base64,${btoa(binary)}`;
}

async function copyViaExecCommand(blob: Blob): Promise<void> {
  const dataUrl = await toDataUrl(blob);
  const holder = document.createElement("div");
  holder.contentEditable = "true";
  holder.setAttribute("style", "position:fixed;left:-10000px;top:0;opacity:0");
  const image = document.createElement("img");
  image.src = dataUrl;
  holder.append(image);
  document.body.append(holder);
  try {
    // 読み込みが終わる前に選択してもクリップボードに画像は載らない。
    await image.decode();
    const selection = window.getSelection();
    if (!selection) throw new Error("selection unavailable");
    const range = document.createRange();
    range.selectNodeContents(holder);
    selection.removeAllRanges();
    selection.addRange(range);
    if (!document.execCommand("copy")) throw new Error("execCommand copy returned false");
    selection.removeAllRanges();
  } finally {
    holder.remove();
  }
}

export async function writeImageToClipboard(png: Promise<Blob>): Promise<void> {
  const conversion: { error: unknown; failed: boolean } = { error: undefined, failed: false };
  const tracked = png.catch((error: unknown) => {
    conversion.error = error;
    conversion.failed = true;
    throw error;
  });
  // ClipboardItem へ渡らない経路でも unhandled rejection にしない。
  void tracked.catch(() => {});

  if (typeof ClipboardItem === "function") {
    // Blobを待ってからwrite()を呼ぶとユーザー操作の有効期間が切れて拒否されうる。
    // まずPromiseのままClipboardItemへ渡すこと。
    try {
      await navigator.clipboard.write([new ClipboardItem({ "image/png": tracked })]);
      return;
    } catch (error) {
      // 変換自体が失敗しているなら後続の段も同じ理由で落ちる。段名を保ったまま返す。
      if (conversion.failed) throw asCopyImageError(conversion.error);
      logStage("clipboard-item-write", error);
    }
  }

  let blob: Blob;
  try {
    blob = await tracked;
  } catch (error) {
    throw asCopyImageError(error);
  }

  if (typeof ClipboardItem === "function") {
    try {
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      return;
    } catch (error) {
      logStage("clipboard-blob-write", error);
    }
  }

  try {
    await copyViaExecCommand(blob);
  } catch (error) {
    throw new CopyImageError("clipboard-exec-command", error);
  }
}
