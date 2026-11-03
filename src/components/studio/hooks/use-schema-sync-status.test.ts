/**
 * `schemaSyncNotice` 的判据 —— 状态栏那一格说什么、什么时候什么都不说。
 * 四相位：`ready` / `unknown` 不打扰用户；`missing` / `stale` 必须说且给出口。
 * `canPush` 决定出口：本机给「立即同步」（需确认弹窗）；桌包不带 `scripts/db-sync.mjs` 则回落纯命令提示。
 */
import { describe, expect, it } from "vitest";

import {
  schemaSyncNotice,
  type SchemaSyncPhase,
  type SchemaSyncStatus,
} from "./use-schema-sync-status";

function notice(
  phase: SchemaSyncPhase,
  detail: string | null = null,
  canPush = false,
): ReturnType<typeof schemaSyncNotice> {
  const status: SchemaSyncStatus = { phase, detail, canPush };
  return schemaSyncNotice(status);
}

describe("schemaSyncNotice", () => {
  it("ready / unknown 不占位（状态栏不该常驻一个「一切正常」的格子）", () => {
    expect(notice("ready")).toBeNull();
    expect(notice("unknown")).toBeNull();
  });

  it("syncing 让它等，不是错误色、不可点", () => {
    const n = notice("syncing");
    expect(n?.tone).toBe("info");
    expect(n?.text).toContain("同步中");
    expect(n?.refreshable).toBe(false);
    expect(n?.actionable).toBe(false);
  });

  it("synced 是一次性事件：给的是「点此刷新」", () => {
    const n = notice("synced");
    expect(n?.tone).toBe("ok");
    expect(n?.text).toContain("刷新");
    expect(n?.refreshable).toBe(true);
    expect(n?.actionable).toBe(false);
  });

  it("missing / stale 给出口而不是安慰（规范 §9.2 第 3 条）", () => {
    /* SAFETY: 类型断言已复核 */
    for (const phase of ["missing", "stale"] as const) {
      const n = notice(phase);
      expect(n?.tone).toBe("error");
      expect(n?.refreshable).toBe(false);
    }
    /* 两档要能区分：一个是「还没建」，一个是「过期了」，处理方式不同。 */
    expect(notice("missing")?.text).not.toBe(notice("stale")?.text);
  });

  it("本机有执行件（canPush）→ 给「立即同步」按钮，文案不再复述命令", () => {
    /* SAFETY: 类型断言已复核 */
    for (const phase of ["missing", "stale"] as const) {
      const n = notice(phase, null, true);
      expect(n?.actionable).toBe(true);
      expect(n?.text).not.toContain("pnpm db:push");
      /* 按钮文案仍然要能说清「哪一档」（用户在弹窗里要读到原因）。 */
      expect(n?.text).toBe(phase === "missing" ? "数据库表还没建" : "数据库结构过期");
    }
  });

  it("没有执行件（桌包）→ 回落成「跑 pnpm db:push」的纯提示，不给死按钮", () => {
    /* SAFETY: 类型断言已复核 */
    for (const phase of ["missing", "stale"] as const) {
      const n = notice(phase, null, false);
      expect(n?.actionable).toBe(false);
      expect(n?.text).toContain("pnpm db:push");
    }
  });

  it("原因透进 tooltip（否则用户只知道「不一致」、不知道哪条语句）", () => {
    expect(notice("stale", "含「会丢数据」的语句 2 条")?.title).toContain("会丢数据");
  });
});
