#!/usr/bin/env node
/**
 * sleep-guard.mjs —— PreToolUse 钩子的**长 sleep 拦截器**（ISSUE #4118）。
 *
 * 禁令的第一条是「能立即执行就直接执行」：只读回读口（`pnpm ship --result`）不阻塞、
 * 立即返回，在命令之间插 sleep 纯属多余；确实要等异步终态，走确定性等待组件
 * `pnpm ship:wait`（短间隔 + 明确终止条件 + 总上限，坏消息立即返回）。本钩子把
 * 这条禁令里「不许插长 sleep」那一半变成机器执行者：Bash 命令里出现 **≥60s** 的
 * sleep（含 `sleep 2m` / `Start-Sleep -Seconds 120` 这类形状）就拦下（退出码 2），
 * 并把正确出口写在 stderr 里；<60s 的短退避不拦。
 *
 * 只拦、不代跑：拦截理由永远指向「该用什么」，不替执行者重写命令。
 * 解析失败一律放行（fail-open）：这一格守的是「别把等待写进命令流」，
 * 不是第二道权限闸 —— 因解析抖动拦下正常命令，代价远大于漏掉一次 sleep。
 */
import path from "node:path";
import process from "node:process";

/** 拦截阈值（秒）：单条命令里累计 sleep ≥ 60s 即拦。 */
export const BLOCK_THRESHOLD_SECONDS = 60;

/**
 * 从一条 shell 命令里数出 sleep 的总秒数。认两种形状：
 *   · POSIX：`sleep 90` / `sleep 1.5` / `sleep 2m` / `sleep 1h`（后缀 s/m/h，可省）；
 *   · PowerShell：`Start-Sleep -Seconds 120` / `-s 3m` / `-Milliseconds 500`。
 * 认不出形状的 occurrence 不计入（宁漏勿误）。
 *
 * @param {string} command
 * @returns {number} 累计秒数；没有 sleep ⇒ 0
 */
export function sleepSecondsIn(command) {
  const text = String(command ?? "");
  let total = 0;
  const unit = (/** @type {string | undefined} */ v, /** @type {string} */ u) => {
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0) {
      return 0;
    }
    if (u === "m") {
      return n * 60;
    }
    if (u === "h") {
      return n * 3600;
    }
    if (u === "ms") {
      return n / 1000;
    }
    return n;
  };
  /* POSIX：sleep 后面跟一个数字（可带小数）与可选 s/m/h 后缀。 */
  for (const m of text.matchAll(/\bsleep\s+(?<value>\d+(?:\.\d+)?)(?<unit>[smh])?\b/gi)) {
    total += unit(m.groups?.value, (m.groups?.unit ?? "s").toLowerCase());
  }
  /* PowerShell：Start-Sleep -Seconds 120 / -s 3m / -Milliseconds 500。 */
  for (const m of text.matchAll(
    /Start-Sleep\s+(?:-\w+\s+)*?-(?<kind>Seconds|Milliseconds|s|ms)\s+(?<value>\d+(?:\.\d+)?)(?<unit>[smh])?/gi,
  )) {
    const kind = (m.groups?.kind ?? "").toLowerCase();
    total += unit(
      m.groups?.value,
      kind === "seconds" || kind === "s" ? (m.groups?.unit ?? "s").toLowerCase() : "ms",
    );
  }
  return total;
}

/**
 * PreToolUse 入口：读 stdin 的钩子入参，判 Bash 命令里的 sleep。**退出码即判决**
 * （0 放行 / 2 拦下），理由走 stderr —— 不产 JSON，避开严格输出 schema 的额外键。
 *
 * @param {{readStdin?: () => Promise<string>, log?: (s: string) => void}} [io]
 * @returns {Promise<number>} 0 放行 / 2 拦下
 */
export async function main(io = {}) {
  const readStdin =
    io.readStdin ??
    (async () => {
      const chunks = [];
      for await (const chunk of process.stdin) {
        chunks.push(chunk);
      }
      return chunks.join("");
    });
  const log = io.log ?? ((s) => process.stderr.write(`${s}\n`));
  let payload;
  try {
    const raw = await readStdin();
    payload = raw === "" ? null : JSON.parse(raw);
  } catch {
    /* 入参读不出来 ⇒ 放行（fail-open，见文件头）。 */
    return 0;
  }
  const input = payload?.tool_input ?? payload?.input ?? {};
  const command = String(input.command ?? input ?? "");
  const seconds = sleepSecondsIn(command);
  if (seconds < BLOCK_THRESHOLD_SECONDS) {
    return 0;
  }
  log(
    `[sleep-guard] ✗ 这条命令里有 ${Math.round(seconds)}s 的 sleep（阈值 ${BLOCK_THRESHOLD_SECONDS}s）⇒ 拦下。` +
      "「能立即执行就直接执行」：只读回读口（如 `pnpm ship --result`）不阻塞，直接跑、把工具超时调够；" +
      "确实要等异步终态 ⇒ 用确定性等待组件 `pnpm ship:wait`（短间隔 + 明确终止条件 + 总上限，坏消息立即返回）。" +
      "（AGENTS 硬规则 32 / ISSUE #4118）",
  );
  return 2;
}

if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === import.meta.filename) {
  main().then((code) => {
    process.exit(code);
  });
}
