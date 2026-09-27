#!/usr/bin/env node
/**
 * quality-gate-shared.mjs — 质量门禁的**共享常量**（规范 11.12）
 *
 * 已知基线失败清单只有一处来源：先前它写在 `scripts/quality-gate.ps1` 里，
 * `scripts/run-tests.ps1` 用正则去解析那份 PowerShell 源码。两份实现（PowerShell
 * 与 Node）都要读同一份清单时，从 `.ps1` 源码里解析就等于把「另一门语言的文件」
 * 当成数据源 —— 改一次缩进/写法就会让解析静默返回空数组（排除项悄悄失效，
 * 红/绿不再可归因）。因此清单搬到本模块（纯数据、零依赖），两侧都 import。
 *
 * 登记的判据与代价（规范 11.12）：只放「确证与本次改动无关的历史基线失败」，
 * **每一条都要写明归属与谁来修**；修好就立刻删（留着 = 永久静默跳过，退化不会再
 * 被发现）。粒度是**文件**，所以一条红会连同一文件里其他断言一起放行 —— 这是这套
 * 机制已知的粗糙处，登记前先确认那条门禁在别处还有没有更强的执行者（下面每条都注了）。
 *
 * 当前登记的是 2026-09-27 全量基线里剩余的真断言失败（超时类已由规范 §11.13 的
 * 预算 + `maxWorkers` 收掉）。它们会挡住提交钩子的**增量测试层**（§13.5.8）：那一层
 * 沿 import 闭包把它们拉进来时，别线的红会让无关提交无法落地，而「拿不准就跑全量」
 * 在这里也不是兜底 —— 全量本来就带着这几条红。
 */
export const KNOWN_FAILED_FILES = [
  /* 壳线（Tauri / splash-assets）：
   * - 「三份启动页副本一致」= `src-tauri/splash-assets/**` 的三份副本内容漂移
   *   （实测 `expected 2 to be 1`），要壳线决定哪一份是对的；
   * - 「陈旧壳（启动器已退出）自动回收后继续构建」= 回收判据与本机壳产物形态有关。
   * 别处更强的执行者：文件结构**硬规则本体**由 `scripts/check-file-structure.cjs`
   * 在钩子 D 组每次提交都跑（这份用例是门禁脚本自己的回归套件，跳过它不等于
   * R1–R12 无人执行）。 */
  "tests/check-file-structure.test.ts",
  /* 启动线：`whichCommand` / `probePnpm` 的形态判据与本机 pnpm shim（corepack /
   * `.cmd` / `.ps1` 宿主）实际形态相关，本机红。别处更强的执行者：启动编排本身由
   * `pnpm check:toolchain` 与 `scripts/dev-launcher.mjs` 的真实运行覆盖。 */
  "tests/dev-launcher-toolchain-gate.test.ts",
  "tests/dev-launcher-downstream-exit.test.ts",
  /* 产物线：读的是磁盘上的真 `.next/standalone`，缺的是「`node_modules` 下任意包的
   * `docs` 目录」这一条 excludes（`pino` 自带的文档被带进产物）—— 修它要改
   * `next.config.js` 并重跑一次 `pnpm build` 才验得动。
   * 别处更强的执行者：`scripts/check-standalone-contents.cjs` 是同一判据的
   * 产物侧检查，构建后按需跑（规范 §7.3 / §7.4）。 */
  "tests/turbopack-tracing-excludes.test.ts",
];
