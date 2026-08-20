# OCI command integration

> Read this when configuring or implementing an `oci` wrapper or compatible command.

[日本語](oci-command.md)

## Configuration example

When FreeLens runs on Windows and `oci` runs under WSL, set "OCI: oci command" in Preferences to the following value.

```text
wsl oci
```

If a wrapper injects credentials from a secret manager instead of keeping an OCI config file under WSL, specify that command (for example, `wsl haj oci`).
The extension splits the setting on whitespace and passes the first item as the executable and the rest as leading arguments to `execFile`.
Quotes are not interpreted, so a single argument containing whitespace cannot be expressed.

## Compatible command contract

A compatible command forwards the given arguments to `oci` and passes stdout, stderr, and the exit status through.
The [command definitions](../src/renderer/cli/command-defs.ts) are the single source of truth for every subcommand the extension runs, all of which are read-only.

### Output and exit status

- The extension adds `--output json` to every call. Stdout must use the same `{"data": …}` format as `oci`.
- It adds `--all` to list operations.
- It pages `search resource structured-search`, which has no `--all`, with `--page` and follows the top-level `opc-next-page`.
- Manual paging stops after 100 pages and fails only the affected section.
- Exit status 0 is success, even when the command writes to stderr.
- A non-zero status is a failure. The extension classifies authentication, permission or not-found, and other errors from the `ServiceError:` JSON on stderr.

### Execution limits

- Each call times out after 60 seconds.
- At most eight processes run concurrently.
- Stdout is limited to 64MiB per call. Exceeding the limit fails only the affected section.

The contract assumes stdout and stderr contain no secrets.
Error displays include the exit status and stderr verbatim.
