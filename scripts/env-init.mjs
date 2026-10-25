#!/usr/bin/env node
// 本地 `.env` 生成 / 补齐入口（跨平台，`pnpm env:init`）。
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
// 幂等与「只补不覆盖」：已有值一律不动。今天它还只做到「不覆盖」，
// 现在连「补缺」一起做到 —— 见下面 `missingKeys` 那段（ISSUE #2186）。
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

// 密钥与占位值的**单一定义点**在 launcher-core 那份（桌包 standalone 运行期也用它）：
// 两侧各写一份的后果不是重复代码，而是「dev 检出的鉴权配置形状」与「桌包里的」悄悄
// 不同——而两边都能正常启动，没有任何判据会红（§12.12）。
import {
  newAuthSecret,
  OAUTH_PLACEHOLDER,
} from "./launcher-core/standalone-runtime-env.mjs";
// `.env` 的解析也只有一份：`env-preflight.mjs` 那同一条最小子集（忽略 `#` 注释行、
// 去成对引号与行尾注释）。在这里再写一个解析器就是第三份口径（第三份是 app-port 那份
// 单键取值 —— 它只取一个键，形状不同，不并入）。
import {
  REQUIRED_ENV_KEYS,
  missingEnvKeys,
  parseEnvFile,
} from "./env-preflight.mjs";
// 留痕短名（`COMFYAPP_DEV_HANDLE`）的取值链也只有一处（`dev-handle.mjs`，ISSUE #2355）：
// 这里写的值与 `ship` 念的值必须同源，否则「跑过 env:init」之后两边各说各的名字。
import { DEV_HANDLE_ENV_KEY, devHandleForEnvFile } from "./dev-handle.mjs";

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
  return REQUIRED_ENV_KEYS.every((key) =>
    new RegExp(`^${key}="?([^"\\r\\n]+)"?\\s*$`, "m").test(content),
  );
}

/**
 * 算出「该往 `.env` 追加哪些行」—— 只补缺，绝不覆盖已有键。
 *
 * 「哪些键算缺」的唯一判据是 `env-preflight.mjs` 的 `missingEnvKeys`：启动器那条
 * 提醒读数与这里共用它（ISSUE #2205）。两边各写一份的后果不是重复代码，而是
 * 「念出来的键」与「真补上去的键」会悄悄分叉 —— 用户按提示跑完仍然缺。
 *
 * 补行的**值**在这里定：必填三项走那一份单一定义点（随机密钥 / OAuth 占位值），
 * 其余照 `.env.example` 的原样值。注释形态的可选键（`# COMFYAPP_PORT=...`）不进
 * 补齐面，理由在 `missingEnvKeys` 的注释里（把注释提升成真值会改行为）。
 *
 * @param {{example: string, current: string}} input
 * @returns {string[]} 待追加的整行（已按 `KEY="value"` 形态）
 */
function missingLines({ example, current }) {
  const exampleValues = parseEnvFile(example);
  return missingEnvKeys({ example, current }).map((key) => {
    // 留痕短名**不留空**（ISSUE #2355）：过去照 example 的空值写回去，于是「跑过
    // env:init」的人看到的仍是 `COMFYAPP_DEV_HANDLE=""` —— 补了跟没补念出来是同一句话。
    // 现在照同一条取值链取一个确定的名字（NPC 用 `CNB_NPC_NAME`、本地用 `git config
    // user.name`、都没有用 `cnb`），人想换就改这一行。
    if (key === DEV_HANDLE_ENV_KEY) {
      return `${key}="${devHandleForEnvFile({ root, env: process.env }).name}"`;
    }
    // 必填三项的值由那一份单一定义点负责 —— 不在这里造第二个密钥来源。
    if (!REQUIRED_ENV_KEYS.includes(key)) {
      return `${key}="${exampleValues.get(key) ?? ""}"`;
    }
    return key === "BETTER_AUTH_SECRET"
      ? `${key}="${newAuthSecret()}"`
      : `${key}="${OAUTH_PLACEHOLDER}"`;
  });
}

if (!fs.existsSync(examplePath)) {
  process.stderr.write(`[env:init] ✗ 找不到 ${examplePath}，无法生成 .env。\n`);
  process.exit(1);
}

const exampleText = fs.readFileSync(examplePath, "utf8");

if (!fs.existsSync(envPath)) {
  const next = fill(exampleText);
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
  process.exit(0);
}

// 已存在 `.env`：今天的旧档是「必填齐 ⇒ 整份跳过」，于是**本仓此后新增的任何可选键都传不到
// 这份检出**（#2186 的现场：同机四份并行检出里两份有 `.env`、都没有 `COMFYAPP_DEV_HANDLE`，
// 而 #2175 那格留痕全靠它）。现在改成「必填齐也照样补缺」，但「只补没有的键」这条
// 承诺一字未改 —— 已有值不覆盖、不重排、不动注释。
const current = fs.readFileSync(envPath, "utf8");
const hadRequired = hasRequiredValues(current);
const filled = hadRequired ? current : fill(current);
const additions = missingLines({ example: exampleText, current: filled });
const next =
  additions.length > 0
    ? `${filled.replace(/\s*$/, "")}\n${additions.join("\n")}\n`
    : filled;

if (next !== current && !hasRequiredValues(next)) {
  // 自检（与生成分支同一条）：补齐没命中时当场暴露，而不是留下一个仍然起不来的 .env。
  process.stderr.write(
    "[env:init] ✗ 补齐之后必填项仍为空 —— 请检查 .env.example 的键名与本脚本的替换口径。\n",
  );
  process.exit(1);
}

if (next === current) {
  process.stdout.write(
    "[env:init] ✓ 已存在 .env：必填项非空，且 .env.example 里没有它缺的键 ⇒ 没有要补的，" +
      "跳过写入（已有键一律不覆盖）。\n",
  );
  process.exit(0);
}

fs.writeFileSync(envPath, next, "utf8");
process.stdout.write(
  [
    hadRequired
      ? "[env:init] ✓ 已有 .env，必填项本来就齐 ⇒ 只补缺失的键（不覆盖你的任何配置）。"
      : "[env:init] ✓ 已有 .env 但必填项为空，已就地补齐（其余配置保持不变）。",
    ...additions.map((line) => {
      const key = line.split("=", 1)[0] ?? line;
      // 必填三项的值是密钥/占位值：只说补了哪个键，不回显值（值不进日志）。
      if (REQUIRED_ENV_KEYS.includes(key)) {
        return `[env:init]   · 补上缺失的必填项 ${key}（值由本脚本生成，不打出来）`;
      }
      if (key === DEV_HANDLE_ENV_KEY) {
        /* 名字不是密钥，念出来才可核对（`ship` 念的是同一个值）。「取的」与「填的」
         * 是两件事：自动取的那个换机器 / 换会话会变，值得提醒一句。 */
        const picked = devHandleForEnvFile({ root, env: process.env });
        return (
          `[env:init]   · 补上缺失的键 ${key}="${picked.name}"（${picked.source}` +
          (picked.source === "进程环境" ? "" : " ⇒ 自动取的，要固定就改这一行") +
          "）"
        );
      }
      return `[env:init]   · 补上缺失的键 ${key}（值照 .env.example；填你自己的再启动）`;
    }),
  ].join("\n") + "\n",
);
