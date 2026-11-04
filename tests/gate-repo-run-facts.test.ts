/**
 * 门禁夹具的**读数契约**（ISSUE #2405）：`run()` 交出五件；两类失败不许折成一件 —— 常见抄法 `execFileSync` 套 `try/catch` 压成 `{ ok }`，
 * 于是「判出越界 / 判据没跑起来 / spawn 失败」逐字同形（PR #2404 分辨不出来）。口径：非 0 且非 spawn ⇒ output 合两流；
 * 退 0 ⇒ 只 stdout；取不到脚本 ⇒ 同码但 ran=false、spawnError 可自证；`expectGateRan()` 只在最后一格抛（§13.6.4）。
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
  while (handles.length > 0) {
    handles.pop()?.dispose();
  }
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
    expect(() => {
      expectGateRan(notRan.run());
    }).toThrow(/没跑起来/);

    const red = repoWith(
      'process.stderr.write("ONLY-ON-STDERR 越界站点\\n"); process.exitCode = 1;\n',
    );
    expect(() => {
      expectGateRan(red.run());
    }).not.toThrow();
  });
});
