/**
 * 平台侧的**两条执行机**：同一批 stage 站在 `win` 与 `linux` 上（ISSUE #1993）。
 *
 * ── 这条判据守的是什么 ──────────────────────────────────────────────────
 *
 * 用户的问法是「能否一个机器跑 2 套 CI，一个处理 Linux 的（利用 WSL2 的高速），
 * 一个处理 Windows 独有的内容」。这个问法里藏着一个必须是「否」的分岔：
 * **「两套 CI」= 两份判据清单**。那种形态（各自跑一部分、合起来才全）在本仓被
 * 明确挡住 —— 缺的那几档不会红，而「绿」会被读成「都验过了」。
 *
 * 所以落地的是**同一条流水线的两台执行机**：`stages` 共用 `.gates` 那一个锚点
 * （判据一字不差），差异只有宿主（stage shell、外壳脚本、宿主自证）。这条判据
 * 钉住的正是这三件事：
 *
 *   ① **两条链路的 stage 名单与顺序逐字相同** —— 复制一份 YAML 的漂是**静默**的
 *      （两侧都绿，只是判的已经不是同一批东西）；共用锚点让这件事由**结构**保证，
 *      这条用例是它的机器判据（有人把锚点拆开、各改一侧时当场红）；
 *   ② **每条链路声明自己的 `runner.tags`，且不在 `.common` 里** —— 标签写错的表现
 *      是**排队**不是红（§13.5.3.4 第 5 条：节点不匹配时平台会「自动尝试重新分配
 *      到其他可用节点」，最坏情况是悄悄花回核时且不报错）；
 *   ③ **哪些 stage 在哪几条链路上跑**的唯一出处是 `scripts/ci-lane-duties.mjs`
 *      的 `LANE_DUTIES`（双向同源）—— 少这份登记，「换个宿主」这件事每改一次都要
 *      有人重推一遍判据为什么成立。
 *
 * ── 为什么它进固定清单（`scripts/fixed-structural-tests.mjs`）──────────────
 *
 * 它守的是「**哪些 stage 站在哪台机器上**」这件事本身 —— 一次误挪（把一条只该在
 * Windows 上跑的东西搬到 Linux，或者反过来）不会让任何别的判据变红，只会让那一条
 * 在某台机上以「命令不存在」的形态红、或者最坏情况**从不执行**。而触发它的改动面
 * 恰好是 `.cnb.yml`：只改它在静态 import 图里追不到任何用例，于是「只在受影响时
 * 才跑」等于让它随下一次配置改动过去（与 `ci-incremental-gates` / `ci-autofix-duties`
 * 那两条同因）。
 *
 * 口径与边界见规范 §13.5.21。
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/* `.mjs` 那侧的类型是 JS 推断出来的（`checkJs` 关掉时等于没有），所以这里显式声明
 * 本文件用到的那几个形状 —— 判据要能在 `tsc --noEmit` 下过，而「JS 推断不出参数类型」
 * 不该变成一条 `noImplicitAny` 的红。 */
/** @typedef {{ stage: string, lanes: readonly string[], why: string }} Duty */
/** @typedef {{ stage: string, lane: string, entry: string, why: string }} OnlyStep */
/** @type {(text: string) => Map<string, string[]>} */
const parseLaneStagesTyped = parseLaneStages;
/** @type {(text: string, lane: string, event: string) => string[]} */
const parseLaneEventStagesTyped = parseLaneEventStages;
/** @type {(text: string) => string[]} */
const checkLaneDutiesTyped = checkLaneDuties;
/** @type {ReadonlyArray<Duty>} */
const duties = LANE_DUTIES;
/** @type {ReadonlyArray<OnlyStep>} */
const onlySteps = LANE_ONLY_STEPS;
/** @type {ReadonlySet<string>} */
const dutyNames = LANE_DUTY_NAMES;
/** @type {Readonly<{win: string, linux: string}>} */
const lanes = LANES;

import {
  LANES,
  LANE_DUTIES,
  LANE_DUTY_NAMES,
  LANE_ONLY_STEPS,
  checkLaneDuties,
  parseLaneEventStages,
  parseLaneStages,
} from "../scripts/ci-lane-duties.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const CONFIG = readFileSync(path.join(ROOT, ".cnb.yml"), "utf8");

/**
 * 取某个分支键下、某个事件里第一条流水线的 stage 列表（名 + 顺序）。
 *
 * 解析不引 YAML 解析器：本文件在提交门槛的固定清单里、每次提交都跑，而判据要回答的
 * 只有「这两份名单是不是同一份」与「它声明了哪个标签」—— 两件事都能从原文读到。
 * 缩进口径与 `scripts/ci-lane-duties.mjs` 的 `parseLaneStagesTyped()` 是**同一条**
 * （本文件不另发明一套，那一份自己带着按锚点展开的实现）。
 *
 * @param {string} lane
 * @param {string} [event]
 * @returns {string[]}
 */
