import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import { ociCommands } from "./command-defs";
import { MAX_CONCURRENT_PROCESSES, runOciCommand, splitOciCommand } from "./run";

vi.mock("node:child_process", () => ({ execFile: vi.fn() }));

const STDOUT_DIR = join(import.meta.dirname, "__fixtures__", "stdout");

interface ExecError extends Error {
  code?: string | number;
  killed?: boolean;
}

type ExecCallback = (error: ExecError | null, stdout: string, stderr: string) => void;

interface FakeChild {
  stdin: { end: Mock; on: Mock };
  kill: Mock;
  killed: boolean;
}

interface Invocation {
  file: string;
  args: string[];
  options: Record<string, unknown>;
  child: FakeChild;
  done: ExecCallback;
}

const execFileMock = execFile as unknown as Mock;

let invocations: Invocation[] = [];
let inflight = 0;
let peakInflight = 0;
let handler: (invocation: Invocation) => void;

/** execFileのコールバックは常に非同期で呼ばれる(同期呼び出しは実挙動と異なる)。 */
function reply(invocation: Invocation, stdout: string, stderr = ""): void {
  queueMicrotask(() => invocation.done(null, stdout, stderr));
}

function replyError(invocation: Invocation, error: ExecError, stdout = "", stderr = ""): void {
  queueMicrotask(() => invocation.done(error, stdout, stderr));
}

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

beforeEach(() => {
  invocations = [];
  inflight = 0;
  peakInflight = 0;
  handler = (invocation) => reply(invocation, '{"data": {}}');
  execFileMock.mockReset();
  execFileMock.mockImplementation(
    (file: string, args: string[], options: Record<string, unknown>, done: ExecCallback) => {
      const child: FakeChild = { stdin: { end: vi.fn(), on: vi.fn() }, kill: vi.fn(), killed: false };
      inflight++;
      peakInflight = Math.max(peakInflight, inflight);
      const invocation: Invocation = {
        file,
        args,
        options,
        child,
        done: (error, stdout, stderr) => {
          inflight--;
          done(error, stdout, stderr);
        },
      };
      invocations.push(invocation);
      handler(invocation);
      return child;
    },
  );
});

describe("splitOciCommand", () => {
  it("空欄・空白のみはPATHのociになる", () => {
    expect(splitOciCommand("")).toEqual({ file: "oci", args: [] });
    expect(splitOciCommand("   ")).toEqual({ file: "oci", args: [] });
  });

  it("空白区切りで実行ファイルと前置引数に分解する", () => {
    expect(splitOciCommand("  wsl  oci --profile PROD ")).toEqual({
      file: "wsl",
      args: ["oci", "--profile", "PROD"],
    });
  });
});

