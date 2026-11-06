# Fork changes

## 2026-11-06 — Host configuration / task ownership 7B-8 (RELEASE BLOCKED)

- Add main-owned task handles, serialized lifecycle requests and durable isolated-service task records with owner/epoch/revision checks and target leases.
- Connect the existing download engine through private lifecycle injection; preserve leases on pause, unknown results and unverified cleanup. Production Controller/download UI migration remains pending.
- Enable maintenance actions only when Host inventory allows them; add field-level settings editing, bound migration/restore confirmation and stable mutation retries.
- Sign nested Toolkit binaries before manifest generation; protect them from outer re-signing and verify the final seal. Formal signing/enrollment remains disabled.
- Keep synthetic UI/identity, temporary signing and unperformed production acceptance separate. See [implementation and remaining risks](docs/toolkit-host-7b8.md).

## 2026-11-06 — Toolkit Trusted Host Authority 7B-7

- Add a dedicated main-process authority with sealed resource admission, private instance/context generations, operation validation, concurrent call limits and revocation.
- Connect the Toolkit handler to the in-process native socketpair and FD 3 transport; introduce a Host-owned maintenance window and narrow sender/frame-bound IPC.
- Deny private configuration calls before generic plugin authorization; verify real malicious worker calls remain denied after reload.
- Stage a pinned independent worker Node and use an explicit execPath without changing global Electron fuses. Preserve existing runtime behavior when no staged bundle exists.
- Keep production enrollment **RELEASE BLOCKED**: signed-package/cross-UID validation, remaining generic runtime paths, task-bound migration/restore/lease handling and full UI migration are unfinished.

See [implementation, tests and remaining risks](docs/toolkit-host-7b7.md).
