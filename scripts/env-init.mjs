#!/usr/bin/env node
// 本地 `.env` 生成入口（跨平台，`pnpm env:init`）。
//
// 为什么需要它：`src/env.js` 在启动时强制校验 `BETTER_AUTH_SECRET` 与两个
// `BETTER_AUTH_GITHUB_*`，而 `.env.example` 里这三项都是**空串**，且
// createEnv 配了 `emptyStringAsUndefined: true` —— 空串等价于「没给」。
// 于是照着文档 `cp .env.example .env` 走的人在 Linux / macOS 上得到的仍是
// 「Invalid environment variables」，看不出是「值留空」而不是「缺文件」。
//
// Windows 侧一直有 `scripts/prepare-local-run.ps1` 的第 4 步自动补齐（随机
// 密钥 + OAuth 占位值），**Linux / macOS 侧没有任何等价物**（本模式要求零
// `.ps1` 依赖，见规范 §9）。本脚本就是那份能力，逻辑与 .ps1 同款：
//   · BETTER_AUTH_SECRET → 64 位随机 hex（满足 schema 的 min(32)）
//   · BETTER_AUTH_GITHUB_CLIENT_ID / _SECRET → 本地占位值
// 其余行（DATABASE_URL、COMFYAPP_PORT 注释等）原样保留。
//
// 幂等：已存在 `.env` 时不覆盖（只报告），绝不吞掉使用者的配置。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// 密钥与占位值的**单一定义点**在 launcher-core 那份（桌包 standalone 运行期也用它）：
// 两侧各写一份的后果不是重复代码，而是「dev 检出的鉴权配置形状」与「桌包里的」悄悄
// 不同——而两边都能正常启动，没有任何判据会红（§12.12）。
import {
  newAuthSecret,
  OAUTH_PLACEHOLDER,
} from "./launcher-core/standalone-runtime-env.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const envPath = path.join(root, ".env");
const examplePath = path.join(root, ".env.example");

/** 按 KEY= 逐行覆盖（锚行首，兼容 example 未来新增注释/行）——与
 *  `scripts/prepare-local-run.ps1` 的 `(?m)^KEY=.*$` 口径一致。 */
function fill(content) {
  const secret = newAuthSecret();
  return content
    .replace(/^BETTER_AUTH_SECRET=.*$/m, `BETTER_AUTH_SECRET="${secret}"`)
    .replace(
      /^BETTER_AUTH_GITHUB_CLIENT_ID=.*$/m,
      `BETTER_AUTH_GITHUB_CLIENT_ID="${OAUTH_PLACEHOLDER}"`,
    )
    .replace(
      /^BETTER_AUTH_GITHUB_CLIENT_SECRET=.*$/m,
      `BETTER_AUTH_GITHUB_CLIENT_SECRET="${OAUTH_PLACEHOLDER}"`,
    );
}

/** 三项必填值是否都拿到了非空内容（判据同 `src/env.js`：空串 == 未给）。 */
export function hasRequiredValues(content) {
  return ["BETTER_AUTH_SECRET", "BETTER_AUTH_GITHUB_CLIENT_ID", "BETTER_AUTH_GITHUB_CLIENT_SECRET"].every(
    (key) =>
      new RegExp(`^${key}="?([^"\\r\\n]+)"?\\s*$`, "m").test(content),
  );
}

if (!fs.existsSync(examplePath)) {
  process.stderr.write(`[env:init] ✗ 找不到 ${examplePath}，无法生成 .env。\n`);
  process.exit(1);
}

if (fs.existsSync(envPath)) {
  const current = fs.readFileSync(envPath, "utf8");
  if (hasRequiredValues(current)) {
    process.stdout.write("[env:init] ✓ 已存在 .env 且必填项非空，跳过（不覆盖你的配置）。\n");
    process.exit(0);
  }
  // 存在但值留空：典型的 `cp .env.example .env` 留下的半成品。补齐即可，
  // 不整份重写——使用者可能已经改过端口等其它项。
  fs.writeFileSync(envPath, fill(current), "utf8");
  process.stdout.write(
    "[env:init] ✓ 已有 .env 但必填项为空，已就地补齐（其余配置保持不变）。\n",
  );
  process.exit(0);
}

const next = fill(fs.readFileSync(examplePath, "utf8"));
if (!hasRequiredValues(next)) {
  // 自检：改写没命中行时立刻暴露，而不是留个仍然起不来的 .env。
  process.stderr.write(
    "[env:init] ✗ 生成的 .env 仍缺必填项——.env.example 里的键名可能已改动，请检查脚本的替换口径。\n",
  );
  process.exit(1);
}
fs.writeFileSync(envPath, next, "utf8");
process.stdout.write(
  [
    "[env:init] ✓ 已生成 .env（随机密钥 + 本地 OAuth 占位值）。",
    "[env:init]   · GitHub OAuth 要真跑登录流程时，请换成自己的 client id / secret；",
    "[env:init]   · .env 已被 gitignore，凭据不会入库。",
  ].join("\n") + "\n",
);
