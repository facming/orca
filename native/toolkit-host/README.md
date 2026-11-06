# Toolkit Host channel and authority

The N-API binding creates an AF_UNIX/SOCK_STREAM pair inside the calling main
process. It is a transport primitive, not authentication. The dedicated
`src/main/toolkit` loader admits sealed resources before loading the binding and
Toolkit adapter. The service independently authenticates both native peers.

`createSocketPair()` transfers `{ hostFd, bridgeFd }` to main. `net.Socket` owns
hostFd; the adapter passes bridgeFd as child stdio[3], closes the parent copy, and
holds the Host endpoint through completion. Both FDs start close-on-exec. All
error, timeout and revoke paths close descriptors. Do not expose the factory,
FDs or Bridge path to plugins; do not enroll generic Node/Electron interpreters.

For a disposable macOS build, use repository-pinned Node 24.22.1 and headers:

```sh
node native/toolkit-host/stage.mjs ../orca-tools /tmp/orca-stage/toolkit-host /path/to/pinned/bin/node /path/to/pinned/include/node
ORCA_BACKGROUND_LAUNCH=1 node native/toolkit-host/smoke-worker.mjs /tmp/orca-stage
```

The output directory must not exist. Staging verifies the Node executable hash,
compiles the addon, copies the closed Toolkit dependency set, and generates the
Host panel/preload and manifest. It installs nothing. `ORCA_TOOLKIT_HOST_STAGE`
is an optional electron-builder input, never a runtime admission override.
Nested signing changes bytes: regenerate the manifest after nested signing and
before the outer application seal; the custom signer now performs this sequence.
Formal end-to-end signed packaging acceptance remains open.

The smoke runs an actual ordinary worker using the separate Node executable and
checks IPC, commands, absent RUN_AS_NODE env and private API discovery denial.
The production loader refuses user-writable staging directories and permissive
main-runtime fuses. Non-macOS native calls fail closed.

See [implementation, tests and remaining risks](../../docs/toolkit-host-7b7.md).
Formal signing, complete runtime separation and real cross-UID acceptance remain
**RELEASE BLOCKED**. No production enrollment is enabled by staging.

## 7B-8 signing order

`seal.mjs STAGE_ROOT "Developer ID Application: …"` signs nested worker/addon, then regenerates and verifies the closed manifest. For disposable tests only, pass `- --test-only`. The custom macOS app signer now runs this before outer signing and excludes this already-signed subtree from re-signing, then verifies the manifest again. No enrollment is performed. Main runtime fuses, remaining entry points and entitlements are still release blockers. See [7B-8 evidence and limitations](../../docs/toolkit-host-7b8.md).
