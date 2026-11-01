/**
 * `app-runtime` 跨进程补齐通道的**跨语言一致性**。
 *
 * launcher（`.mjs`）与 dev server（TS）要落在**同一份**文件上：预检提醒
 * （壳过期 / pnpm 不匹配）发生在 dev server 就绪**之前**，走不了
 * `POST /api/logs/app-runtime`，只能由 launcher 自己落盘，而随后整段应用日志
 * 由 `src/lib/log/app-runtime-log.ts` 写。两侧的名字若不同形，用户读到的
 * 「本次启动日志」就永远缺开头那两句 —— 而面板看起来两条通道都正常。
 *
 * 这是本仓库反复踩过的那一类：**同一个值在两处各写一遍**（`db-backup-core.mjs`
 * 与 `runtime-log-file.ts` 也有同样的成对关系）。两侧都有真实现、也能在同一个
 * 进程里 import，所以这里做**真跑**的对拍，而不是只锁「都引了同一份向量」。
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  appRuntimeLogFileName,
  runtimeStamp,
} from "../scripts/launcher-core/log.mjs";
import { runtimeLogFileName, LAUNCH_STAMP_ENV } from "../src/lib/log/runtime-log-file";
import { launcherChainSource } from "./helpers/launcher-source";

const ROOT = process.cwd();

describe("app-runtime 文件名跨语言一致（launcher ↔ dev server）", () => {
  it("同一个时刻：两侧给出同一个文件名", () => {
    for (const at of [
      new Date(2026, 9, 10, 5, 30, 59),
      new Date(2026, 0, 1, 0, 0, 0),
      new Date(2026, 11, 31, 23, 59, 59),
    ]) {
      expect(appRuntimeLogFileName(runtimeStamp(at))).toBe(
        runtimeLogFileName("app-runtime", at),
      );
    }
  });

  it("名字里**不含冒号**（Windows 下 `:` 非法，带上它就是静默不落盘）", () => {
    const name = appRuntimeLogFileName(
      runtimeStamp(new Date(2026, 9, 10, 5, 30, 59)),
    );
    expect(name.includes(":")).toBe(false);
    expect(/[\\/*?"<>|]/.test(name)).toBe(false);
  });

  it("launcher 不再写固定名 `app-runtime.log`（那是读侧认作「更早的日志」的形态）", () => {
    /* 固定名会被 `listRuntimeLogFiles` 判成 `startedAt: null`、排序恒最前，
     * 于是 launcher 每轮写下的提醒被读成「更早的日志」，并在保留策略里当**最旧
     * 的一份**先删掉、再由下一次写重建 —— 「删除 → 重建」交替，正在写的那一份
     * 被轮转逻辑当垃圾清掉（静默丢日志）。 */
    /* 断的是**编排链路**上有没有这个形状，不是「它住在哪一份文件里」——
     * 编排器已按 R5 拆进 `launcher-core/**`（ISSUE #1811 第四刀），
     * 只读主文件时这几条会对着空串断言（`not.toContain` 恒真）。 */
    const src = launcherChainSource();
    expect(src).not.toContain('"app-runtime.log"');
    expect(src).toContain("appRuntimeLogFileName(");
  });

  it("环境变量名由 TS 侧定义、launcher 侧引用同一串（两侧不许各写一个字面量）", () => {
    expect(LAUNCH_STAMP_ENV).toBe("COMFYAPP_LAUNCH_STAMP");
    /* 同上：链路（主文件 + `launcher-core/**`）而不是单份主文件。 */
    const launcher = launcherChainSource();
    /* launcher 是 `.mjs`（读不了 TS 常量），所以它那一侧**必须**写出字面量；
     * 这里锁的就是「两处是同一串」——写错的表现是 dev server 读不到戳，
     * 静默退回当前时刻、把两份文件拆开。 */
    /* 记法两种都要认：`process.env.X = …` 与 `process.env["X"] = …` 都出现过
     * （前者是这里的写法）。只认一种会让判据在下次换记法时假红，而它与
     * 「两侧同串」这条契约无关。 */
    expect(
      launcher.includes(`env.${LAUNCH_STAMP_ENV}`) ||
        launcher.includes(`"${LAUNCH_STAMP_ENV}"`),
    ).toBe(true);
    const appLog = fs.readFileSync(
      path.join(ROOT, "src", "lib", "log", "app-runtime-log.ts"),
      "utf8",
    );
    expect(appLog).toContain("LAUNCH_STAMP_ENV");
  });
});
