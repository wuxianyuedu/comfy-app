/**
 * `schemaSyncNotice` 的判据 —— 状态栏那一格说什么、什么时候什么都不说。
 *
 * 为什么值得单测：这四种相位里有两种是「**不要**打扰用户」（`ready` / `unknown`），
 * 两种是「必须说，而且要给命令」（`missing` / `stale`）—— 把 `ready` 显示成
 * 「一切正常」或者把 `stale` 只说成「出错了」，都是那种只有用户会碰到的错。
 */
import { describe, expect, it } from "vitest";

import {
  schemaSyncNotice,
  type SchemaSyncPhase,
} from "./use-schema-sync-status";

function notice(phase: SchemaSyncPhase, detail: string | null = null) {
  return schemaSyncNotice({ phase, detail });
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
  });

  it("synced 是一次性事件：给的是「点此刷新」", () => {
    const n = notice("synced");
    expect(n?.tone).toBe("ok");
    expect(n?.text).toContain("刷新");
    expect(n?.refreshable).toBe(true);
  });

  it("missing / stale 给命令而不是安慰（规范 §9.2 第 3 条）", () => {
    for (const phase of ["missing", "stale"] as const) {
      const n = notice(phase);
      expect(n?.tone).toBe("error");
      expect(n?.text).toContain("pnpm db:push");
      expect(n?.refreshable).toBe(false);
    }
    /* 两档要能区分：一个是「还没建」，一个是「过期了」，处理方式不同。 */
    expect(notice("missing")?.text).not.toBe(notice("stale")?.text);
  });

  it("原因透进 tooltip（否则用户只知道「不一致」、不知道哪条语句）", () => {
    expect(notice("stale", "含「会丢数据」的语句 2 条")?.title).toContain(
      "会丢数据",
    );
  });
});
