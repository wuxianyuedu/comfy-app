/**
 * `executor-mode.mjs` — `COMFY_EXECUTOR` 判据的**纯 Node 侧唯一定义**
 * （P3 §5 ADR §14 D5 / Phase 4-A4）。
 *
 * 为什么要有这一份：同一个开关此前有三处各自实现——Next 侧
 * `src/lib/comfyui/executor-mode.ts`、launcher 的 `resolveComfyExecutorMode()`、
 * host 脚本自己那两行。前两份规则一致，host 那份**漏了 `trim()`、也漏了 `.env`
 * 回读**，于是两个真实错配：`COMFY_EXECUTOR=" host "` 时 Next 把行写成
 * `claimedBy='host'` 而 host 起着骨架；只在 `.env` 里写开关时手工起 host 也静默
 * 跑成骨架——两种表现都是「任务永远停在队列里等回收器判失败」，而界面看不出为什么。
 *
 * 为什么不干脆让三处共用一份：跨**层**共用（TS ↔ 纯 Node）要么给 launcher 引入
 * tsx（launcher 是纯 Node、且它拉起的就是 tsx 本身，这条会伤启动链），要么把
 * `.mjs` 引到 `src/lib` 里（撞 §18.4 的分层与 scanner 判据）。所以分层各留一份、
 * 由 `tests/executor-mode-consistency.test.ts` 逐值比对两侧的判决；本模块收口的
 * 是**同一层内**的重复（launcher 与 host 脚本两个纯 Node 宿主），这一层没有跨层
 * 代价（§12.18 复用优先）。
 *
 * 归一化规则（与 TS 侧必须逐字一致，由门禁保证）：
 *   · `trim()` + `toLowerCase()`；
 *   · `host` → host；空 / `inline` → inline；
 *   · 其它非空值 → 按 inline 起，但把原值回给调用方去 warn（不猜意图，也不静默）。
 */
import fs from "node:fs";
import path from "node:path";

import { parseEnvFile } from "../env-preflight.mjs";

const ROOT = path.resolve(import.meta.dirname, "..", "..");

/** 开关的 env 名（只此一处，别处一律 import 本模块）。 */
export const EXECUTOR_ENV_KEY = "COMFY_EXECUTOR";

/**
 * 把任意原始值归一化成 `{ mode, unknown }`。
 * `unknown` 非 null 时表示「这是用户写下的、我们认不出的值」——判决仍然走
 * inline，但调用方必须留一行可见提示（规范硬规则 4）。
 *
 * @param {unknown} raw
 * @returns {{ mode: "host" | "inline", unknown: string | null }}
 */
export function normalizeExecutorMode(raw) {
  const value = String(raw ?? "")
    .trim()
    .toLowerCase();
  if (value === "host") return { mode: "host", unknown: null };
  if (value === "" || value === "inline")
    return { mode: "inline", unknown: null };
  return { mode: "inline", unknown: value };
}

/**
 * 取值优先级：进程 env → 仓库根 `.env` → 空。
 *
 * 为什么必须回读 `.env`：纯 Node 进程不会自动加载它（Next 侧由 @next/env 注入，
 * 所以 TS 那份不需要这一层）。launcher 拉起 host 时会把归一化后的值显式写进子
 * 进程 env，但**手工起 host** 的用户只有 `.env` 时可依赖这一层。
 *
 * 只有**没给**（key 不存在）才回读 `.env`：显式 `COMFY_EXECUTOR=`（空值）是
 * 「我要关掉它」的意思，不该被 `.env` 里的旧值顶掉。这条与 Next 侧完全同形——
 * @next/env 也只在 `process.env` 里没有该 key 时才用 `.env` 填，所以「进程里
 * 给了空值」在两侧都判 inline。
 *
 * @param {{ procEnv?: Record<string, string | undefined>, envFilePath?: string }} [options]
 * @returns {string}
 */
export function readExecutorEnvRaw({
  procEnv = process.env,
  envFilePath = path.join(ROOT, ".env"),
} = {}) {
  const fromProc = procEnv[EXECUTOR_ENV_KEY];
  if (fromProc !== undefined) return String(fromProc);
  try {
    if (!fs.existsSync(envFilePath)) return "";
    return (
      parseEnvFile(fs.readFileSync(envFilePath, "utf-8")).get(
        EXECUTOR_ENV_KEY,
      ) ?? ""
    );
  } catch {
    // 读不到 .env 不致命：按「未设」处理，与 host 侧 DATABASE_URL 那条同形。
    return "";
  }
}

/**
 * 一步到位：读值 + 归一化。launcher 与 host 脚本都用它。
 *
 * @param {{ procEnv?: Record<string, string | undefined>, envFilePath?: string }} [options]
 * @returns {{ mode: "host" | "inline", unknown: string | null }}
 */
export function resolveExecutorMode(options = {}) {
  return normalizeExecutorMode(readExecutorEnvRaw(options));
}
