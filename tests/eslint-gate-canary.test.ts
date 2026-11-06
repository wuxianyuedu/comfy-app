/**
 * `eslint-gate-canary.mjs` 判据 = lint 档位**阳性对照**（ISSUE #2541 三批之后补闸，#2777 PR-B 起由 oxlint 承担）：
 * #2541 是「空集意义上的 0 警」，当时 core 面规则上报 0 却从未跑过；三批后 0 警仍是**状态**而非能力（规则没生效 /
 * 配置顺序反 / `files` 面收窄，见 #2614）。故造已知违例真跑 oxlint 断言命中；`--sabotage` 在守规则必须退 1。
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(import.meta.dirname, "..");
const CANARY = "scripts/eslint-gate-canary.mjs";

/* 120s 的依据（实测，不是拍的）：判据起 **oxlint 子进程**，判决配置与 jsPlugin 加载是大头；⚠️ 并发在场时
 * 这些数不可引用（同文件在「受影响用例」格被挤着跑会显著变慢），只能判「谁在最前」。
 * 这是 canary 支持 `--sabotage` 最小集的原因：把调用次数压到最低（全档 1 次，同族教训见 #2606）。 */
const CASE_TIMEOUT = 120_000;

function runCanary(args: Array<string> = []) {
  return spawnSync(process.execPath, [CANARY, ...args], {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
}

/** 这一趟起了几次 oxlint（脚本把它打在读数里，就是为了能被这样断言）。 */
function oxlintCalls(text: string): number {
  return Number(/oxlint 调用 (?<count>\d+) 次/.exec(text)?.groups?.count ?? "-1");
}

describe("scripts/eslint-gate-canary.mjs", () => {
  it(
    "本仓开着的那几条规则真的会拦下违例（全仓 0 警 ≠ 闸在工作）",
    () => {
      const r = runCanary();
      // oxlint-disable-next-line typescript/no-unnecessary-condition -- spawnSync 起不来时 stdout/stderr 实测为 undefined，@types/node 按非空标，空串兜底保留
      expect(r.status, `stdout=${r.stdout ?? ""}\nstderr=${r.stderr ?? ""}`).toBe(0);
      // oxlint-disable-next-line typescript/no-unnecessary-condition -- spawnSync 起不来时 stdout/stderr 实测为 undefined，@types/node 按非空标，空串兜底保留
      const n = Number(/samples=(?<samples>\d+)/.exec(r.stdout ?? "")?.groups?.samples ?? "0");
      // 样本被删空却还退 0，是这条判据自己的失效形态（恒绿）
      // oxlint-disable-next-line typescript/no-unnecessary-condition -- spawnSync 起不来时 stdout/stderr 实测为 undefined，@types/node 按非空标，空串兜底保留
      expect(n, `样本数不达标，实际：${r.stdout ?? ""}`).toBeGreaterThanOrEqual(10);
      /* 两批文件（tests 面与 scripts 面）必须在**同一次** oxlint 调用里判完
       * （ISSUE #2862：这一格的墙钟几乎全是加载次数）。
       * 拆回两次调用，功能断言一条都不会红 —— 所以次数要由这里钉住。 */
      // oxlint-disable-next-line typescript/no-unnecessary-condition -- spawnSync 起不来时 stdout/stderr 实测为 undefined，@types/node 按非空标，空串兜底保留
      expect(oxlintCalls(r.stdout ?? ""), `实际：${r.stdout ?? ""}`).toBe(1);
    },
    CASE_TIMEOUT,
  );

  it(
    "闸会红：临时关掉一条在守的规则 ⇒ 必须非零退出（恒绿的对照不是对照）",
    () => {
      const r = runCanary(["--sabotage", "unicorn/no-new-array"]);
      // oxlint-disable-next-line typescript/no-unnecessary-condition -- spawnSync 起不来时 stdout/stderr 实测为 undefined，@types/node 按非空标，空串兜底保留
      expect(r.status, `stdout=${r.stdout ?? ""}\nstderr=${r.stderr ?? ""}`).toBe(1);
      // oxlint-disable-next-line typescript/no-unnecessary-condition -- spawnSync 起不来时 stdout/stderr 实测为 undefined，@types/node 按非空标，空串兜底保留
      expect(`${r.stderr ?? ""}${r.stdout ?? ""}`).toContain("unicorn/no-new-array");
      // 失败路径也要报得出次数（红的时候读不到它，就等于这一格没有这一项读数）。
      // oxlint-disable-next-line typescript/no-unnecessary-condition -- spawnSync 起不来时 stdout/stderr 实测为 undefined，@types/node 按非空标，空串兜底保留
      expect(oxlintCalls(`${r.stderr ?? ""}${r.stdout ?? ""}`)).toBe(1);
    },
    CASE_TIMEOUT,
  );

  it(
    "闸门不误伤：关掉一条不相干的规则 ⇒ 其余对照照旧命中（退 0）",
    () => {
      const r = runCanary(["--sabotage", "no-console"]);
      // oxlint-disable-next-line typescript/no-unnecessary-condition -- spawnSync 起不来时 stdout/stderr 实测为 undefined，@types/node 按非空标，空串兜底保留
      expect(r.status, `stdout=${r.stdout ?? ""}\nstderr=${r.stderr ?? ""}`).toBe(0);
      // oxlint-disable-next-line typescript/no-unnecessary-condition -- spawnSync 起不来时 stdout/stderr 实测为 undefined，@types/node 按非空标，空串兜底保留
      expect(oxlintCalls(r.stdout ?? "")).toBe(1);
    },
    CASE_TIMEOUT,
  );
});