describe("runOciCommand", () => {
  it("設定空欄ならociを起動し、共通引数--output jsonを付ける", async () => {
    const result = await runOciCommand(ociCommands.subnetGet, { subnetId: "ocid1.subnet.x" }, "");
    expect(result.ok).toBe(true);
    expect(invocations).toHaveLength(1);
    expect(invocations[0]?.file).toBe("oci");
    expect(invocations[0]?.args).toEqual([
      "network",
      "subnet",
      "get",
      "--subnet-id",
      "ocid1.subnet.x",
      "--output",
      "json",
    ]);
  });

  it("設定値の前置引数はサブコマンドより前に置かれる", async () => {
    await runOciCommand(ociCommands.subnetGet, { subnetId: "ocid1.subnet.x" }, "wsl oci --profile PROD");
    expect(invocations[0]?.file).toBe("wsl");
    expect(invocations[0]?.args.slice(0, 5)).toEqual(["oci", "--profile", "PROD", "network", "subnet"]);
  });

  it("タイムアウトと出力上限を指定し、stdinを閉じる", async () => {
    await runOciCommand(ociCommands.subnetGet, { subnetId: "ocid1.subnet.x" }, "");
    expect(invocations[0]?.options.timeout).toBe(60_000);
    expect(invocations[0]?.options.maxBuffer).toBe(64 * 1024 * 1024);
    // 対話プロンプトをEOFで打ち切るため必須。
    expect(invocations[0]?.child.stdin.end).toHaveBeenCalledTimes(1);
  });

  it("exit 0ならstderrが空でなくても成功", async () => {
    handler = (invocation) =>
      reply(
        invocation,
        '{"data": []}',
        "WARNING: This operation supports pagination and not all resources were returned.\n",
      );
    const result = await runOciCommand(ociCommands.instanceList, { compartmentId: "ocid1.compartment.x" }, "");
    expect(result).toEqual({ ok: true, data: [] });
  });

  it("起動失敗(ENOENT)は専用種別", async () => {
    handler = (invocation) =>
      replyError(invocation, Object.assign(new Error("spawn oci-missing ENOENT"), { code: "ENOENT" }));
    const result = await runOciCommand(ociCommands.subnetGet, { subnetId: "x" }, "oci-missing");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.kind).toBe("command_launch_failed");
    expect(result.raw.code).toBe("ENOENT");
    expect(result.raw.message).toContain("oci-missing");
  });

  it("タイムアウトはotherで、子プロセスにSIGKILLを送る", async () => {
    handler = (invocation) =>
      replyError(invocation, Object.assign(new Error("Command failed"), { killed: true }), "", "partial\n");
    const result = await runOciCommand(ociCommands.subnetGet, { subnetId: "x" }, "");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.kind).toBe("other");
    expect(result.raw.message).toContain("60 seconds");
    expect(invocations[0]?.child.kill).toHaveBeenCalledWith("SIGKILL");
  });

  it("出力サイズ超過はotherで拡張は落ちない", async () => {
    handler = (invocation) =>
      replyError(
        invocation,
        Object.assign(new Error("stdout maxBuffer length exceeded"), { code: "ERR_CHILD_PROCESS_STDIO_MAXBUFFER" }),
      );
    const result = await runOciCommand(ociCommands.instanceList, { compartmentId: "x" }, "");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.kind).toBe("other");
    expect(result.raw.message).toContain("67108864 byte");
  });

  it("ServiceErrorのexitはエラー分類に載る", async () => {
    handler = (invocation) =>
      replyError(
        invocation,
        Object.assign(new Error("Command failed"), { code: 1 }),
        "",
        'ServiceError:\n{\n    "code": "NotAuthenticated",\n    "message": "nope",\n    "status": 401\n}\n',
      );
    const result = await runOciCommand(ociCommands.subnetGet, { subnetId: "x" }, "");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.kind).toBe("not_authenticated");
    expect(result.raw.statusCode).toBe(401);
  });

  it("JSONとして読めない出力はotherで、他セクションを巻き込まない", async () => {
    handler = (invocation) => reply(invocation, "oci: not json at all");
    const result = await runOciCommand(ociCommands.subnetGet, { subnetId: "x" }, "");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.kind).toBe("other");
    expect(result.raw.message).toContain("not valid JSON");
  });

  it("手動ページングはopc-next-pageを--pageで辿って全件結合する", async () => {
    const pages = [
      "04-search-structured-search-page1.json",
      "04-search-structured-search-page2.json",
      "04-search-structured-search-page3-last.json",
    ].map((file) => readFileSync(join(STDOUT_DIR, file), "utf8"));
    handler = (invocation) => reply(invocation, pages[invocations.length - 1] ?? "");

    const result = await runOciCommand(ociCommands.taggedResourceSearch, { queryText: "query all resources" }, "");
    expect(result).toMatchObject({ ok: true });
    if (!result.ok) return;
    expect(result.data).toHaveLength(8);
    expect(invocations).toHaveLength(3);
    expect(invocations[0]?.args).not.toContain("--page");
    expect(invocations[1]?.args.slice(-4)).toEqual(["--page", "EXAMPLEPAGETOKEN0001", "--output", "json"]);
    expect(invocations[2]?.args.slice(-4)).toEqual(["--page", "EXAMPLEPAGETOKEN0002", "--output", "json"]);
  });

  it("手動ページングは総時間の上限で打ち切る", async () => {
    handler = (invocation) => reply(invocation, '{"data": [{"id": "a"}], "opc-next-page": "TOKEN"}');
    // 1ページ2分かかる擬似時計(呼び出し回数ではなく実行済みページ数に紐付ける)
    const now = vi.spyOn(Date, "now").mockImplementation(() => invocations.length * 2 * 60 * 1000);
    try {
      const result = await runOciCommand(ociCommands.taggedResourceSearch, { queryText: "query all resources" }, "");
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.kind).toBe("other");
      expect(result.raw.message).toBe("oci paging exceeded 5 minutes");
      expect(invocations).toHaveLength(3);
    } finally {
      now.mockRestore();
    }
  });

  it("--all付きlistはopc-next-pageが出ても追わない", async () => {
    handler = (invocation) => reply(invocation, '{"data": [{"id": "a"}], "opc-next-page": "TOKEN"}');
    const result = await runOciCommand(ociCommands.instanceList, { compartmentId: "x" }, "");
    expect(result).toMatchObject({ ok: true });
    expect(invocations).toHaveLength(1);
  });

  it(`同時に起動するプロセス数は${MAX_CONCURRENT_PROCESSES}を超えない`, async () => {
    const pending: Invocation[] = [];
    handler = (invocation) => pending.push(invocation);

    const results = Array.from({ length: 20 }, (_, index) =>
      runOciCommand(ociCommands.subnetGet, { subnetId: `ocid1.subnet.${index}` }, ""),
    );
    await flush();
    expect(invocations).toHaveLength(MAX_CONCURRENT_PROCESSES);

    while (pending.length > 0) {
      const invocation = pending.shift();
      invocation?.done(null, '{"data": {}}', "");
      await flush();
      expect(inflight).toBeLessThanOrEqual(MAX_CONCURRENT_PROCESSES);
    }

    expect(await Promise.all(results)).toHaveLength(20);
    expect(invocations).toHaveLength(20);
    expect(peakInflight).toBe(MAX_CONCURRENT_PROCESSES);
  });
});
