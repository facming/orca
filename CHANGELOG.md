## 2026-11-06 — Toolkit Host 7B-10 (RELEASE BLOCKED)

- Make released terminal cleanup retryable after restart and lost responses; preserve task intent after post-create disk failures and deduplicate concurrent requests.
- Revalidate signed metadata on resume, reject forged completion/receipts, and retain maintenance barriers while local keys remain.
- Reuse remote browsing and preferences in the Host window; add recovery retry, directory choice, progress and Finder reveal.
- Deny legacy macOS plugin/localhost download mutations; retain Windows and GPU paths.
- Document local-use-first acceptance, actual ad-hoc tests, installed-app read-only audit and remaining packaging/enrollment blockers. See [7B-10](docs/toolkit-host-7b10.md).

# Fork changes

## 2026-11-06 — Host download integration 7B-9 (RELEASE BLOCKED)

- Wire the production maintenance window to a sealed main-owned download engine, private lifecycle and guarded download controls; ordinary plugins receive no task ownership or lease-release capability.
- Persist creation intent before Host tasks, deduplicate create retries, CAS-claim interrupted tasks, and adopt only existing verified-target legacy leases. Keep unknown/orphan inventory blocked.
- Reuse registration/revocation identities and re-verify saved signed receipts before Host release and local key deletion.
- Run the actual hidden Electron window/preload with synthetic identity/dialog responses; fix its first-load readiness race. Add a strict read-only formal package gate; no Developer ID positive acceptance is claimed.
- See [implementation, evidence and remaining risks](docs/toolkit-host-7b9.md). Formal signing, complete legacy recovery and macOS cross-UID acceptance remain blocked.

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
