#!/usr/bin/env node
// @ts-nocheck -- 服务端出网收口判据（供 .githooks/pre-commit 调用）
/**
 * 服务端出网收口（#4724，#3904 的子项）—— 硬闸，无基线、无豁免清单。
 *
 * 背景：#4052 确立了「服务端出网一律过 `~/lib/network/outbound-url-core` 的
 * `safeFetch` / `assertSafeOutboundUrl`」的不变量（scheme 白名单、内网/元数据
 * 拦截、逐跳重定向校验）。此后仍有配置派生 URL 走裸 fetch（#4724 点名的六处），
 * 属「复用即踩雷」的潜伏点。本判据把「服务端代码出现绕过 safeFetch 的裸
 * `fetch(`」机器化，防后续新增出网点漏网。
 *
 * 扫描面（=「服务端身份」的判定）：
 *   - `src/server/**`、`src/app/api/**`（不含 `*.test.ts`）——天然服务端；
 *   - `src/lib/**` 中声明服务端身份的模块：顶层 `import "server-only";` 或
 *     `.server.ts` 后缀（与 §18.4 的三分类一致）。
 *   - `safeFetch` 的实现本体（outbound-url-core.ts）不带 server-only 声明，
 *     天然不在扫描面内 —— 判据不豁免任何文件。
 *
 * 用法：
 *   node scripts/gates/check-server-bare-fetch.cjs   # 全量扫描（每次提交都跑）
 */
const fs = require("node:fs");
const path = require("node:path");
const { gateFail, gatePass } = require("../ci/ci-log.mjs");

const ROOT = path.resolve(__dirname, "../..");
/* 裸 fetch：`fetch(` 前不是标识符字符（safeFetch / myFetch 都不算裸）。 */
const BARE_FETCH_RE = /(?<![A-Za-z0-9_])fetch\s*\(/;
const SERVER_ONLY_RE = /^import\s+"server-only";?/m;

function walk(dir, out = []) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    /* 扫描面目录不存在（门禁自测的临时仓库 / 冷检出）：没有可扫的东西。 */
    return out;
  }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      walk(p, out);
    } else if (/\.(?:ts|tsx|mjs|cjs)$/.test(e.name)) {
      out.push(p);
    }
  }
  return out;
}

function isServerMarkedLib(file) {
  if (file.endsWith(".server.ts")) {
    return true;
  }
  return SERVER_ONLY_RE.test(fs.readFileSync(file, "utf8"));
}

const scope = [
  ...walk(path.join(ROOT, "src", "server")),
  ...walk(path.join(ROOT, "src", "app", "api")),
  ...walk(path.join(ROOT, "src", "lib")).filter(isServerMarkedLib),
].filter((f) => !f.endsWith(".test.ts") && !f.endsWith(".test.tsx"));

const violations = [];
for (const file of scope) {
  const rel = path.relative(ROOT, file);
  const lines = fs.readFileSync(file, "utf8").split("\n");
  lines.forEach((line, i) => {
    if (!BARE_FETCH_RE.test(line)) {
      return;
    }
    const trimmed = line.trim();
    /* 注释里的 `fetch(` 不是调用（判据说明、示例都可能写到它）。 */
    if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) {
      return;
    }
    violations.push(`${rel}:${i + 1}  ${trimmed.slice(0, 100)}`);
  });
}

if (violations.length) {
  gateFail("服务端出网收口", violations, {
    detail: `绕过 safeFetch 的裸 fetch ${violations.length} 处`,
    hint:
      "判据是硬闸（无基线、无豁免）：服务端出网一律走\n" +
      "`safeFetch(url, { scenario, ... })`（~/lib/network/outbound-url.server；\n" +
      "纯 Node 宿主用 ~/lib/network/outbound-url-core）——scheme 白名单、内网与\n" +
      "元数据拦截、逐跳重定向校验都收在那一份里（#4052 / #4724）。",
  });
  process.exit(1);
}
gatePass("服务端出网收口", `扫描 ${scope.length} 份服务端模块，0 处裸 fetch`);
