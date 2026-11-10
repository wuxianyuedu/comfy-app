/**
 * 配对注册表的单元面 + GA workflow 的**结构真解析**（ISSUE #3504）。
 *
 * `scripts/ci-ga-trigger-map.mjs` 是「CNB 触发口 ⇄ GA workflow」的唯一登记处：
 * 「哪条口派发到哪个文件」是决定不是推导，所以它存在表里。这份判据答三件事：
 *
 *  1. **表完整性** —— 每行的两个事件键 / 两条流水线名 / workflow 文件 / 并发组
 *     两两自洽，workflow 文件真的在盘上；
 *  2. **三态行为** —— `findTriggerTarget` / `dailyGateExecutor` / `dispatchStageName`
 *     的命中、未命中（回 undefined）与缺登记（当场抛）各有一条；
 *  3. **workflow 结构真解析** —— 旧自托管档的 actionlint 位随 #3504 退役，这里按行
 *     解析每个 workflow 的 `on:` / `concurrency:` / `jobs:` 顶层块接住同一层
 *     （语义校验仍归 GA runner 自身）。
 *
 * 派发 stage 的脚本逐字等式（`node scripts/ci-ga-dispatch.mjs --preset …`）与按钮
 * 绑定由 `tests/no-platform-ci-config.test.ts` 的触发口对账钉着 —— 这里**不重复**，
 * 这里只答「注册表 ↔ 磁盘上的 workflow 文件」这半边闭环。
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  DAILY_GATE_EXECUTORS,
  GA_TRIGGER_TARGETS,
  dailyGateExecutor,
  dispatchStageName,
  findTriggerTarget,
} from "../scripts/ci-ga-trigger-map.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");
const CNB = read(".cnb.yml");

/** 顶层键块：从 `^key:$` 到下一个**非注释**的顶格行（或 EOF）。 */
const topLevelBlock = (text: string, key: string): string | null => {
  const lines = text.split("\n");
  const start = lines.findIndex((l) => l === `${key}:`);
  if (start === -1) {
    return null;
  }
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    if (/^\S/.test(line) && !line.startsWith("#")) {
      end = i;
      break;
    }
  }
  return lines.slice(start, end).join("\n");
};

describe("配对注册表：一行 = 一个触发档的两个口 + 一个 GA 目标（#3504）", () => {
  it("每行自洽：事件键成对、流水线名成对、并发组非空", () => {
    expect(GA_TRIGGER_TARGETS.length, "注册表一行都没有 —— 判据空转").toBeGreaterThan(0);
    /** @type {Set<string>} */
    const presets = new Set();
    /** @type {Set<string>} */
    const workflows = new Set();
    /** @type {Set<string>} */
    const groups = new Set();
    /** @type {Set<string>} */
    const stages = new Set();
    for (const t of GA_TRIGGER_TARGETS) {
      /* 事件键：`web_trigger_<x>` / `api_trigger_<x>` 共享同一个后缀，且后缀非空。 */
      expect(t.eventApi, `${t.preset}：api 事件键形如 api_trigger_*`).toMatch(/^api_trigger_.+$/);
      const suffix = t.eventApi.slice("api_trigger_".length);
      expect(t.eventWeb, `${t.preset}：两个事件键共享后缀`).toBe(`web_trigger_${suffix}`);
      /* 流水线名：同一档名 + 各自的触发方式后缀（.cnb.yml 的顶层键名，逐字）。 */
      expect(t.pipelineWeb, `${t.preset}：web 流水线名以（手动触发）收尾`).toMatch(/（手动触发）$/);
      expect(t.pipelineApi, `${t.preset}：api 流水线名以（API 触发）收尾`).toMatch(/（API 触发）$/);
      expect(
        t.pipelineWeb.replace(/（手动触发）$/, ""),
        `${t.preset}：两条流水线名共享同一个档名`,
      ).toBe(t.pipelineApi.replace(/（API 触发）$/, ""));
      /* 派发目标：仓内相对文件名（不带路径分隔符），且真的在盘上。 */
      expect(t.workflow, `${t.preset}：workflow 是 .yml 文件名`).toMatch(/^[A-Za-z0-9_.-]+\.yml$/);
      expect(read(`.github/workflows/${t.workflow}`), `${t.workflow} 是空文件`).not.toBe("");
      /* 并发组非空（两个档共用一组会互掐对方的跑）。 */
      expect(t.concurrencyGroup, `${t.preset}：并发组非空`).not.toBe("");
      presets.add(t.preset);
      workflows.add(t.workflow);
      groups.add(t.concurrencyGroup);
      stages.add(dispatchStageName(t));
    }
    for (const [label, set] of [
      ["preset", presets],
      ["workflow 文件", workflows],
      ["并发组", groups],
      ["派发格名", stages],
    ] as const) {
      expect(set.size, `${label} 有重复 —— 两行登记成了同一件事`).toBe(GA_TRIGGER_TARGETS.length);
    }
  });

  it("派发格名一律 `GA 派发·<档>`；认不得的 preset 当场抛", () => {
    for (const t of GA_TRIGGER_TARGETS) {
      expect(dispatchStageName(t), `${t.preset}：格名前缀`).toMatch(/^GA 派发·\S+$/);
    }
    const unknown = {
      preset: "不存在的档",
      eventWeb: "web_trigger_none",
      eventApi: "api_trigger_none",
      pipelineWeb: "没有这一档（手动触发）",
      pipelineApi: "没有这一档（API 触发）",
      workflow: "none.yml",
      concurrencyGroup: "none",
    };
    expect(() => dispatchStageName(unknown)).toThrow(/preset 缺格名映射/);
  });

  it("findTriggerTarget：命中回那一行、未命中回 undefined、可注入替身", () => {
    const daily = GA_TRIGGER_TARGETS.find((t) => t.preset === "daily");
    expect(daily).toBeDefined();
    expect(findTriggerTarget("daily")).toBe(daily);
    expect(findTriggerTarget("没有这个档")).toBeUndefined();
    const standIn = [
      {
        preset: "x",
        eventWeb: "web_trigger_x",
        eventApi: "api_trigger_x",
        pipelineWeb: "X 档（手动触发）",
        pipelineApi: "X 档（API 触发）",
        workflow: "x.yml",
        concurrencyGroup: "x",
      },
    ];
    expect(findTriggerTarget("x", standIn)?.workflow).toBe("x.yml");
  });

  it("dailyGateExecutor：命中回登记值、缺登记当场抛（不静默放行）", () => {
    for (const [gate, step] of Object.entries(DAILY_GATE_EXECUTORS)) {
      expect(dailyGateExecutor(gate), `${gate}：命中应回登记值`).toBe(step);
    }
    expect(() => dailyGateExecutor("没有这一格")).toThrow(/每日格缺 GA 执行者登记/);
    expect(dailyGateExecutor("y", { y: "step-y" })).toBe("step-y");
  });
});

