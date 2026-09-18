/**
 * 强制 Node 的 dns.lookup 走 IPv4(调用方未显式指定 family 时注入 family: 4)。
 *
 * 背景:本机(Windows)getaddrinfo 对部分域名只返回失效的 IPv6,导致
 * node/pnpm 等一切走网络的 Node 程序连接超时(UND_ERR_CONNECT_TIMEOUT),
 * 而 curl 和显式 IPv4 的 TLS 均正常。用法:
 *
 *   用法：NODE_OPTIONS 里 --require 本脚本后再跑 pnpm install
 *
 * 仅影响本次进程,不修改系统配置。调用方显式传了 family(如 family: 6)时不干预。
 */
const dns = require("node:dns");

/**
 * @param {typeof dns.lookup} lookup
 * @returns {typeof dns.lookup}
 */
function patchLookup(lookup) {
  /** @type {any} */
  const patched = function (
    /** @type {string} */ hostname,
    /** @type {any} */ options,
    /** @type {any} */ callback,
  ) {
    if (typeof options === "function") {
      callback = options;
      options = {};
    } else if (options == null) {
      options = {};
    } else if (typeof options !== "object") {
      options = { family: options };
    }
    if (!options.family) {
      options = { ...options, family: 4 };
    }
    return lookup(hostname, options, callback);
  };
  return patched;
}

dns.lookup = patchLookup(dns.lookup);
dns.promises.lookup = /** @type {any} */ (patchLookup(/** @type {any} */ (dns.promises.lookup)));
