import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { OciErrorKind } from "../oci/result";
import { classifyOciCliFailure, classifyOciExit, parseServiceError } from "./classify-error";

const OUTCOME_DIR = join(import.meta.dirname, "__fixtures__", "outcome");

interface Outcome {
  command: string[];
  "exit-code": number;
  stdout: string;
  stderr: string;
}

function readOutcome(file: string): Outcome {
  return JSON.parse(readFileSync(join(OUTCOME_DIR, file), "utf8")) as Outcome;
}

function classify(file: string): { kind: OciErrorKind; raw: ReturnType<typeof classifyOciExit>["raw"] } {
  const outcome = readOutcome(file);
  return classifyOciExit(outcome["exit-code"], outcome.stdout, outcome.stderr);
}

/** exit 0 のフィクスチャ(失敗ではない)と、分類対象のフィクスチャ。 */
const SUCCESS_FILES = ["16a-bv-backup-policy-assignment-unassigned.json", "warn-list-without-all-paginated.json"];
const ERROR_FILES = [
  "err-cannot-parse-request.json",
  "err-config-file-missing.json",
  "err-key-file-missing.json",
  "err-missing-required-option.json",
  "err-not-authenticated.json",
  "err-not-authorized-or-not-found.json",
  "err-not-authorized-or-not-found-malformed-ocid.json",
  "err-profile-not-found.json",
  "err-unknown-option.json",
  "err-unknown-subcommand.json",
];

describe("classifyOciExit(フィクスチャ)", () => {
  it("outcome/の全ファイルを分類対象か成功ケースとして扱っている", () => {
    expect(new Set([...SUCCESS_FILES, ...ERROR_FILES])).toEqual(new Set(readdirSync(OUTCOME_DIR)));
  });

  it.each(SUCCESS_FILES)("%s はexit 0(stderrが空でなくても失敗ではない)", (file) => {
    expect(readOutcome(file)["exit-code"]).toBe(0);
  });

  it("警告付きlistのstderrは非空だがexit 0", () => {
    expect(readOutcome("warn-list-without-all-paginated.json").stderr).toMatch(/^WARNING:/);
  });

  it.each(ERROR_FILES)("%s はexit codeと分類結果が対応する", (file) => {
    const { kind, raw } = classify(file);
    expect(kind).not.toBe("not_requested");
    expect(raw.message.length).toBeGreaterThan(0);
  });

  it("NotAuthenticated/401は認証系(Warning行が前置されても読める)", () => {
    const outcome = readOutcome("err-not-authenticated.json");
    expect(outcome.stderr).toMatch(/^Warning: /);
    const { kind, raw } = classify("err-not-authenticated.json");
    expect(kind).toBe("not_authenticated");
    expect(raw.statusCode).toBe(401);
    expect(raw.serviceCode).toBe("NotAuthenticated");
    expect(raw.opcRequestId).toMatch(/^EXAMPLEREQUESTID/);
    expect(raw.message).toBe("The required information to complete authentication was not provided or was incorrect.");
    expect(raw.code).toBe(1);
  });

  it("NotAuthorizedOrNotFound/404は権限系(不在も同一コードに合流する)", () => {
    for (const file of [
      "err-not-authorized-or-not-found.json",
      "err-not-authorized-or-not-found-malformed-ocid.json",
    ]) {
      const { kind, raw } = classify(file);
      expect(kind).toBe("forbidden_or_not_found");
      expect(raw.statusCode).toBe(404);
      expect(raw.serviceCode).toBe("NotAuthorizedOrNotFound");
    }
  });

  it("その他のServiceErrorはother(ポーリングは継続)", () => {
    const { kind, raw } = classify("err-cannot-parse-request.json");
    expect(kind).toBe("other");
    expect(raw.statusCode).toBe(400);
    expect(raw.serviceCode).toBe("CannotParseRequest");
    expect(raw.message).toBe("Unknown resource type 'cluster'");
  });

  it("config不在・profile不在は認証系", () => {
    const configMissing = classify("err-config-file-missing.json");
    expect(configMissing.kind).toBe("not_authenticated");
    expect(configMissing.raw.message).toBe("ERROR: Could not find config file at /home/user/.oci/config");

    const profileMissing = classify("err-profile-not-found.json");
    expect(profileMissing.kind).toBe("not_authenticated");
    expect(profileMissing.raw.message).toContain("Profile 'NOSUCHPROFILE' not found in config file");
  });

  it("key_file不在(Traceback)は認証情報の不備としてnot_authenticated", () => {
    const { kind, raw } = classify("err-key-file-missing.json");
    expect(kind).toBe("not_authenticated");
    expect(raw.message).toContain("FileNotFoundError");
    expect(raw.stderr).toContain("Traceback (most recent call last):");
  });

  it("ServiceErrorを含むstderrはTracebackがあっても認証系に倒さない(JSONが読めない場合も)", () => {
    const stderr = [
      "Traceback (most recent call last):",
      '  File "/tmp/oci", line 1, in <module>',
      "FileNotFoundError: [Errno 2] No such file or directory: '/tmp/x'",
      "ServiceError:",
      "{ broken",
    ].join("\n");
    expect(classifyOciExit(1, "", stderr).kind).toBe("other");
  });

  it("CLIに引数を拒否されるケースはcommand_incompatible(互換コマンド非互換の可能性)", () => {
    const missingOption = classify("err-missing-required-option.json");
    expect(missingOption.kind).toBe("command_incompatible");
    expect(missingOption.raw.message).toBe("Error: Missing option(s) --instance-id.");
    expect(missingOption.raw.code).toBe(1);

    // exit 2 では Usage / Error は stdout 側に出る。
    const unknownSubcommand = classify("err-unknown-subcommand.json");
    expect(unknownSubcommand.kind).toBe("command_incompatible");
    expect(unknownSubcommand.raw.code).toBe(2);
    expect(unknownSubcommand.raw.message).toBe("Error: No such command 'bogus-subcommand'.");

    const unknownOption = classify("err-unknown-option.json");
    expect(unknownOption.kind).toBe("command_incompatible");
    expect(unknownOption.raw.code).toBe(2);
    expect(unknownOption.raw.message).toBe("Error: No such option: --bogus-flag");
  });
});

