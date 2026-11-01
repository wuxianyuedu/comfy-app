#!/usr/bin/env node
// 运行期「陈旧路由表」自愈：常驻探测 + 懒归因（`dev-launcher.mjs` 在就绪之后挂它）。
//
// 症状驱动，不做预测：只看 `/api/health` 是不是 404（且页面 `/` 仍 200 这个已知
// 签名），**不看代码、不看 git**。因此它与 HMR 零重叠 —— HMR 已吸收的 pull 下
// `/api/health` 仍是 200，探测毫不知情、零动作；真坏了才动手。
//
// 归因是**懒的**：只在已经决定要自愈的那一刻才跑一次 `git diff`，拿不到就退化，
// 绝不影响自愈。git 调用全生命周期只有两次（启动记 `headAtBoot` + 自愈时比一次）。
//
// 本模块是**被 `dev-launcher.mjs` import 的库**（不是新入口），平台机制一律不收
// 在这里（进程回收仍在 `port-reap.mjs` / `kill-process-tree`）。

import { spawnSync } from "node:child_process";

import { classifyChanges, describeChanges, parseDiffEntries } from "./sync-attribution.mjs";

/** 运行期探测的节拍：与心跳同档（明显小于「上一位 launcher 已死」的 30s 阈值）。 */
export const RUNTIME_BEAT_MS = 5000;

/** 「接口层持续 404」连中几拍才定性（约 15s）：单拍 404 可能只是路由在按需编译。 */
export const RUNTIME_404_THRESHOLD = 3;

/** 两次自动重启之间的冷却：重启本身要冷编译，不给它喘息等于自杀式循环。 */
export const RUNTIME_HEAL_COOLDOWN_MS = 60_000;

/** 单会话自动重启上限：超限只记日志（界面侧仍会收到通知），不再动手。 */
export const RUNTIME_HEAL_MAX = 3;

/**
 * 读当前 HEAD 的提交号；git 不可用 / 非检出 → null。
 *
 * 只在启动时调一次，值存内存（不落盘、不轮询）—— 它只为归因提供「起点」。
 * @param {string} root @returns {string | null}
 */
export function readGitHead(root) {
  try {
    const r = spawnSync("git", ["rev-parse", "HEAD"], {
      cwd: root,
      encoding: "utf8",
    });
    if (r.status !== 0) {
      return null;
    }
    const head = String(r.stdout ?? "").trim();
    return head === "" ? null : head;
  } catch {
    return null;
  }
}

/**
 * `git diff --name-status -M <base> HEAD` 的原始输出；失败（git 缺失 / base 不存在）
 * → null（调用方退化为「无法归因」）。
 * @param {string} root @param {string} base @returns {string | null}
 */
export function readNameStatusDiff(root, base) {
  try {
    /* `-c core.quotePath=false`：路径要原样（ISSUE #2272，机制见 `scripts/changed-scope.mjs`
     * 的文件头「口径 ④」）。 */
    const r = spawnSync(
      "git",
      ["-c", "core.quotePath=false", "diff", "--name-status", "-M", base, "HEAD"],
      {
        cwd: root,
        encoding: "utf8",
      },
    );
    if (r.status !== 0) {
      return null;
    }
    return String(r.stdout ?? "");
  } catch {
    return null;
  }
}

/**
 * 懒归因：`headAtBoot..HEAD` 之间改了什么 → 一句人话；拿不到 → null。
 *
 * **只产文案，不参与任何触发判断**：调用方只在已经决定自愈之后调它一次。
 * @param {string} root @param {string | null} headAtBoot @returns {string | null}
 */
export function describeRuntimeHealCause(root, headAtBoot) {
  if (!headAtBoot) {
    return null;
  }
  const raw = readNameStatusDiff(root, headAtBoot);
  if (raw === null) {
    return null;
  }
  const entries = parseDiffEntries(raw);
  return describeChanges(classifyChanges(entries), {
    headChanged: entries.length > 0,
  });
}

