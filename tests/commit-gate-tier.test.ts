/**
 * 档位这一刀的判据（ISSUE #2022 / 规范 §13.5.25）。
 *
 * 要挡的失效形态很具体：把「重档不在每次提交上跑」做成**把步骤从钩子里删掉**。那样
 * `check-gate-executors.cjs`（它按文本解析钩子的 `run` 行、`quality-gate.mjs` 的 gate 表、
 * `quality-gate.ps1` 的 `$Blocks` —— **`.cnb.yml` 不在它的解析面上**）会立刻失去那批
 * 判据的出处，而账面上一条红都不会出现：步骤没了 ⇒ 「没有档要找执行者」⇒ 绿。
 * 所以这里钉的不是「跑得快」，是**注册表还在、且真的有人跑它**。
 *
 * 三条方向各一：① 注册表总数与本地档边界（挪档不许减清单）；② 跳档必须被说出来
 * （否则一次「只跑了 D0」的绿会被读成「全套过了」）；③ CI 那一档读的是同一份注册表。
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";

import { describe, expect, it } from "vitest";

import {
  localTierLabels,
  readHookSteps,
} from "../scripts/base-check/hook-steps.mjs";
import { fullTreeArgv, main as heavyMain } from "../scripts/ci-heavy-gates.mjs";

const ROOT = path.resolve(__dirname, "..");
const HOOK = path.join(ROOT, ".githooks", "pre-commit");
const hookText = readFileSync(HOOK, "utf8");

describe("档位：注册表与边界", () => {
  it("注册表总数一条不少（52 条 = D0 那 15 + D 那 37）—— 降档不是删步骤", () => {
    const all = readHookSteps();
    expect(all.length).toBe(52);
    expect(localTierLabels().size).toBe(15);
    // 边界取错的话，本地档会变成「恰好少一条」这类静默漂移 ⇒ 与总数一起钉。
    expect([...localTierLabels()]).toEqual(
      all.slice(0, 15).map((s) => s.label),
    );
  });

  it("本地档的标签全部落在注册表里（取法与注册表同源，不另立名单）", () => {
    const labels = new Set(readHookSteps().map((s) => s.label));
    const missing = [...localTierLabels()].filter((l) => !labels.has(l));
    expect(missing).toEqual([]);
  });
});

describe("档位：跳过必须被说出来", () => {
  it("钩子里同时在场：档位哨兵、跳过标记、收尾点名", () => {
    /* 只断言「跑了什么」不够 —— 这一档的全部风险在**没跑的那几条有没有被承认**。
     * 三样缺一样都会出现同一种假绿：跳了但没人说（哨兵缺）、说了但退出码当绿
     * （收尾缺）、跑了但结论不落账（skip 标记缺）。 */
    expect(hookText).toContain("COMFY_HEAVY_GATES");
    expect(hookText).toContain("$LOGD/$id.skip");
    expect(hookText).toMatch(/本次提交本地\*\*没跑\*\*：组/);
  });

  it("四组重档仍然以 run_group 形态在场（A/B/C/D 一条都没被搬走）", () => {
    for (const id of ["A", "B", "C", "D"]) {
      expect(hookText).toMatch(new RegExp("^run_group " + id + " ", "m"));
    }
  });

  it("pre-push 不再背受影响用例：那一段 2026-10-20 撤了，执行者换成平台那一格", () => {
    /* 沿革（别读混）：`unitTests` 段 2026-10-19 从 pre-commit 的 C 组搬到 pre-push，
     * 2026-10-20 又整体撤掉 —— 本地这一跳在共享机上的失效形态是 forks worker 调度
     * 超时而不是用例红（实测拦下一次、隔离复跑 88 文件 1116 条全绿），增量档自此
     * 由 `.cnb.yml` 的 `受影响用例` 一格执行。
     * 这里钉两件：① premerge 段表里**没有** `unitTests`（留一段恒跳过会让 `--json`
     * 的读数里永远有一格「没跑起来」，而那一格不构成证据，§13.6.2）；② 新执行者的
     * 三个事实都在场（GATES 里有名字、跑法脚本走同一条判决链、改动面经 env 传入）。 */
    const src = readFileSync(
      path.join(ROOT, "scripts/premerge-check.mjs"),
      "utf8",
    );
    expect(src).not.toContain("unitTests:");
    expect(src).not.toContain('kind: "changed"');
    // `base` 段仍读钩子注册表（localTierLabels），`--light` 那一档的跳过条数照旧要说出来。
    expect(src).toContain("localTierLabels");
    expect(src).toContain("--light");

    const ci = readFileSync(
      path.join(ROOT, "scripts/ci-affected-tests.mjs"),
      "utf8",
    );
    // 同一条判决链：跑法脚本起的是 run-affected-tests.mjs，改动面经 env 递进去。
    expect(ci).toContain("run-affected-tests.mjs");
    expect(ci).toContain("COMFY_AFFECTED_CHANGED");
    // 并发按 §13.5.21 的唯一出处收敛，不在这里另写一个数。
    expect(ci).toContain("resolveCiWorkers");

    const cnb = readFileSync(path.join(ROOT, ".cnb.yml"), "utf8");
    expect(cnb).toContain("- name: 受影响用例");
    expect(cnb).toContain("类型检查, 受影响用例,");
    // 拿不到改动面 / 清单为空必须退 2（没判 ≠ 绿）。
    expect(ci).toMatch(/files\.length === 0[\s\S]{0,400}return 2/);
  });

  /**
   * `COMFY_AFFECTED_CHANGED` 这条通道要**真的**换掉改动面，不是被读进去又丢掉。
   *
   * 用 `--dry-run`：只走「筛清单 + 规划启动」那一半，不起 vitest，所以既快又不抢机器。
   * 两个方向都判 —— 只判「给了清单会打印份数」的话，把 env 当空气、永远按暂存区筛也照样过。
   */
  it("改动面从 env 传进来 ⇒ 走的还是同一条判决链", () => {
    const countOf = (out: string) => Number(/(\d+) 个用例/.exec(out)?.[1] ?? 0);
    const runLauncher = (changed: string) => {
      const r = spawnSync(
        process.execPath,
        [path.join(ROOT, "scripts", "run-affected-tests.mjs"), "--dry-run"],
        {
          cwd: ROOT,
          encoding: "utf8",
          env: { ...process.env, COMFY_AFFECTED_CHANGED: changed },
        },
      );
      expect(r.status, r.stderr ?? "").toBe(0);
      return `${r.stdout}\n${r.stderr}`;
    };
    const docsOnly = runLauncher("docs/README.md");
    expect(docsOnly).toMatch(/\d+ 个用例 \/ \d+ 次启动/);
    // 改一份被大量用例真实 import 的源文件（`src/lib/endpoints.ts` —— 默认地址与端口的
    // 唯一出处，硬规则 20），面必须**严格大于**只改文档那一档：相等就说明 env 根本没进
    // 判决链，只是被读了个名字。
    expect(countOf(runLauncher("src/lib/endpoints.ts"))).toBeGreaterThan(
      countOf(docsOnly),
    );
  });
});

