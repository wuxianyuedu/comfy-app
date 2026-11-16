#!/usr/bin/env node
// 启动前 `.env` 预检（dev.mjs / start.mjs 共用，单一事实源）。
//
// 为什么要在**起 Next 之前**判：`src/env.js` 的校验发生在 Next 加载
// next.config.js 的阶段，而 Next 会先打印
//   就绪后才会打印形如 - Local: http://localhost:<port> 的一行
//   ✓ Ready in 77ms（未就绪时不该出现这一行）
// 然后才抛错退出。用户看到的是「已就绪」紧跟一屏栈，最自然的读法是
// 「服务起来了但是有 bug」——而真相是**它根本没起来**（端口无人监听）。
// 更糟的是缺文件那条错误里的小贴士指向 `tools/start/run-local.ps1`，
// 那是 Windows 专属入口（Linux / macOS / CI 上不存在，规范 §9 也明确不依赖它）。
//
// 判据与 `src/env.js` 完全一致（同一条 schema 口径）：
//   · `.env` 文件存在；
//   · 三个必填项非空 —— createEnv 配了 `emptyStringAsUndefined: true`，
//     所以 `.env.example` 里的 `KEY=""` 等价于「没给」。这正是照文档
//     `cp .env.example .env` 走的人会撞上的第二层失败。
// CI / Playwright 设了 `SKIP_ENV_VALIDATION` 时整段跳过（与 src/env.js 同口径）。
import fs from "node:fs";
import path from "node:path";

/** 必填项：空串/纯空白视为缺失（同 `emptyStringAsUndefined`）。 */
export const REQUIRED_ENV_KEYS = [
  "BETTER_AUTH_SECRET",
  "BETTER_AUTH_GITHUB_CLIENT_ID",
  "BETTER_AUTH_GITHUB_CLIENT_SECRET",
];

/**
 * 读 `.env` 的 KEY=VALUE（去掉成对引号与行尾注释），忽略 `#` 注释行。
 * 只实现本判据需要的最小子集 —— 不引入 dotenv 依赖，也不去追求完整语义。
 * @param {string} content
 * @returns {Map<string, string>}
 */
export function parseEnvFile(content) {
  const out = new Map();
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }
    const m = /^(?<key>[A-Za-z_][A-Za-z0-9_]*)\s*=\s*(?<value>.*)$/.exec(line);
    if (!m) {
      continue;
    }
    const key = m.groups?.key ?? "";
    let value = (m.groups?.value ?? "").trim();
    // 去掉成对引号（.env.example / prepare-local-run.ps1 都写成 KEY="..."）。
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
      (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
    ) {
      value = value.slice(1, -1);
    }
    out.set(key, value);
  }
  return out;
}

/**
 * `.env.example` 里未注释、而 `.env` 里整行都没有的键 —— `pnpm env:init` 的补齐面。
 *
 * 这一格是**判据**，不是「怎么补」：`env-init.mjs` 与启动器那条读数共用它
 * （ISSUE #2205）。写的值由调用方决定（必填项生成密钥、其余照 example），
 * 这里只回答「哪些键整行都不在」。两条口径要一起读：
 *   · 注释形态的可选键（`# COMFYAPP_PORT=...`）**不进补齐面** —— 把注释提升成真值
 *     会改行为（端口口径按检出路径推导，钉回固定端口会打散并行检出）；
 *   · 必填项即便不在 `.env.example` 里，整行缺失时也要补（值由 `env:init` 生成）。
 *
 * @param {{ example: string, current: string }} input
 * @returns {string[]} 按 `.env.example` 出现顺序（不在 example 里的必填项排在末尾）
 */
export function missingEnvKeys({ example, current }) {
  const have = parseEnvFile(current);
  const fromExample = [...parseEnvFile(example).keys()].filter((k) => !have.has(k));
  const requiredAbsent = REQUIRED_ENV_KEYS.filter((k) => !have.has(k));
  return [...new Set([...fromExample, ...requiredAbsent])];
}

/**
 * 未通过预检时的可行动提示（不夹带任何 Windows 专属入口）。
 * @param {{ envPath: string, missingFile: boolean, emptyKeys: string[] }} info
 * @returns {string}
 */