describe("parseServiceError", () => {
  it("ServiceError:のJSONを読む(キーはsnake_case)", () => {
    const parsed = parseServiceError(
      'ServiceError:\n{\n    "code": "NotAuthenticated",\n    "message": "nope",\n    "status": 401,\n    "opc-request-id": "req-1"\n}\n',
    );
    expect(parsed).toEqual({ code: "NotAuthenticated", message: "nope", status: 401, opcRequestId: "req-1" });
  });

  it("ServiceError:が無い・JSONが壊れている場合はundefined", () => {
    expect(parseServiceError("WARNING: pagination\n")).toBeUndefined();
    expect(parseServiceError("ServiceError:\n{ broken")).toBeUndefined();
    expect(parseServiceError("")).toBeUndefined();
  });
});

describe("classifyOciCliFailure", () => {
  it("起動失敗は専用種別(internalに混ぜない)", () => {
    const { kind, raw } = classifyOciCliFailure({
      reason: "launch",
      message: 'Failed to run "oci": spawn oci ENOENT',
      code: "ENOENT",
    });
    expect(kind).toBe("command_launch_failed");
    expect(raw.code).toBe("ENOENT");
    expect(raw.message).toContain("ENOENT");
  });

  it("タイムアウトは認証系ではなくother", () => {
    const { kind, raw } = classifyOciCliFailure({ reason: "timeout", timeoutMs: 60_000 });
    expect(kind).toBe("other");
    expect(raw.message).toContain("60 seconds");
    expect(raw.code).toBe("ETIMEDOUT");
  });

  it("出力サイズ超過はother", () => {
    const { kind, raw } = classifyOciCliFailure({ reason: "output_limit", maxBytes: 1024 });
    expect(kind).toBe("other");
    expect(raw.message).toContain("1024 byte");
  });

  it("exitはexit code + 出力の分類に委譲する", () => {
    const outcome = readOutcome("err-not-authenticated.json");
    expect(
      classifyOciCliFailure({
        reason: "exit",
        exitCode: outcome["exit-code"],
        stdout: outcome.stdout,
        stderr: outcome.stderr,
      }).kind,
    ).toBe("not_authenticated");
  });
});
