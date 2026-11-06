import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CopyImageError, describeCopyImageError, writeImageToClipboard } from "./clipboard-image";

class FakeClipboardItem {
  constructor(readonly items: Record<string, Promise<Blob> | Blob>) {}
}

function png(): Blob {
  return new Blob([new Uint8Array([137, 80, 78, 71])], { type: "image/png" });
}

/** Chromium同様、ClipboardItemに渡されたPromiseの失敗をwrite()のrejectとして返す。 */
function installClipboard() {
  const write = vi.fn(async (items: FakeClipboardItem[]) => {
    await Promise.all(items.map((item) => item.items["image/png"]));
  });
  vi.stubGlobal("ClipboardItem", FakeClipboardItem);
  vi.stubGlobal("navigator", { clipboard: { write } });
  return write;
}

function installDom(execCommandResult: boolean) {
  const removed: string[] = [];
  const appended: string[] = [];
  const execCommand = vi.fn(() => execCommandResult);
  vi.stubGlobal("document", {
    body: {
      append(child: { tagName: string }) {
        appended.push(child.tagName);
      },
    },
    createElement: (tagName: string) => ({
      tagName,
      src: "",
      contentEditable: "",
      setAttribute: () => {},
      append: () => {},
      decode: () => Promise.resolve(),
      remove: () => {
        removed.push(tagName);
      },
    }),
    createRange: () => ({ selectNodeContents: () => {} }),
    execCommand,
  });
  vi.stubGlobal("window", {
    getSelection: () => ({ removeAllRanges: () => {}, addRange: () => {} }),
  });
  return { execCommand, removed, appended };
}

function rejected(name: string, message: string): Error {
  return Object.assign(new Error(message), { name });
}

describe("writeImageToClipboard", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("PromiseのままClipboardItemへ渡して1回で書き終える", async () => {
    const write = installClipboard();

    await expect(writeImageToClipboard(Promise.resolve(png()))).resolves.toBeUndefined();

    expect(write).toHaveBeenCalledTimes(1);
    expect(write.mock.calls[0][0][0].items["image/png"]).toBeInstanceOf(Promise);
  });

  it("Promise渡しがNotAllowedErrorなら、await済みBlobで書き直す", async () => {
    const write = installClipboard();
    write.mockRejectedValueOnce(rejected("NotAllowedError", "write blocked"));

    await expect(writeImageToClipboard(Promise.resolve(png()))).resolves.toBeUndefined();

    expect(write).toHaveBeenCalledTimes(2);
    expect(write.mock.calls[1][0][0].items["image/png"]).toBeInstanceOf(Blob);
  });

  it("write()が両方拒否ならexecCommandへ落ちる", async () => {
    const write = installClipboard();
    write.mockRejectedValue(rejected("NotAllowedError", "write blocked"));
    const dom = installDom(true);

    await expect(writeImageToClipboard(Promise.resolve(png()))).resolves.toBeUndefined();

    expect(write).toHaveBeenCalledTimes(2);
    expect(dom.execCommand).toHaveBeenCalledWith("copy");
    expect(dom.removed).toEqual(["div"]);
  });

  it("ClipboardItemが無い環境ではwrite()を呼ばずexecCommandを使う", async () => {
    vi.stubGlobal("ClipboardItem", undefined);
    const write = vi.fn();
    vi.stubGlobal("navigator", { clipboard: { write } });
    const dom = installDom(true);

    await expect(writeImageToClipboard(Promise.resolve(png()))).resolves.toBeUndefined();

    expect(write).not.toHaveBeenCalled();
    expect(dom.appended).toEqual(["div"]);
    expect(dom.execCommand).toHaveBeenCalledWith("copy");
  });

  it("全段拒否ならclipboard-exec-commandで失敗し、挿入した要素は消す", async () => {
    const write = installClipboard();
    write.mockRejectedValue(rejected("NotAllowedError", "write blocked"));
    const dom = installDom(false);

    const error = await writeImageToClipboard(Promise.resolve(png())).catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(CopyImageError);
    expect((error as CopyImageError).stage).toBe("clipboard-exec-command");
    expect(dom.removed).toEqual(["div"]);
  });

  it("PNG変換の失敗は後続段を試さず、その段名のまま返す", async () => {
    const write = installClipboard();
    const dom = installDom(true);
    const source = new CopyImageError("svg-load", new Error("image onerror"));

    const error = await writeImageToClipboard(Promise.reject(source)).catch((reason: unknown) => reason);

    expect(error).toBe(source);
    expect(write).toHaveBeenCalledTimes(1);
    expect(dom.execCommand).not.toHaveBeenCalled();
  });

  it("段名の無い変換失敗はpng-convertとして扱う", async () => {
    installClipboard();
    installDom(true);

    const error = await writeImageToClipboard(Promise.reject(new Error("boom"))).catch((reason: unknown) => reason);

    expect((error as CopyImageError).stage).toBe("png-convert");
  });
});

describe("describeCopyImageError", () => {
  it("段名と元エラーのname/messageを1行にする", () => {
    const error = new CopyImageError("clipboard-item-write", rejected("NotAllowedError", "write blocked"));

    expect(describeCopyImageError(error)).toBe("clipboard-item-write: NotAllowedError: write blocked");
  });

  it("CopyImageError以外はそのまま説明する", () => {
    expect(describeCopyImageError(rejected("TypeError", "x is not a function"))).toBe("TypeError: x is not a function");
    expect(describeCopyImageError("plain")).toBe("plain");
  });
});
