/* ── 依赖面是否与当前 lockfile 一致（「拉了新代码但没重装依赖」）──────────────
 *
 * 用户报告（ISSUE #1692 同源现场）：`git pull` 拉到的新代码动了 `pnpm-lock.yaml`，
 * 而**长开的应用**还在用旧依赖树跑。此时页面的恢复流程是「停下服务 → `pnpm install`
 * → 重开」——这三步**没有一件能在应用内自动完成**（重装依赖会 EPERM 锁死原生模块，
 * 见硬规则 9），所以唯一能做的是「**让客户端知道该去做这件事**」。本模块就是那条
 * 判定：当前依赖面是不是已经落后于仓库的 lockfile。
 *
 * ## 判据复用，不另造
 *
 * 判「依赖装没装对」这件事，启动编排里早有**唯一实现**
 * （`scripts/launcher-core/worktree.mjs` 的 `lockfileDrift` / `unresolvableDeclaredDeps`）：
 *   · `lockfileDrift` 比的是两份 lockfile 的**实质差异**（不是字节相等，理由见该模块
 *     注释），并自带 (size, mtime) 短路缓存 —— 每 30s 被打一次也不产生新解析；
 *   · `unresolvableDeclaredDeps` 补一档「lockfile 一致但个别包就是解析不到」
 *     （ISSUE #1721 的 axe-core 形态）。
 * 本模块**只做包装**：把这两条已成熟的判据折成「要不要动作」这一个结论。在这里另写
 * 一套扫描，等于让同一件事有两个会各自漂开的说法。
 *
 * ## 「无法判定」绝不等于「陈旧」
 *
 * 生产形态（standalone 内嵌 / `next start`）与纯 web 手工启动都**没有**这条链路要的
 * 前提（仓库根 lockfile / `next dev`），这时一律回 `null` 而不是 `{ stale: true }`：
 * 对着一棵由打包链路负责的依赖树报「你该去 `pnpm install`」，是把排查引向另一条路。
 */

import "server-only";

import {
  lockfileDrift,
  unresolvableDeclaredDeps,
} from "../../../scripts/launcher-core/worktree.mjs";

import type { DepsFreshnessState } from "./code-update-since-load";

/** 依赖面新鲜度的判定结果。 */
export interface DepsFreshness {
  /** 是否需要「停服务 + 重装依赖」这一动作。 */
  stale: boolean;
  /** 陈旧的形态（供文案分流），取值与客户端共用一个定义。 */
  state: DepsFreshnessState;
  /** 解析不到的包名；仅 `state === "unresolved"` 时非空（供文案点名）。 */
  missing: Array<string>;
}

/**
 * 读一次依赖面新鲜度。
 *
 * 回 `null` = **无法判定**（非 dev / 不是检出），客户端据此**不提示**；回
 * `{ stale: false }` = 判定为新鲜。两者是不同的事实，不可合流 —— 合并会把
 * 「不知道」显示成「没事」，那正是本条目要消灭的那类静默。
 */
export function readDepsFreshness(root: string = process.cwd()): DepsFreshness | null {
  /* 只有 `next dev` 这一档判：生产形态的依赖面由打包链路负责，这里既没有动作
   * 出口、也会对一棵本就该由构建决定的依赖树误报。 */
  if (process.env.NODE_ENV !== "development") return null;

  const drift = lockfileDrift(root);
  /* 仓库根没有 lockfile ⇒ 这不是一个源码检出（桌包 / 纯 web）。 */
  if (drift.state === "no-lockfile") return null;
  if (drift.state === "drift") {
    return { stale: true, state: "drift", missing: [] };
  }
  if (drift.state === "no-install") {
    return { stale: true, state: "no-install", missing: [] };
  }

  /* lockfile 实质一致也仍可能有个别声明依赖解析不到：本地依赖树停在「装它之前」
   * 的那一套上，新加的包只以传递依赖的旧版本落在私有层里。 */
  const missing = unresolvableDeclaredDeps(root);
  if (missing.length > 0) {
    return { stale: true, state: "unresolved", missing };
  }

  return { stale: false, state: "fresh", missing: [] };
}
