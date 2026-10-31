/**
 * 档位这一刀的判据（ISSUE #2022 / 规范 §13.5.25）。
 *
 * 要挡的失效形态很具体：把「重档不在每次提交上跑」做成**把步骤从钩子里删掉**。那样
 * `check-gate-executors.cjs`（它按文本解析钩子的 `run` 行、`quality-gate.mjs` 的 gate 表、
 * `quality-gate.ps1` 的 `$Blocks` —— **`.cnb.yml` 不在它的解析面上**）会立刻失去那批
 * 判据的出处，而账面上一条红都不会出现：步骤没了 ⇒ 「没有档要找执行者」⇒ 绿。
 * 所以这里钉的不是「跑得快」，是**注册表还在、且真的有人跑它**。
 *
 * 三条方向各一：① 注册表 ⇄ 钩子双向对账与本地档边界（挪档不许减清单，也不许加完不登记）；
 * ② 跳档必须被说出来
 * （否则一次「只跑了 D0」的绿会被读成「全套过了」）；③ CI 那一档读的是同一份注册表。
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";

import { describe, expect, it } from "vitest";

import { localTierLabels, readHookSteps } from "../scripts/base-check/hook-steps.mjs";
import {
  DECLARED_D0_STEPS,
  DECLARED_STEPS,
  registryProblems,
} from "../scripts/base-check/declared-hook-steps.mjs";
import { fullTreeArgv, main as heavyMain } from "../scripts/ci-heavy-gates.mjs";

const ROOT = path.resolve(__dirname, "..");
const HOOK = path.join(ROOT, ".githooks", "pre-commit");
const hookText = readFileSync(HOOK, "utf8");

describe("档位：注册表与边界", () => {
  /**
   * 这一格**不写总数**（ISSUE #2235）。应然清单住在
   * `scripts/base-check/declared-hook-steps.mjs`，这里只核「注册表与钩子说的是不是同一件事」。
   *
   * 为什么抄一份名单不算第二份漂移：那份名单是**规约**（「这些判据必须有执行者」），
   * 而它的两个漂移方向都被 `registryProblems()` 挡住 —— 钩子加了没登记 ⇒ 红；
   * 登记了而钩子没有 ⇒ 红。两者都**点名是哪一条**，这比旧写法强一整格：
   * 「总数不等」只说差一条，而排查「差的是哪条」要把 56 行重读一遍。
   */
  it("注册表 ⇄ 钩子步骤双向对账（一条不差、一条不多，本地档边界一致）", () => {
    expect(registryProblems(readHookSteps(), localTierLabels())).toEqual([]);
  });

  it("总数由注册表派生，而不是由测试手写（旧写法是那三个手写数的现场）", () => {
    expect(readHookSteps().length).toBe(DECLARED_STEPS.length);
    expect(localTierLabels().size).toBe(DECLARED_D0_STEPS.length);
  });

  it("删一步（把降档做成删步骤）⇒ 红，并点名缺的是哪一条", () => {
    const all = readHookSteps();
    const [removed = { label: "", argv: [] }] = all;
    expect(removed.label, "钩子解析为空 ⇒ 解析器或行形状坏了，这条断言没有对象").toBeTruthy();
    const problems = registryProblems(
      all.filter((s) => s.label !== removed.label),
      localTierLabels(),
    );
    expect(problems.length, "删掉一步却一条不一致都不报").toBeGreaterThan(0);
    expect(problems.join("\n")).toContain(removed.label);
  });

  it("裸加一步（钩子里有、注册表没登记）⇒ 红，同样点名", () => {
    const problems = registryProblems(
      [...readHookSteps(), { label: "临时探针（没登记）", argv: ["node", "x.cjs"] }],
      localTierLabels(),
    );
    expect(problems.join("\n")).toContain("临时探针（没登记）");
  });

  it("把一条判据挪出本地档而不在注册表登记 ⇒ 红（「本地每次都跑的那批」不许静默变少）", () => {
    const tier = new Set(localTierLabels());
    const [moved = ""] = [...tier];
    expect(moved, "D0 块读为空 ⇒ 档位开关与 `--light` 也读到空了").toBeTruthy();
    tier.delete(moved);
    expect(registryProblems(readHookSteps(), tier).join("\n")).toContain(moved);
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
    /* 收尾那句自 ISSUE #2154 起住在 `scripts/gate-tier-summary.cjs`（钩子只调它），
     * 所以这里判的是**接线**而不是那句话的位置：钩子必须点名那个脚本，而那句话必须在
     * 那个脚本里 —— 少任何一半，「跳过被说出来」这条就当场没有执行者。
     * （原先这里直接在 `hookText` 上匹配那句话；把判据钉在行形状上，等于钉住一个
     *  随时该搬走的实现 —— 语义是「有人念」，不是「念的那行住在哪个文件」。） */
    expect(hookText).toContain("scripts/gate-tier-summary.cjs");
    expect(readFileSync(path.join(ROOT, "scripts/gate-tier-summary.cjs"), "utf8")).toMatch(
      /本次提交本地\*\*没跑\*\*：/,
    );
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
    const src = readFileSync(path.join(ROOT, "scripts/premerge-check.mjs"), "utf8");
    expect(src).not.toContain("unitTests:");
    expect(src).not.toContain('kind: "changed"');
    // `base` 段仍读钩子注册表（localTierLabels），`--light` 那一档的跳过条数照旧要说出来。
    expect(src).toContain("localTierLabels");
    expect(src).toContain("--light");

    const ci = readFileSync(path.join(ROOT, "scripts/ci-affected-tests.mjs"), "utf8");
    // 同一条判决链：跑法脚本起的是 run-affected-tests.mjs，改动面经 env 递进去。
    expect(ci).toContain("run-affected-tests.mjs");
    expect(ci).toContain("COMFY_AFFECTED_CHANGED");
    // 并发按 §13.5.21 的唯一出处收敛，不在这里另写一个数。
    expect(ci).toContain("resolveCiWorkers");

    const cnb = readFileSync(path.join(ROOT, ".cnb.yml"), "utf8");
    expect(cnb).toContain("- name: 受影响用例");
    /* #2845 起固定/受影响拆成两格：名单里两格相邻、且各有自己的 stage 块。 */
    expect(cnb).toContain("类型检查, 固定结构用例, 受影响用例,");
    expect(cnb).toContain("- name: 固定结构用例");
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
          env: {
            ...process.env,
            COMFY_AFFECTED_CHANGED: changed,
            /* 显式抹平段开关（ISSUE #2845）：这条用例判的是「面 → 判决链」那一路，
             * 它是 both/affected 段的行为；固定结构用例那格的 `SEGMENT=fixed` 会经
             * process.env 漏进子进程，把 collectList 整段旁路掉（实测 cnb-lpr-1k68pquq6：
             * 两次都数出 106，`> 106` 的负控制永远不成立）。 */
            COMFY_AFFECTED_SEGMENT: "",
          },
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
    expect(countOf(runLauncher("src/lib/endpoints.ts"))).toBeGreaterThan(countOf(docsOnly));
  });
});

describe("CI 那一格：读同一份注册表，且三态分得开", () => {
  it("重档 runner 不抄清单（它 import 的就是钩子那份注册表）", () => {
    const src = readFileSync(path.join(ROOT, "scripts/ci-heavy-gates.mjs"), "utf8");
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
    const lines: Array<string> = [];
    const code = heavyMain({
      cwd: process.env.TEMP ?? "/tmp",
      argv: [],
      log: (l) => lines.push(l),
    });
    expect(code).toBe(2);
    expect(lines.join("\n")).toContain("不构成证据");
  });
});
