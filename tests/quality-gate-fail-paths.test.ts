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
 *
 * 第二格判的是**流别**（ISSUE #2653）：#2588 把 `fail()` 补上时取了「形状收进
 * `renderVerdict()`」那一半、流别按调用点原本的 `console.log` 保留，于是同文件里
 * 「红走哪条流」有两份答案，失败路径与整轮小结的红行都留在 stdout。
 *
 * 第三、四格是 #2709：`--mode` 只认空格形式，等号形式与缺值都被读成「没提要求」，
 * 而「没提要求」= 跑完整套默认档。它们判的是**有没有开始跑**，不是有没有那句中文。
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

  /**
   * 红落在**哪一条流**（ISSUE #2653）。
   *
   * 上面那一格把两条流拼在一起断「那句中文在场」—— 对本次缺陷天然无感：红行整个在
   * stdout 时它照样绿。本文件里的分流只有一处实现（`emitVerdict()` 按 `state` 选流，
   * 判决行 + 段头 + 出路同一条流），所以钉住这一处 = 钉住五个站点；
   * 整轮小结那三行走的是同一处，不必（也没法在不造环境故障的前提下）另起一跑。
   *
   * 「从一屏绿里被 `2>` 单独捞出来」是这句口径的全部用途 —— 所以两条流都要断：
   * stderr 里必须在，**stdout 里必须不在**（只断前者，红行同时出现在两条流也算过）。
   */
  it("红的判决行走 stderr、不留在 stdout（`2>` 捞出来的那一屏要完整）", () => {
    const r = spawnSync(
      process.execPath,
      [GATE, "--mode", "definitely-not-a-gate"],
      {
        encoding: "utf8",
        windowsHide: true,
        timeout: 60_000,
      },
    );
    expect(r.status, `${r.stdout ?? ""}${r.stderr ?? ""}`).toBe(2);
    expect(r.stderr).toContain(
      "[红] quality-gate（未知门禁：definitely-not-a-gate",
    );
    expect(r.stdout ?? "").not.toContain("[红]");
  });

  /**
   * `--mode=<值>` 这一族（ISSUE #2709）。
   *
   * 现场：原 `parseArgs` 只匹配 `argv[i] === "--mode"`，等号形式落不进任何分支、
   * 而循环对不认识的参数一个字都不做 ⇒ `mode` 保持初值 `"all"` ⇒
   * **以为在重跑一档，实际把整套默认档跑完**（含 `vitest --coverage`，
   * 实测 10 分钟 / 1209 行被我停掉）。所以这两格断的不是「有没有那句中文」，
   * 而是「**一档都没跑**」：整轮小结那一行（`一键门禁`）在任何一档都没跑时不会出现，
   * 它在不在，就是这个入口有没有真的开始跑的行为证据。
   */
  it("--mode=<不存在的档名> ⇒ 退 2 走未知门禁，且不跑任何一档（旧形态是静默全量）", () => {
    const r = spawnSync(
      process.execPath,
      [GATE, "--mode=definitely-not-a-gate"],
      { encoding: "utf8", windowsHide: true, timeout: 60_000 },
    );
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
      const out = `${r.stdout ?? ""}${r.stderr ?? ""}`;
      expect(r.status, `${arg} ⇒ ${out}`).toBe(2);
      expect(out).toContain("不认识的参数：");
      expect(out).toContain("--mode=<档名>");
      /* 「没提要求」在这份入口里意味着最重的一档 —— 缺值不许被读成它 */
      expect(out).not.toContain("一键门禁");
    }
  });
});
