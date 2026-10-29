/**
 * `quality-gate.mjs` 失败路径的判据（ISSUE #2588）。
 *
 * 四条失败路径此前调用一个**从未声明过**的 `fail()`：真跑进去时抛
 * `ReferenceError: fail is not defined` —— 结论方向没错（非零退出），
 * 但失败原因那一格是空的，而且运行期没人踩过（要 pnpm 取不到 / lockfile
 * 漂移才进得去），所以只有 #2524 的脚本档 typecheck 能抓到它。
 * 这里钉住「失败路径说出的是那句中文，不是一个栈」：
 * 走**未知门禁**这一站（唯一不依赖环境前提、可在测试里真触发的站点），
 * 断言读到的是红话 + 退出码 2，且没有 ReferenceError。
 * 其余三站的「名字已声明」由脚本档 typecheck 的棘轮管着（TS2304 已 4 → 0，
 * 只降不升）—— 两层合起来，这一族「失败路径在场、触发条件不在场」的形态
 * 再也混不进来。
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";

const GATE = path.resolve(__dirname, "../scripts/quality-gate.mjs");

describe("quality-gate 失败路径（ISSUE #2588）", () => {
  it("未知门禁（--mode）⇒ 红话点名可选值并退 2，不是 ReferenceError", () => {
    const r = spawnSync(
      process.execPath,
      [GATE, "--mode", "definitely-not-a-gate"],
      {
        encoding: "utf8",
        windowsHide: true,
        timeout: 60_000,
      },
    );
    const out = `${r.stdout ?? ""}${r.stderr ?? ""}`;
    expect(out).toContain("未知门禁：definitely-not-a-gate");
    expect(out).toContain("all");
    expect(out).not.toContain("ReferenceError");
    expect(r.status).toBe(2);
  });
});
