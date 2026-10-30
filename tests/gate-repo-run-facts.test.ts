/**
 * 门禁夹具的**读数契约**：`run()` 交出五件，且不许把两类失败折成一件（ISSUE #2405）。
 *
 * 立案现场：本仓 17 份门禁自测各自手抄了一遍「搭临时仓库 + 跑真判据」那四件套，
 * 抄到第十五遍时折叠方式开始分叉 —— 常见的那一份是
 * `execFileSync` 包 `try/catch`，把结果压成 `{ ok: boolean, output }`。
 * 于是三类**下一动作完全不同**的失败在账面上逐字同形：
 *   ① 判据跑完了、**判出越界**（退 1，这才是被测行为）；
 *   ② 判据**根本没跑起来**：夹具少带一个依赖 ⇒ node 报 `Cannot find module`，
 *      退的**也是 1**；`ENOBUFS`（输出超 `maxBuffer`）/ 被子进程信号杀 ⇒ `status` 是 `null`；
 *   ③ spawn 层就没起来（`ENOENT`：node 自身不在）。
 * `expect(ok).toBe(false)` 在②上**照样绿**，`expect(ok).toBe(true)` 在②上红成
 * 「门禁拦了本该放行的形状」—— PR #2404 的 `受影响用例` 那一格就是这个形状
 * （页面上只剩 `expected false to be true`；那次究竟属于哪一类，当时**分辨不出来**）。
 *
 * 所以这里钉的是**量具自己**的四条口径（不放任意一份被测文件里 —— 量具的契约散在
 * 消费者中间，正是第十五份抄错时没人响的那个形状）：
 *   ① 退出码非 0 且**不是** spawn 错误 ⇒ `output` 仍合并两条流（违规原文常在 stderr）；
 *   ② 退出码 0 ⇒ `output` 只有 stdout（这上面有三十多份消费者的断言，读法不许漂）；
 *   ③ 脚本取不到 ⇒ `status` 与①逐字同码，但 `ran` 是 `false`，且
 *      `spawnError` / `signal` 能自证「不是被杀、不是 spawn 失败」；
 *   ④ `expectGateRan()` 只在③那一格抛，在①那一格不抛 —— 两半都要有执行者，
 *      否则「把两边一起判掉」这种改法看不出来（§13.6.4：拿不到测量 ≠ 测量结果是红的）。
 */
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createGateRepo,
  expectGateRan,
  type GateRepo,
  type GateRepoHandle,
} from "./helpers/gate-repo";

/**
 * 种子脚本用哪一份**与本契约无关** —— 每条用例立刻把工作区里那份换掉，
 * 子进程的行为完全由用例给定（受控才能把「两条流各有什么」钉成逐字读数）。
 */
const SCRIPT_REL = "scripts/check-test-it-each.cjs";

const handles: Array<GateRepoHandle> = [];
afterEach(() => {
  while (handles.length > 0) handles.pop()?.dispose();
});

/** 建一个工作区（`afterEach` 收尾），并把那份脚本换成用例指定的子进程源码。 */
function repoWith(source: string): GateRepo {
  const handle = createGateRepo({
    script: path.basename(SCRIPT_REL),
    dirs: ["src"],
    workdir: "gate-repo-run-facts",
  });
  handles.push(handle);
  handle.repo.write(SCRIPT_REL, source);
  return handle.repo;
}

describe("夹具读数：两条流与退出码", () => {
  it("① 退 1 且违规原文只在 stderr ⇒ output 仍含 stderr（丢了它就是最重的一类事故）", () => {
    /* `exitCode` 而不是 `process.exit()`：stderr 在 POSIX 上是**异步**的，
       显式 exit 会把这条写截掉 —— 那正好把本用例要判的那一格变成不可信读数。 */
    const repo = repoWith(
      'process.stderr.write("ONLY-ON-STDERR 越界站点\\n"); process.exitCode = 1;\n',
    );
    const r = repo.run();
    expect(r.code, r.output).toBe(1);
    expect(r.status, r.output).toBe(1);
    expect(r.ran, r.output).toBe(true);
    expect(r.output).toContain("ONLY-ON-STDERR");
  });

  it("② 退 0 且两条流都有内容 ⇒ output 只有 stdout（消费者的读法逐字未变）", () => {
    const repo = repoWith(
      'process.stdout.write("ON-STDOUT-结论\\n"); process.stderr.write("ON-STDERR-噪声\\n");\n',
    );
    const r = repo.run();
    expect(r.code, r.output).toBe(0);
    expect(r.ran, r.output).toBe(true);
    expect(r.output).toContain("ON-STDOUT-结论");
    expect(r.output).not.toContain("ON-STDERR-噪声");
  });
});

describe("夹具读数：「没跑起来」与「判红」不许同形", () => {
  it("③ 脚本取不到 ⇒ 退出码同样是 1，但这一格 ran=false（不构成判决，不是判据红）", () => {
    const repo = repoWith("process.exitCode = 0;\n");
    repo.remove(SCRIPT_REL);
    const r = repo.run();
    /* 先钉「为什么只看退出码不够」：这一格的 `code` 与上面 ① 那一格逐字相同。 */
    expect(r.code, r.output).toBe(1);
    expect(r.status, r.output).toBe(1);
    expect(r.ran, r.output).toBe(false);
    expect(r.output).toContain("Cannot find module");
    expect(r.spawnError, `spawn 层没有错误，收到 ${String(r.spawnError)}`).toBeNull();
    expect(r.signal, `不该是被信号杀，收到 ${String(r.signal)}`).toBeNull();
  });

  it("④ expectGateRan 只在这一格抛，真判红那一格不抛 ⇒ 两半没被同一条规则一起判掉", () => {
    const notRan = repoWith("process.exitCode = 0;\n");
    notRan.remove(SCRIPT_REL);
    expect(() => expectGateRan(notRan.run())).toThrow(/没跑起来/);

    const red = repoWith(
      'process.stderr.write("ONLY-ON-STDERR 越界站点\\n"); process.exitCode = 1;\n',
    );
    expect(() => expectGateRan(red.run())).not.toThrow();
  });
});