describe("GA workflow 结构真解析（接住退役的 actionlint 位，#3504）", () => {
  it("每个 workflow 的 `on:` 都有 `workflow_dispatch` + `head_sha` 输入（触发口的唯一入口）", () => {
    for (const t of GA_TRIGGER_TARGETS) {
      const on = topLevelBlock(read(`.github/workflows/${t.workflow}`), "on");
      expect(on, `${t.workflow} 没有 \`on:\` 顶层块`).toBeTruthy();
      const body = on ?? "";
      expect(body, `${t.workflow}：派发入口在场（触发口的唯一入口）`).toMatch(
        /^ {2}workflow_dispatch:$/m,
      );
      expect(body, `${t.workflow}：head_sha 输入在场（单跑哪一笔由入参决定）`).toMatch(
        /^ {6}head_sha:$/m,
      );
    }
  });

  it("每日档与桌包档带定时（北京时间 01:37 / 03:37），cron 逐字", () => {
    /** 定时 cron 的登记（档位 → cron 字面值）。 */
    const crons: Record<string, string> = { daily: "37 17 * * *", package: "37 19 * * *" };
    const scheduled = GA_TRIGGER_TARGETS.filter((t) => crons[t.preset] !== undefined);
    expect(scheduled.length, "定时档一个都没登记 —— 判据空转").toBeGreaterThan(0);
    for (const t of scheduled) {
      const body = topLevelBlock(read(`.github/workflows/${t.workflow}`), "on") ?? "";
      const cron = crons[t.preset] ?? "";
      expect(body, `${t.workflow}：定时入口在场`).toMatch(/^ {2}schedule:$/m);
      expect(body, `${t.workflow}：cron 逐字（北京时间 ${cron}）`).toMatch(
        new RegExp(`cron: "${cron.replaceAll("*", String.raw`\*`)}"`),
      );
    }
  });

  it("单跑档不许带定时（「单跑」名不副实的那一形态在这里当场红）", () => {
    const oneshots = GA_TRIGGER_TARGETS.filter(
      (t) => t.preset !== "daily" && t.preset !== "package",
    );
    expect(oneshots.length, "单跑档一个都没有 —— 判据空转").toBeGreaterThan(0);
    for (const t of oneshots) {
      const body = topLevelBlock(read(`.github/workflows/${t.workflow}`), "on") ?? "";
      expect(body, `${t.workflow}：单跑档不许带 schedule`).not.toMatch(/^ {2}schedule:$/m);
    }
  });

  it("并发组与注册表逐字相等，且 `cancel-in-progress: true`（连点两次只留最新）", () => {
    for (const t of GA_TRIGGER_TARGETS) {
      const concurrency = topLevelBlock(read(`.github/workflows/${t.workflow}`), "concurrency");
      expect(concurrency, `${t.workflow} 没有 \`concurrency:\` 顶层块`).toBeTruthy();
      expect(
        concurrency,
        `${t.workflow}：并发组应与注册表的 \`concurrencyGroup\` 逐字相等`,
      ).toMatch(
        new RegExp(
          `^ {2}group: ${t.concurrencyGroup.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`)}$`,
          "m",
        ),
      );
      expect(
        concurrency,
        `${t.workflow}：没有 cancel-in-progress ⇒ 连点两次是排队而不是掐旧跑`,
      ).toMatch(/^ {2}cancel-in-progress: true$/m);
    }
  });

  it("`jobs:` 至少一个 job，每个 job 有 `runs-on`，每个 step 有非空名字", () => {
    for (const t of GA_TRIGGER_TARGETS) {
      const jobs = topLevelBlock(read(`.github/workflows/${t.workflow}`), "jobs");
      expect(jobs, `${t.workflow} 没有 \`jobs:\` 顶层块`).toBeTruthy();
      const jobNames = [...String(jobs).matchAll(/^ {2}(?<job>[A-Za-z0-9_-]+):$/gm)].map(
        (m) => m.groups?.job ?? "",
      );
      expect(jobNames.length, `${t.workflow}：一个 job 都没有`).toBeGreaterThan(0);
      /* 每个 job 的块：从它的键行到下一个 2 空格键行。 */
      const lines = String(jobs).split("\n");
      for (const job of jobNames) {
        const start = lines.findIndex((l) => l === `  ${job}:`);
        let end = lines.length;
        for (let i = start + 1; i < lines.length; i += 1) {
          if (/^ {2}\S/.test(lines[i] ?? "")) {
            end = i;
            break;
          }
        }
        const block = lines.slice(start, end).join("\n");
        expect(block, `${t.workflow} 的 job \`${job}\` 缺 runs-on`).toMatch(/^ {4}runs-on: /m);
        const stepHeads = [...block.matchAll(/^ {6}- name: (?<name>.*)$/gm)].map((m) =>
          (m.groups?.name ?? "").trim(),
        );
        expect(
          stepHeads.length,
          `${t.workflow} 的 job \`${job}\` 一个 step 都没有`,
        ).toBeGreaterThan(0);
        for (const name of stepHeads) {
          expect(name, `${t.workflow} 的 job \`${job}\` 有无名 step`).not.toBe("");
        }
      }
    }
  });
});