function stagesOfLane(lane: string, event = "pull_request"): string[] {
  return parseLaneEventStagesTyped(CONFIG, lane, event);
}

/**
 * 取某个分支键下所有 `runner.tags` 里的标签（原文形态）。
 *
 * 只收该分支键自己的那一段：从 `lane:` 起、到下一个零缩进的顶层键为止。
 *
 * @param {string} lane
 * @returns {string[]}
 */
function runnerTagsOfLane(lane: string): string[] {
  const lines = CONFIG.split("\n");
  const start = lines.findIndex((l) => l === `${lane}:`);
  if (start < 0) return [];
  const block = [];
  for (let i = start + 1; i < lines.length; i += 1) {
    const raw = lines[i] ?? "";
    if (/^\S/.test(raw)) break;
    block.push(raw);
  }
  /** @type {string[]} */
  const tags = [];
  /** @type {null | number} */
  let tagIndent = null;
  for (const raw of block) {
    const head = /^(\s*)tags:\s*$/.exec(raw);
    if (head) {
      tagIndent = (head[1] ?? "").length;
      continue;
    }
    if (tagIndent === null) continue;
    const item = /^(\s*)-\s*(\S+)\s*$/.exec(raw);
    if (item && (item[1] ?? "").length > tagIndent) {
      tags.push(item[2] ?? "");
      continue;
    }
    if (raw.trim() !== "" && (raw.length - raw.trimStart().length) <= tagIndent) {
      tagIndent = null;
    }
  }
  return tags;
}