function buildHint({ envPath, missingFile, emptyKeys }) {
  const lines = [];
  if (missingFile) {
    lines.push(`找不到 ${envPath} —— 应用启动时必须读它。`);
  } else {
    lines.push(`\`.env\` 里这些必填项是空的：${emptyKeys.join(" / ")}`);
    lines.push(
      "（`.env.example` 里它们本身就是空串，而校验把空串当「没给」，所以直接 cp 出来不够用）",
    );
  }
  lines.push("");
  lines.push("可行动作（三平台一致，无需任何 .ps1）：");
  lines.push("  pnpm env:init     # 生成/补齐 .env：随机密钥 + 本地 OAuth 占位值");
  lines.push("");
  lines.push("也可手工处理：把 .env.example 复制为 .env 后，至少填上");
  lines.push("  BETTER_AUTH_SECRET=<64 位随机 hex>");
  lines.push(
    "  BETTER_AUTH_GITHUB_CLIENT_ID / _SECRET=<非空占位值即可，本地不跑 OAuth 时不需要真凭据>",
  );
  return lines.join("\n");
}

/**
 * 预检 `.env`。返回 `null` 表示通过（或已设 SKIP_ENV_VALIDATION 而整体跳过）。
 * @param {string} root 项目根（绝对路径）
 * @param {Record<string, string | undefined>} [envVars]
 * @returns {{ message: string } | null}
 */
export function checkEnvFile(root, envVars = process.env) {
  if (envVars.SKIP_ENV_VALIDATION) {
    return null;
  }
  const envPath = path.join(root, ".env");
  if (!fs.existsSync(envPath)) {
    return { message: buildHint({ envPath, missingFile: true, emptyKeys: [] }) };
  }
  const parsed = parseEnvFile(fs.readFileSync(envPath, "utf8"));
  // 环境变量已在进程里显式给出时不算缺失（与 createEnv 的取值顺序一致）。
  const emptyKeys = REQUIRED_ENV_KEYS.filter((k) => {
    const value = envVars[k] ?? parsed.get(k) ?? "";
    return !value.trim();
  });
  if (emptyKeys.length === 0) {
    return null;
  }
  return { message: buildHint({ envPath, missingFile: false, emptyKeys }) };
}

/**
 * 启动器的**非阻断读数**：`.env` 缺哪些 `pnpm env:init` 会补的键（ISSUE #2205）。
 *
 * 为什么落在这里而不是文档里的一句「记得跑」：`env:init` 的能力已经有了（#2186），
 * 但没有任何时刻提醒人去跑它 —— 不经过 `pnpm ship` 的人永远看不到那一格。
 * 启动应用是人人都会碰到的时刻，所以读数放在启动器里，且**只念不改**：
 * 不写文件、不改退出码。
 *
 * 没有 `.env` / 没有 `.env.example` 时返回 null：前一种 `checkEnvFile` 已经阻断并给出
 * `env:init` 出口，不在这一格重复念；`SKIP_ENV_VALIDATION` 下同样不念（与 `src/env.js`
 * 同口径）。
 *
 * @param {string} root 项目根（绝对路径）
 * @param {Record<string, string | undefined>} [envVars]
 * @returns {string | null}
 */
export function envInitHint(root, envVars = process.env) {
  if (envVars.SKIP_ENV_VALIDATION) {
    return null;
  }
  try {
    const current = fs.readFileSync(path.join(root, ".env"), "utf8");
    const example = fs.readFileSync(path.join(root, ".env.example"), "utf8");
    const keys = missingEnvKeys({ example, current });
    if (keys.length === 0) {
      return null;
    }
    return (
      `.env 缺 ${keys.length} 个 \`.env.example\` 里的键：${keys.join(" / ")} ⇒ ` +
      "`pnpm env:init`（只补缺失的键，不覆盖已有配置）"
    );
  } catch {
    return null;
  }
}

/**
 * 在入口脚本里接线：预检失败即打印提示并**非零退出**（不再起 Next）；
 * 通过时念一次 `envInitHint`（缺键 ⇒ `pnpm env:init`），不改退出码。
 *
 * 这一档覆盖 `pnpm dev` / `pnpm start` 两条直达入口（编排器那条由
 * `startup-gates.mjs` 自己念）——两边共用 `envInitHint`，判据只有一份。
 *
 * @param {string} root 项目根（绝对路径）
 * @param {Record<string, string | undefined>} [envVars]
 * @returns {void}
 */
export function exitIfEnvNotReady(root, envVars = process.env) {
  const problem = checkEnvFile(root, envVars);
  if (!problem) {
    const hint = envInitHint(root, envVars);
    if (hint) {
      process.stderr.write(`[env-preflight] ⚠ ${hint}\n`);
    }
    return;
  }
  process.stderr.write(
    [
      "",
      "[env-preflight] ✗ 环境配置未就绪，**不会**启动服务（避免先打印「✓ Ready」再崩）。",
      "",
      problem.message,
      "",
    ].join("\n"),
  );
  process.exit(1);
}
