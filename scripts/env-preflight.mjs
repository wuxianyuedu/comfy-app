#!/usr/bin/env node
// 启动前 `.env` 预检（dev.mjs / start.mjs 共用，单一事实源）。
//
// 为什么要在**起 Next 之前**判：`src/env.js` 的校验发生在 Next 加载
// next.config.js 的阶段，而 Next 会先打印
//   - Local: http://localhost:<port>
//   ✓ Ready in 77ms
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
    if (!line || line.startsWith("#")) continue;
    const m = /^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    let value = (m[2] ?? "").trim();
    // 去掉成对引号（.env.example / prepare-local-run.ps1 都写成 KEY="..."）。
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
      (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
    ) {
      value = value.slice(1, -1);
    }
    out.set(m[1], value);
  }
  return out;
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
  if (envVars.SKIP_ENV_VALIDATION) return null;
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
  if (emptyKeys.length === 0) return null;
  return { message: buildHint({ envPath, missingFile: false, emptyKeys }) };
}

/**
 * 在入口脚本里接线：预检失败即打印提示并**非零退出**（不再起 Next）。
 * @param {string} root 项目根（绝对路径）
 * @param {Record<string, string | undefined>} [envVars]
 * @returns {void}
 */
export function exitIfEnvNotReady(root, envVars = process.env) {
  const problem = checkEnvFile(root, envVars);
  if (!problem) return;
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
