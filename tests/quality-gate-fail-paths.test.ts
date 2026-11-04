/**
 * `quality-gate.mjs` 失败路径的判据（ISSUE #2588）：四条路径曾调用未声明的 `fail()`，真跑进去抛
 * `ReferenceError`（方向对、失败原因为空，运行期踩不到，只有脚本档 typecheck 抓到）。这里走**未知
 * 门禁**钉「红话 + 退出码 2、无 ReferenceError」，其余三站由 typecheck 棘轮（TS2304 4→0）管。
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";

const GATE = path.resolve(__dirname, "../scripts/quality-gate.mjs");

describe("quality-gate 失败路径（ISSUE #2588）", () => {
  it("未知门禁（--mode）⇒ 红话点名可选值并退 2，不是 ReferenceError", () => {
    const r = spawnSync(process.execPath, [GATE, "--mode", "definitely-not-a-gate"], {
      encoding: "utf8",
      windowsHide: true,
      timeout: 60_000,
    });
    // oxlint-disable-next-line typescript/no-unnecessary-condition -- spawnSync 起不来时 stdout/stderr 实测为 undefined，@types/node 按非空标，空串兜底保留
    const out = `${r.stdout ?? ""}${r.stderr ?? ""}`;
    expect(out).toContain("未知门禁：definitely-not-a-gate");
    expect(out).toContain("all");
    expect(out).not.toContain("ReferenceError");
    expect(r.status).toBe(2);
  });

  /**
   * 红落在**哪一条流**（ISSUE #2653）：分流只有一处实现（`emitVerdict()` 按 `state` 选流，判决行 +
   * 段头 + 出路同一条流），钉住这处即覆盖五个站点。用途是「从一屏绿里被 `2>` 单独捞出来」，故两条
   * 流都断：stderr 必须在、stdout 必须不在（只断前者，红行同时在两条流也算过）。
   */
  it("红的判决行走 stderr、不留在 stdout（`2>` 捞出来的那一屏要完整）", () => {
    const r = spawnSync(process.execPath, [GATE, "--mode", "definitely-not-a-gate"], {
      encoding: "utf8",
      windowsHide: true,
      timeout: 60_000,
    });
    // oxlint-disable-next-line typescript/no-unnecessary-condition -- spawnSync 起不来时 stdout/stderr 实测为 undefined，@types/node 按非空标，空串兜底保留
    expect(r.status, `${r.stdout ?? ""}${r.stderr ?? ""}`).toBe(2);
    expect(r.stderr).toContain("[红] quality-gate（未知门禁：definitely-not-a-gate");
    // oxlint-disable-next-line typescript/no-unnecessary-condition -- spawnSync 起不来时 stdout/stderr 实测为 undefined，@types/node 按非空标，空串兜底保留
    expect(r.stdout ?? "").not.toContain("[红]");
  });

  /**
   * `--mode=<值>` 这一族（ISSUE #2709）：原 `parseArgs` 只匹配 `"--mode"`，等号形式落不进任何分支、
   * `mode` 保持初值 `"all"` ⇒ **以为在重跑一档，实际跑完整套默认档**（实测 10 分钟）。故断的不是
   * 有没有那句中文，而是「**一档都没跑**」：`一键门禁` 小结行不出现即是证据。
   */
  it("--mode=<不存在的档名> ⇒ 退 2 走未知门禁，且不跑任何一档（旧形态是静默全量）", () => {
    const r = spawnSync(process.execPath, [GATE, "--mode=definitely-not-a-gate"], {
      encoding: "utf8",
      windowsHide: true,
      timeout: 60_000,
    });
    // oxlint-disable-next-line typescript/no-unnecessary-condition -- spawnSync 起不来时 stdout/stderr 实测为 undefined，@types/node 按非空标，空串兜底保留
    const out = `${r.stdout ?? ""}${r.stderr ?? ""}`;
    expect(r.status, out).toBe(2);
    expect(out).toContain("未知门禁：definitely-not-a-gate");
    expect(out).not.toContain("一键门禁");
  });

  it("不认识的参数（含提了 `--mode` 没给值）⇒ 退 2 并念出认识的形态，一档都不跑", () => {
    for (const arg of ["--nonsense", "--mode"]) {
      const r = spawnSync(process.execPath, [GATE, arg], {
        encoding: "utf8",
        windowsHide: true,
        timeout: 60_000,
      });
      // oxlint-disable-next-line typescript/no-unnecessary-condition -- spawnSync 起不来时 stdout/stderr 实测为 undefined，@types/node 按非空标，空串兜底保留
      const out = `${r.stdout ?? ""}${r.stderr ?? ""}`;
      expect(r.status, `${arg} ⇒ ${out}`).toBe(2);
      expect(out).toContain("不认识的参数：");
      expect(out).toContain("--mode=<档名>");
      /* 「没提要求」在这份入口里意味着最重的一档 —— 缺值不许被读成它 */
      expect(out).not.toContain("一键门禁");
    }
  });
});