/**
 * 运行期路由探测（有界）。
 *
 * 只有一处判据：**曾经就绪、现在连续 N 拍 404、且页面 `/` 仍 200** → 交一次
 * 「重启 dev」的动作（动作本身由编排器注入，本模块不碰进程）。其余一切状态
 * （`not-up` / 503 / 冷启动期的 404）都只是把计数清零，交给既有的断开/恢复链路。
 *
 * @param {object} ctx
 * @param {(m: string, l?: import("./log.mjs").LogLevel) => void} ctx.log 日志出口
 * @param {() => Promise<"ready" | "not-up" | "route-404" | "schema-not-ready">} ctx.probeHealth
 * @param {() => Promise<boolean>} ctx.probeRoot 复核页面 `/` 是不是仍 200
 * @param {() => Promise<void>} ctx.onHeal 真正要做的自愈动作（轻量重启 dev server）
 * @param {number} [ctx.beatMs]
 * @param {number} [ctx.threshold]
 * @param {number} [ctx.cooldownMs]
 * @param {number} [ctx.maxHeals]
 * @param {boolean} [ctx.armedInitially] 调用方是否**已经确认过就绪**（默认 false）
 * @returns {{ tick: () => Promise<void>, stop: () => void,
 *            stats: () => { armed: boolean, failures: number, heals: number } }}
 */
export function createRuntimeRouteWatch({
  log,
  probeHealth,
  probeRoot,
  onHeal,
  beatMs = RUNTIME_BEAT_MS,
  threshold = RUNTIME_404_THRESHOLD,
  cooldownMs = RUNTIME_HEAL_COOLDOWN_MS,
  maxHeals = RUNTIME_HEAL_MAX,
  armedInitially = false,
}) {
  /* 判据状态只有两个布尔与两个计数，**不落盘**：编排器进程活着它们就在。 */
  let armed = armedInitially;
  let failures = 0;
  let heals = 0;
  let lastHealAt = 0;
  let stopped = false;
  let running = false;

  async function tick() {
    /* 上一拍还没跑完就跳过这一拍：探测本身是网络 IO，串行化避免堆积。 */
    if (stopped || running) {
      return;
    }
    running = true;
    try {
      const state = await probeHealth();
      if (state === "ready") {
        armed = true;
        failures = 0;
        return;
      }
      /* 非 404（连不上 / 503 / 其它 HTTP 错）一律交给既有链路；冷启动期（还没
       * 就绪过）的 404 同样不算「路由表坏了」。 */
      if (state !== "route-404" || !armed) {
        failures = 0;
        return;
      }
      failures += 1;
      if (failures < threshold) {
        return;
      }
      if (heals >= maxHeals) {
        if (failures === threshold) {
          log(
            `接口层持续 404，但本会话已自动重启 ${heals} 次（上限 ${maxHeals}），改为只提示不再自动重启（见 log/nextjs/）。`,
            "WARN",
          );
        }
        return;
      }
      if (Date.now() - lastHealAt < cooldownMs) {
        return;
      }
      /* 动手前多花一次请求复核「页面 200 / 接口 404」这个已知签名：页面也非 200
       * 说明是「服务半死」，那是另一类故障，不套用这条自愈。 */
      const rootOk = await probeRoot();
      if (!rootOk) {
        log(
          "接口层输出 404，但页面路由也非 200（服务半死），本探测不处理，交给断开/恢复链路。",
          "WARN",
        );
        failures = 0;
        return;
      }
      failures = 0;
      heals += 1;
      lastHealAt = Date.now();
      log(
        `运行期检测到接口层持续 404（页面仍 200），判定为陈旧路由表：轻量重启 dev server（第 ${heals}/${maxHeals} 次）。`,
        "WARN",
      );
      await onHeal();
    } catch (error) {
      log(`运行期路由探测异常：${error instanceof Error ? error.message : String(error)}`, "WARN");
    } finally {
      running = false;
    }
  }

  const timer = setInterval(() => {
    void tick();
  }, beatMs);

  return {
    tick,
    stop() {
      stopped = true;
      clearInterval(timer);
    },
    stats() {
      return { armed, failures, heals };
    },
  };
}
