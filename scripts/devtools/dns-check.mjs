/**
 * dns-check.mjs —— registry 域名的 DNS 解析只读探针（ISSUE #5189）。
 *
 * IPv6 优先会让 `pnpm install` 卡死；此前要手敲
 * `node -e "require('dns').lookup('registry.npmmirror.com', {all:true}, …)"` 看 family:6。
 * 这里用同一份 Node 判据把常用 registry 域名逐个查一遍，只打印读数、不改任何状态。
 *
 * 用法：`pnpm dns:check [--json]`
 */
import dns from "node:dns";
import { pathToFileURL } from "node:url";

/** 需要探的域名（与文档的排障出口同族）。 */
export const REGISTRY_HOSTS = Object.freeze(["registry.npmmirror.com", "registry.npmjs.org"]);

/**
 * 把一个 lookup 结果折成一行读数。纯函数，便于用例喂形状。
 *
 * @param {{host:string, addresses:{address:string, family:number}[]}} input
 */
export function dnsRow({ host, addresses }) {
  return {
    host,
    families: [...new Set((addresses ?? []).map((a) => a.family))].sort(),
    addresses: (addresses ?? []).map((a) => a.address),
  };
}

/** @param {{json?:boolean}} ctx */
export async function dnsCheck({ json = false } = {}) {
  const rows = await Promise.all(
    REGISTRY_HOSTS.map(async (host) =>
      dnsRow({ host, addresses: await dns.promises.lookup(host, { all: true }) }),
    ),
  );
  if (json) {
    process.stdout.write(`${JSON.stringify(rows, null, 2)}\n`);
  } else {
    for (const r of rows) {
      process.stdout.write(
        `[dns:check] ${r.host} · family ${r.families.join("/")} · ${r.addresses.join(", ")}\n`,
      );
    }
  }
  return 0;
}

/** @param {string[]} argv */
async function main(argv) {
  const bad = argv.filter((a) => a !== "--json");
  if (bad.length > 0) {
    process.stderr.write("用法：pnpm dns:check [--json]\n");
    return 2;
  }
  return dnsCheck({ json: argv.includes("--json") });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main(process.argv.slice(2));
}
