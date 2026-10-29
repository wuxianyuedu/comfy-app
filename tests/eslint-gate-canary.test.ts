/**
 * `scripts/eslint-gate-canary.mjs` 的判据 —— eslint 档位的**阳性对照**
 * （ISSUE #2541 三批之后的补闸）。
 *
 * ── 为什么需要这一条 ──────────────────────────────────────────────────────
 *
 * #2541 的本质是「空集意义上的 0 警」：tseslint 的 recommended 不含 core 面，
 * 于是 `no-control-regex` / `no-useless-assignment` / `preserve-caught-error`
 * 报了 0 条 —— 而它们**一条都没跑过**。三批之后（#2583 / #2585 / #2596）全仓
 * 又回到 0 警，但「0 警」仍然是**状态**而不是**能力**：它可能来自规则没生效、
 * 配置顺序被改反（`js.configs.recommended` 必须在前、接管的 off 块在后）、
 * 或者 `files` 面收窄到把被测目录漏掉（`.storybook` 就是那一类，见 #2614）。
 *
 * 所以这里钉的是「**违规会被拦下**」：造已知违例 → 真跑一次 eslint →
 * 断言目标规则命中；再放干净样本做反向对照（闸若过宽，干净样本也会红）。
 *
 * ── 为什么进固定清单 ──────────────────────────────────────────────────────
 *
 * 触发它的改动面是「有人动 `eslint.config.js`」—— 而这条判据自己住在 `tests/`，
 * 配置住在仓库根，import 图追不到；更关键的是那种改动**往往正是为了关掉某条
 * 规则**（加白名单 / 收 files 面），此时「只在受影响时才跑」会把它自己排除在外。
 * 与 `tests/spawn-shell-scan.test.ts`（同一个方法论：改完静态闸要补阳性对照）
 * 同因，登记进 `scripts/fixed-structural-tests.mjs`。
 *
 * ── 三条用例各自防什么 ────────────────────────────────────────────────────
 *
 *  1. 默认跑：退 0 且样本数达标 —— 「守着的那几条都在」；
 *  2. `--sabotage` 一条在守的规则：**必须退 1** —— 恒绿的对照等于没有对照
 *     （这条是**这一格自己的阳性对照**，与 ISSUE #2562 缺口 1 同一条方法论）；
 *  3. `--sabotage` 一条不相干的规则：仍退 0 —— 闸门不误伤（否则第 2 条只要
 *      `--sabotage` 任何东西都红，它就退化成「跑得起来就红」的假对照）。
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(import.meta.dirname, "..");
const CANARY = "scripts/eslint-gate-canary.mjs";

/* 超时给到 600s 的依据（实测，不是拍的）：这条判据起的是 **eslint 子进程**，
 * 单次调用的 project service 冷启动才是开销大头 —— 本沙箱单跑一次 ~24s，
 * 于是默认那条（2 次调用）单跑 48s；而 4 个测试文件**并发**跑时它被拖到
 * 398s（争抢下的极端值，CI 上快数倍）。沙箱与共享机都要留得住，故 600s。
 * 这也是为什么 canary 支持 `--sabotage` 最小集：把调用次数从 6 压到 4，
 * 不给「受影响用例」格再添一个重夹具（同族教训见 ISSUE #2606）。 */
const CASE_TIMEOUT = 600_000;

function runCanary(args: string[] = []) {
  return spawnSync(process.execPath, [CANARY, ...args], {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
}

describe("scripts/eslint-gate-canary.mjs", () => {
  it("本仓开着的那几条规则真的会拦下违例（全仓 0 警 ≠ 闸在工作）", () => {
    const r = runCanary();
    expect(r.status, `stdout=${r.stdout ?? ""}\nstderr=${r.stderr ?? ""}`).toBe(0);
    const n = Number(/samples=(\d+)/.exec(r.stdout ?? "")?.[1] ?? "0");
    // 样本被删空却还退 0，是这条判据自己的失效形态（恒绿）
    expect(n, `样本数不达标，实际：${r.stdout ?? ""}`).toBeGreaterThanOrEqual(11);
  }, CASE_TIMEOUT);

  it("闸会红：临时关掉一条在守的规则 ⇒ 必须非零退出（恒绿的对照不是对照）", () => {
    const r = runCanary(["--sabotage", "unicorn/no-new-array"]);
    expect(r.status, `stdout=${r.stdout ?? ""}\nstderr=${r.stderr ?? ""}`).toBe(1);
    expect(`${r.stderr ?? ""}${r.stdout ?? ""}`).toContain("unicorn/no-new-array");
  }, CASE_TIMEOUT);

  it("闸门不误伤：关掉一条不相干的规则 ⇒ 其余对照照旧命中（退 0）", () => {
    const r = runCanary(["--sabotage", "no-console"]);
    expect(r.status, `stdout=${r.stdout ?? ""}\nstderr=${r.stderr ?? ""}`).toBe(0);
  }, CASE_TIMEOUT);
});
