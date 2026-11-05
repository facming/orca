# Toolkit Host channel preparation

This opt-in N-API binding creates an AF_UNIX/SOCK_STREAM pair **inside the calling
process**. It is not an authentication mechanism or an enabled Host API. Do not
load it in a plugin worker or enroll a generic Node/Electron interpreter.

For a disposable macOS development build (no app installation):

```sh
cc -Wall -Wextra -Werror -bundle -undefined dynamic_lookup \
  -I/opt/homebrew/include/node native/toolkit-host/socketpair.c \
  -o /tmp/toolkit-host-socketpair.node
```

Use headers matching the target Node/Electron N-API runtime in release builds.
The binding was tested with Node 20 and the repository-pinned Node 24.22.1 on
arm64, not a packaged Electron application. The non-macOS implementation refuses calls.

`createSocketPair()` transfers ownership of `{ hostFd, bridgeFd }` to main. Wrap
`hostFd` in `net.Socket`; pass `bridgeFd` as child `stdio[3]`, then close the
parent's bridge descriptor immediately after spawning. Both descriptors start
close-on-exec. Keep the Host endpoint and process alive until the complete reply
or bounded failure. Close both descriptors on every constructor/spawn error.
Never expose descriptors, the factory, or the Bridge executable path to plugins.

The companion adapter is `plugins/toolkit/config-service/host-handler.cjs` in
[orca-tools](https://github.com/facming/orca-tools/pull/15). It defaults to failure
without this factory. The production Bridge accepts only the explicit fd 3 and
forwards it unchanged with SCM_RIGHTS. See
[the design](../../docs/toolkit-host-api-design.md) for the required sealed-session
router, signing/runtime separation, enrollment, and release gates. No public
method registry, worker environment, fuse, entitlement, or installed app is
changed by this preparation.