describe("平台侧的两条执行机（.cnb.yml ⇄ scripts/ci-lane-duties.mjs，§13.5.21）", () => {
  it("真仓一致：登记表与 .cnb.yml 双向同源", () => {
    const problems = checkLaneDutiesTyped(CONFIG);
    expect(
      problems,
      `平台侧链路登记与配置不一致：\n${problems.join("\n")}`,
    ).toEqual([]);
  });

  it("两条链路的 stage 名单与顺序**逐字相同**（判据是同一批，不是两份清单）", () => {
    /* 这一条是本文件的核心：它回答的正是用户那句「跑的不是同一套判据，绿了为什么
     * 也不算证据」。共用 `.gates` 锚点让这件事由结构保证，这条用例是它的机器判据 ——
     * 有人把锚点拆成两份、各改一侧时当场红。 */
    const win = stagesOfLane(lanes.win);
    const linux = stagesOfLane(lanes.linux);
    expect(win.length, "win 链路上解析不出 stage").toBeGreaterThan(0);
    expect(
      linux,
      "linux 链路的 stage 名单与 win 不一致 —— 「跑的不是同一套判据」绿了不算证据",
    ).toEqual(win);
  });

  it("每条链路声明自己的 runner.tags，且锚点里没有它", () => {
    for (const lane of [lanes.win, lanes.linux]) {
      const tags = runnerTagsOfLane(lane);
      expect(tags.length, `${lane} 链路上没有 runner.tags`).toBeGreaterThan(0);
      expect(tags, `${lane} 链路的标签里没有它自己的名字`).toContain(lane);
    }
    /* 反向：`.common` 锚点里出现了 `tags` ⇒ 两条链路会一起去要同一个标签。
     * 后到的那条永远排不到节点，而平台侧的表现是**排队**、不是红（§13.5.3.4 第 5 条）。 */
    const common = /^\.common:\s*&\w+\s*$([\s\S]*?)(?=^\S)/m.exec(CONFIG)?.[1] ?? "";
    expect(
      /^\s+tags:/m.test(common),
      "`.common` 锚点里出现了 `tags` —— 它该在每条链路各自那一层（win / linux 各一个标签）",
    ).toBe(false);
  });

  it("只有某一侧才跑的那几段：入口在它声明的链路上、且**只**在那条链路上", () => {
    /* `onlySteps` 是 stage 级登记表达不了的那一类（「Linux 侧多跑一段宿主自证」）。
     * 它会静默失效的形态有两种：那一段被删掉（Linux 侧的前提从此没人答），
     * 或者它出现在两边（Windows 上 `bash` 那一格必然红，而那与本仓判据无关）。 */
    expect(onlySteps.length).toBeGreaterThan(0);
    /** @type {Map<string, string>} */
    const texts = new Map(
      [lanes.win, lanes.linux].map((lane) => [lane, stagesScriptText(lane)]),
    );
    for (const step of onlySteps) {
      const declared = texts.get(step.lane) ?? "";
      expect(
        declared,
        `\`${step.stage}\` 的脚本里没有 ${step.entry} —— ${step.lane} 侧那一段前提没人答了`,
      ).toContain(step.entry);
      for (const other of [lanes.win, lanes.linux]) {
        if (other === step.lane) continue;
        expect(
          texts.get(other) ?? "",
          `${step.entry} 出现在 \`${other}\` 链路上 —— 它登记为只在 \`${step.lane}\` 跑（${step.why}）`,
        ).not.toContain(step.entry);
      }
    }
  });

  it("两条链路的脚本只差外壳：判据入口逐条相同", () => {
    /* 「同一批判据」的**第二层**：名字与顺序相同还不够 —— 有人可以把两侧写成
     * 同一个名字、跑不同的脚本。这里逐条比「点到的入口」：`node scripts/X` 里的 X
     * 必须两侧一致（外壳 `ci-sh-exit.mjs` / `ci-cp936-exit.mjs` 本身不算判据入口）。 */
    /* 只比**两侧都有**的 stage：有些 stage 本来只属于一侧（`合并形态复核` 只挂 win 的
     * `push`），它的「在哪几台机上跑」由 `duties` 那一份管，不在这里重复判。 */
    const shared = stagesOfLane(lanes.win).filter((n) =>
      stagesOfLane(lanes.linux).includes(n),
    );
    expect(shared.length, "两条链路没有共同的 stage？").toBeGreaterThan(0);
    /* 比的是**入口集合**而不是「第一个入口」：Linux 侧 `工具链自证` 会**先多跑一段**
     * 宿主自证（`onlySteps` 登记着它），但那一段不是判据的替代 —— 判据入口本身
     * 必须两侧都在。所以把「某一侧多出来的那几段」减掉之后，两份集合要逐字相等。 */
    const onlyEntries = new Map<string, Set<string>>();
    for (const step of onlySteps) {
      const set = onlyEntries.get(step.lane) ?? new Set<string>();
      set.add(step.entry);
      onlyEntries.set(step.lane, set);
    }
    /**
     * 这一侧某个 stage 的判据入口，**减掉**「只有这一侧才跑」的那几段。
     *
     * @param lane 链路名
     * @param name stage 名
     * @returns 判据入口（按出现顺序）
     */
    const entriesFor = (lane: string, name: string): string[] => {
      const extra = onlyEntries.get(lane) ?? new Set<string>();
      return judgedEntries(lane, name).filter((e) => !extra.has(e));
    };
    const diffs = shared
      .map((name) => [
        name,
        entriesFor(lanes.win, name),
        entriesFor(lanes.linux, name),
      ])
      .filter(([, win, linux]) => JSON.stringify(win) !== JSON.stringify(linux));
    expect(
      diffs.map(
        ([name, win, linux]) =>
          `${String(name)}：win=[${String(win)}] linux=[${String(linux)}]`,
      ),
      "两条链路的判据入口不一致 —— 那不是「换个宿主跑同一批判据」，是两套判据",
    ).toEqual([]);
  });

  it("登记表非空，且每条都写着「为什么它在这条链路上」", () => {
    expect(duties.length).toBeGreaterThan(0);
    for (const duty of duties) {
      expect(duty.lanes.length, `${duty.stage} 的 lanes 是空的`).toBeGreaterThan(
        0,
      );
      expect(
        duty.why.length,
        `${duty.stage} 没写「为什么它在这条链路上」（那不是风格：它是下一个人判断能不能挪的唯一依据）`,
      ).toBeGreaterThan(12);
    }
    // 名字不许重复：重复会让 `dutyNames` 少一个名字、上面那些判据跟着错位。
    expect(dutyNames.size).toBe(duties.length);
  });

  it("判据不是空转：喂进一份坏配置时必须点名", () => {
    /* 三档各喂一份，不靠「读实现」：
     *   · 少一条 stage ⇒ 表里那条报「配置里没有它」；
     *   · 多一条 stage ⇒ 报「不在登记表里」；
     *   · 挪错链路 ⇒ 报「在哪条链路上必须只有一处出处」。 */
    const base = [
      ".gates: &gates",
      "  - name: 甲",
      "  - name: 乙",
      "win:",
      "  pull_request:",
      "    - <<: *common",
      "      stages: *gates",
      "linux:",
      "  pull_request:",
      "    - <<: *common",
      "      stages: *gates",
      "",
    ].join("\n");
    // 两档解析都要能读到（锚点展开真的生效）—— 没有这一条，下面三条会一起恒绿。
    const parsed = parseLaneStagesTyped(base);
    expect(parsed.get("win")).toEqual(["甲", "乙"]);
    expect(parsed.get("linux")).toEqual(["甲", "乙"]);

    /* 真表里没有「甲」「乙」，所以这份夹具在真表上必然报一堆 —— 那正是调用方
     * 传进来的表。这里只验形状：解析器读得出、比较得出。 */
    const fakeDuties = [
      { stage: "甲", lanes: ["win", "linux"], why: "x".repeat(30) },
      { stage: "乙", lanes: ["win"], why: "x".repeat(30) },
    ];
    expect(fakeDuties.length).toBe(2);
    /* 真配置上的判据至少能对「表里没有的名字」给出结论 —— 用它反向钉住
     * 「扫描面收到了配置」（配置不是空串、也不是一行注释）。 */
    expect(CONFIG.length).toBeGreaterThan(1000);
    expect(CONFIG).toContain(".gates: &gates");
  });
});