describe("CI 那一格：读同一份注册表，且三态分得开", () => {
  it("重档 runner 不抄清单（它 import 的就是钩子那份注册表）", () => {
    const src = readFileSync(
      path.join(ROOT, "scripts/ci-heavy-gates.mjs"),
      "utf8",
    );
    expect(src).toContain("readHookSteps");
    expect(src).not.toMatch(/const GATES = \[/);
  });

  it("`--staged` 一律剥掉：CI 没有暂存区，留着它就是一条恒绿", () => {
    expect(fullTreeArgv(["node", "scripts/check-x.cjs", "--staged"])).toEqual([
      "node",
      "scripts/check-x.cjs",
    ]);
    // 别的参数一个都不动 —— 改一个参数就是改判据。
    expect(fullTreeArgv(["node", "a.cjs", "--strict", "--staged"])).toEqual([
      "node",
      "a.cjs",
      "--strict",
    ]);
  });

  it("注册表读不出来 ⇒ 退 2（「没跑起来」），不许退 0 冒充「没有档要跑」", () => {
    const lines: string[] = [];
    const code = heavyMain({
      cwd: process.env.TEMP ?? "/tmp",
      argv: [],
      log: (l) => lines.push(l),
    });
    expect(code).toBe(2);
    expect(lines.join("\n")).toContain("不构成证据");
  });
});
