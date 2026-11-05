#include <node_api.h>
#ifdef __APPLE__
#include <sys/socket.h>
#include <unistd.h>
#include <fcntl.h>
#endif

static napi_value create_socket_pair(napi_env env, napi_callback_info info) {
    (void)info;
#ifdef __APPLE__
    int pair[2];
    if (socketpair(AF_UNIX, SOCK_STREAM, 0, pair)) {
        napi_throw_error(env, NULL, "Cannot create Host socketpair");
        return NULL;
    }
    if (fcntl(pair[0], F_SETFD, FD_CLOEXEC) || fcntl(pair[1], F_SETFD, FD_CLOEXEC)) {
        close(pair[0]); close(pair[1]);
        napi_throw_error(env, NULL, "Cannot protect Host descriptors");
        return NULL;
    }
    napi_value result, host, bridge;
    if (napi_create_object(env, &result) != napi_ok ||
        napi_create_int32(env, pair[0], &host) != napi_ok ||
        napi_create_int32(env, pair[1], &bridge) != napi_ok ||
        napi_set_named_property(env, result, "hostFd", host) != napi_ok ||
        napi_set_named_property(env, result, "bridgeFd", bridge) != napi_ok) {
        close(pair[0]); close(pair[1]);
        napi_throw_error(env, NULL, "Cannot return Host descriptors");
        return NULL;
    }
    return result;
#else
    napi_throw_error(env, NULL, "Toolkit Host socketpair requires macOS");
    return NULL;
#endif
}

static napi_value initialize(napi_env env, napi_value exports) {
    napi_value function;
    if (napi_create_function(env, "createSocketPair", NAPI_AUTO_LENGTH, create_socket_pair,
                             NULL, &function) != napi_ok ||
        napi_set_named_property(env, exports, "createSocketPair", function) != napi_ok)
        return NULL;
    return exports;
}
NAPI_MODULE(toolkit_host_socketpair, initialize)