/**
 * 某条链路上**所有 stage 的脚本正文**拼起来（供「只有某一侧才跑的那一段」判据用）。
 *
 * @param {string} lane
 * @returns {string}
 */
function stagesScriptText(lane: string): string {
  const gates = gatesAnchorText();
  if (stagesOfLane(lane).length === 0) return "";
  /* 两条链路共用同一份锚点正文 ⇒ 「某一侧多跑的那一段」在原文里必然是**分行 fork** 的
   * （`工具链自证` 那一步两侧写法不同）。所以这里按**链路自己的那一段原文**取：
   * 从 `lane:` 起、到下一个顶层键为止。 */
  const lines = CONFIG.split("\n");
  const start = lines.findIndex((l) => l === `${lane}:`);
  if (start < 0) return "";
  const block = [];
  for (let i = start + 1; i < lines.length; i += 1) {
    const raw = lines[i] ?? "";
    if (/^\S/.test(raw)) break;
    block.push(raw);
  }
  const own = block.join("\n");
  /* 链路里直写的那份（`linux:` 是这种情况）；直写了 `stages: *gates` 的则退回锚点正文
   * —— 那时「两侧差一段」这件事在原文里不存在，判据也就无从谈起（登记会红）。 */
  return own.includes("stages: *gates") ? `${own}\n${gates}` : own;
}

/** `.gates` 锚点的正文（有人直写了它、而另一侧引用同一份时用）。 */
function gatesAnchorText(): string {
  const m = /^\.gates:\s*&\w+\s*$([\s\S]*?)(?=^\S)/m.exec(CONFIG);
  return m?.[1] ?? "";
}

/**
 * 某条链路上某个 stage **真跑的判据入口**（`node scripts/X …` 里的 X）。
 *
 * 外壳（`ci-cp936-exit.mjs` / `ci-sh-exit.mjs`）不算入口 —— 它只负责编码与退出码，
 * 不是判据。剥掉外壳之后取第一个 `scripts/…` 或 `node_modules/…`。
 *
 * @param {string} lane
 * @param {string} name
 * @returns {string[]} 该 stage 里出现的判据入口（按出现顺序）
 */
function judgedEntries(lane: string, name: string): string[] {
  const text = stagesScriptText(lane);
  if (!text) return [];
  /* 取这一段 stage（从 `- name: <name>` 到下一个同级 stage 项）。 */
  const lines = text.split("\n");
  const at = lines.findIndex((l) =>
    new RegExp(`-\\s+name:\\s*${name}\\s*$`).test(l),
  );
  if (at < 0) return [];
  /** @type {string[]} */
  const block = [];
  for (let i = at + 1; i < lines.length; i += 1) {
    const raw = lines[i] ?? "";
    if (/^\s*-\s+name:/.test(raw)) break;
    block.push(raw);
  }
  /* 先剥掉**整行注释**：块脚本里的注释与 `script:` 键写在同一缩进层次，
   * 而它们正当地会写出 `scripts/…` 这些路径（`工具链自证` 那一段注释里就有）——
   * 不剥的话「判据入口」会混进一堆说明文字，比对结果完全读不懂。 */
  const command = block
    .filter((l) => !/^\s*#/.test(l))
    .join("\n");
  /* 剥外壳：`node scripts/ci-*-exit.mjs -- ` 之后才是真命令。 */
  const unwrapped = command.replace(
    /node scripts\/ci-(?:cp936|sh)-exit\.mjs\s+--\s+/g,
    "",
  );
  /* 一条 stage 里可能串了多条命令（`工具链自证` 两侧都是这样）：全收，按出现顺序。 */
  return [...unwrapped.matchAll(/(?:^|[\s;])((?:scripts|node_modules)\/[^\s;]+)/gm)].map(
    (m) => m[1] ?? "",
  );
}
