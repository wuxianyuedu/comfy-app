/**
 * 档位这一刀的判据（ISSUE #2022 / 规范 §13.5.25）。要挡的失效形态：把「重档不在每次提交跑」做成**删步骤** ——
 * `check-gate-executors.cjs` 按文本解析钩子 `run` 行、gate 表、`$Blocks`（`.cnb.yml` 不在解析面），步骤没了
 * ⇒ 判据失去出处而账面全绿。所以钉的是注册表还在且真有人跑：①双向对账与本地档边界；②跳档必须说出来；③CI 读同一份注册表。
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
   * 这一格不写总数（ISSUE #2235）：应然清单住在 `scripts/base-check/declared-hook-steps.mjs`，这里只核注册表
   * 与钩子说的是不是同一件事。抄名单不算第二份漂移 —— 它是**规约**（这些判据必须有执行者），两个漂移方向
   * 都被 `registryProblems()` 挡住并点名是哪一条，比「总数不等」强一整格（排查差哪条要重读 56 行）。
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
      expect(hookText).toMatch(new RegExp(`^run_group ${id} `, "m"));
    }
  });

  it("受影响用例 / 固定结构用例 / 覆盖率上报 从 PR 撤出：执行者收口到每日全量单测", () => {
    /* 沿革：`unitTests` 段 2026-10-19 从 pre-commit C 组搬到 pre-push，2026-10-20 整体撤掉 —— 共享机上
     * 失效形态是 forks worker 调度超时而非用例红；2026-11-02 起连同「core 骨架单一事实源」等从 PR 撤到
     * 每日全量单测（§13.5.21）。这里钉两件：①premerge 段表**没有** `unitTests`（恒跳过的一格不构成证据，
     * §13.6.2）；②`受影响用例`/`固定结构用例` 在 `.cnb.yml` 不再有独立 stage。 */
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
    // 两测试格从 PR 撤出：PR 清单里不再相邻、且不再有独立 stage 块。
    expect(cnb).not.toContain("类型检查, 固定结构用例, 受影响用例,");
    expect(cnb).not.toMatch(/^\s*- name: 受影响用例\s*$/m);
    expect(cnb).not.toMatch(/^\s*- name: 固定结构用例\s*$/m);
    // `覆盖率上报` 从 PR 挪到了每日档（PR 上不再有产出 lcov 的测试格，它只会静默空转）；
    // 它现在以 `- name: 覆盖率上报` 的形态在 `*daily_gates` 末尾。
    expect(cnb).toMatch(/^\s*- name: 覆盖率上报\s*$/m);
    // 拿不到改动面 / 清单为空必须退 2（没判 ≠ 绿）。
    expect(ci).toMatch(/files\.length === 0[\s\S]{0,400}return 2/);
  });

  /**
   * `COMFY_AFFECTED_CHANGED` 要**真的**换掉改动面，不是读进去又丢掉。用 `--dry-run` 只走「筛清单 + 规划
   * 启动」，不起 vitest，既快又不抢机器。两个方向都判 —— 只判「给了清单会打印份数」的话，把 env 当空气、
   * 永远按暂存区筛也照样过。
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
      // oxlint-disable-next-line typescript/no-unnecessary-condition -- spawnSync 起不来时 stdout/stderr 实测为 undefined，@types/node 按非空标，空串兜底保留
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