describe("与 .cnb.yml 的闭环：触发口双向登记（#3504）", () => {
  /* 回读 / 判定面（`api_trigger_ga_verdict` → `GA 结论判定`）不派发构建，不在注册表 ——
   * 它由 no-platform-ci-config 的回读段钉着，这里是它唯一的豁免登记处。 */
  const NON_DISPATCH_LANES = ["api_trigger_ga_verdict"];

  it("注册表的每个事件键都在 .cnb.yml 里有一条同名的顶层流水线", () => {
    for (const t of GA_TRIGGER_TARGETS) {
      for (const lane of [t.eventWeb, t.eventApi]) {
        expect(
          CNB,
          `注册表登记了 \`${lane}\`，而 .cnb.yml 里没有这条顶层流水线 —— 「派发目标在、没人触发」`,
        ).toMatch(new RegExp(`^  ${lane}:\\s*$`, "m"));
      }
    }
  });

  it("反向：.cnb.yml 里没有漏登记的 `*_trigger_*` 流水线（「按钮还在、派发目标没了」）", () => {
    const registered = new Set([
      ...GA_TRIGGER_TARGETS.flatMap((t) => [t.eventWeb, t.eventApi]),
      ...NON_DISPATCH_LANES,
    ]);
    const lanes = [...CNB.matchAll(/^ {2}(?<lane>[A-Za-z0-9_]*trigger[A-Za-z0-9_]*):\s*$/gm)].map(
      (m) => m.groups?.lane ?? "",
    );
    const unregistered = lanes.filter((lane) => !registered.has(lane));
    expect(
      unregistered,
      "这些 `*_trigger_*` 流水线没登记进 ci-ga-trigger-map 的注册表 —— 加触发口必须同批加一行",
    ).toEqual([]);
    expect(lanes.length, "一条触发口都没有 —— 判据空转").toBeGreaterThan(0);
  });
});
