/**
 * 「每一个棘轮的 `--update` 都拒涨」**横切**判据（台账 E5 / §11.2.1）：各家那行「净数不许上涨」
 * 没人判过是否生效，改掉它全仓都不红 ⇒ 一次污染整套棘轮，故按**集合**判、不按各家测试。六步
 * （写基线/绿/红/非零不落盘/零基线/话给出路）走 `createGateRepo()`；⑥ 的实现住 `tests/helpers/ratchet-refusal.ts` 文件头。
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { isRecord } from "~/lib/is-record";

import { createGateRepo, type GateRepo, type GateRepoOptions } from "./helpers/gate-repo";
import { expectActionableRefusal, ACTIONABLE_REFUSAL } from "./helpers/ratchet-refusal";

/** 一条棘轮的完整描述：脚本、基线落点、夹具输入、以及「怎么再加一条违规」。 */
type Ratchet = {
  /** 基线相对**工作区根**的路径（脚本落 scripts/ 时它落在 scripts/ 下）。 */
  baseline: string;
  /** 脚本在工作区里的落点（与 `createGateRepo` 同义，这里显式写出来便于核对基线路径）。 */
  dir?: "scripts" | "root";
  fixture?: Pick<GateRepoOptions, "dirs" | "env" | "files" | "copy" | "setup">;
  /**
   * 「判定档」的命令行参数 —— 不带 `--update` 的那次跑。多数判据默认档即判定档（`[]`），但
   * `--check` 型工具（tw4 那两份）默认档是**报告**、永远退 0：用它判第 ②/③ 步只会得到「加违规
   * 仍绿」，那判的是「没把判定档打开」，不是棘轮。
   */
  judgeArgs?: Array<string>;
  script: string;
  /**
   * 这条棘轮的单次预算（毫秒）：起 Tailwind 引擎的那两家单次约 5s、一格要跑 3–4 次，全局 30s
   * 在并发下会被顶穿。口径同 §11.13：真进程慢到贴边就登记实测值，不让它撞默认档。
   */
  timeout?: number;
  /** 加第 `n` 条违规；实现必须让「第 n+1 条」让计数**严格变大**（不同文件名，别覆盖上一条）。 */
  violate: (repo: GateRepo, n: number) => void;
};

/** AST 类判据在临时工作区旁边没有 node_modules，靠 NODE_PATH 指回源码仓库。 */
const AST_ENV = { NODE_PATH: join(process.cwd(), "node_modules") };

const RATCHETS: Array<Ratchet> = [
  {
    script: "check-void-floats.cjs",
    baseline: "scripts/.void-floats-baseline.json",
    fixture: { dirs: ["src/lib"], env: AST_ENV },
    violate: (repo, n) => {
      repo.write(
        `src/lib/vf${n}.ts`,
        `async function vf${n}(): Promise<void> {}\nvoid vf${n}();\n`,
      );
    },
  },
  /* 这里**没有** tw4 那两份（`tw4-canonical-report.mjs` / `tw4-spacing-canonical.mjs`）：它们在
   * ISSUE #1811 翻了硬闸（基线删、`--update` 删、`--check` 命中即退 1），「拒涨」在这两家**无对象
   * 可判**，`discoveredBaselines()` 也认不出。硬闸形态由 `tests/tw4-canonical-ratchet.test.ts` 守
   * 形状、`tests/tw4-hardgate-behaviour.test.ts` 守行为。 */
];

/**
 * 判据自己写了拒涨那一支、且**已有本地行为用例**钉过的棘轮（值 = 那份用例）。
 * 列在这里而不是搬进上面的表，是为了不在两处重复跑同一家的沙箱；
 * 但「它在不在册」这件事仍由完整性那条用例判 —— 删掉本地用例而不改这张表会红。
 */
const COVERED_LOCALLY: Record<string, string> = {
  ".form-field-wiring-baseline.json": "tests/form-field-wiring-gate.test.ts",
  /* 它的判定对象是 registry 漏洞清单，沙箱造不出「一条新 advisory」，
   * 而它自带 `--fixture` 口，本地用例正是对着固定 registry 形状跑 CLI 退出的。 */
  ".dependency-audit-baseline.json": "tests/dependency-audit.test.ts",
  /* 它的 `--update` 是「收紧一份已有台账」：读不到台账时先判失败（§11.23.3 那套
   * 「不许静默降级」），不会凭空写出一份 —— 与表里那些「从零写出基线」的形状不同，
   * 套不进那五步。本地用例实测过「上涨 → 退 2 且台账原样不动」，这里点名的是那条用例。 */
  ".tsc-diagnostic-executors.json": "tests/tsc-diagnostic-executors.test.ts",
  /* client chunk 体积预算（ISSUE #1781）：输入是 `next build` 产物目录，且「产物不存在就跳过、
   * 文件数低于下限就判红」—— 套不进第 ⑤ 步（干净沙箱无 `.next`，本脚本按设计退 0、不写基线）。
   * 拒涨与「掏空基线应变红」由 `tests/check-bundle-budget.test.ts` 覆盖。
   */
  ".bundle-budget-baseline.json": "tests/check-bundle-budget.test.ts",
  /* 脚本档类型检查账本（ISSUE #2524 / §13.5.14.1）：工具本体必须留在真仓库（`typescript` 与
   * `lib/tsc.js` 按脚本位置解析），跟着拷的只有被判决那棵树（`COMFY_SCRIPTS_TYPECHECK_ROOT`，
   * 同 `DOC_RENDER_ROOT` / #2415），故沙箱不是那五步的形状。本地用例实测「新增格子⇒红」
   * 「拒涨⇒红且不写回基线」并调 `expectActionableRefusal` 判出路。
   */
  ".scripts-typecheck-baseline.json": "tests/scripts-typecheck-ratchet.test.ts",
};

/**
 * 待配：判据写了拒涨那一支，但今天没有行为用例钉过。**现在为空，且判据是「必须为空」** —— 只该
 * 在「棘轮刚落地、行为用例还没跟上」的空窗里非空，让那段空窗被指名，不是永久出口；曾清的两格
 * （`.file-size-baseline.json` 连带命中、`.ui-primitives-baseline.json` 棘轮车道空置）已改归别处。
 */
const PENDING: Record<string, string> = {};

/**
 * 已退出棘轮车道、**只剩硬闸**的判据（基线文件仍在、`--update` 仍是出口，但写回的永远是空账）。
 * 与 `NOT_A_RATCHET`（「加条目本就是正常用法」）不同：这里是棘轮形态本身被淘汰，两条路都不走
 * 五步拒涨判据，理由却不同故分两张表。**这张只许增不许减**（退回 PENDING 等于假装还有存量）。
 */
const RETIRED_RATCHETS: Record<string, string> = {
  ".ui-primitives-baseline.json":
    "85 条判据全部在 HARD_GATE_RULES 里（`ratchetOnly()` 恒返回空），棘轮车道已无成员；`--update` 写回去的永远是空账，拒涨无对象可判",
};

/**
 * **已翻硬闸**的棘轮（ISSUE #1811 收尾那批）：基线 / `--update` / `--strict` 已删，命中即退 1。
 * 必须存在：翻闸正确性有一半是否定式（不再有放宽通道），而翻闸后脚本自然从 `discoveredBaselines()`
 * 出网、五张表也不点名，「把基线 + `--update` 加回去」在本文件不会有反应 —— 这里钉住前半段。值 = 自测文件（删了会红）。
 */
const HARD_GATE_FLIPS: Record<string, string> = {
  /* ── 第一至五刀翻的那一批（ISSUE #1811 前半段）────────────────────────────
   * 这十条此前不在表里（表是第六刀才建的，前四刀只靠各自自测守形态）。缺口即后果：把
   * `--update` 与基线通道加回 `check-dead-exports.cjs`，正面判据一格都不会红。收尾按 git 里
   * 「已删的基线文件」反查补齐 —— 基线已删 + 无 `.json` 落盘通道的判据都该在册；自测已断言硬闸
   * 形态，补上不假红，补的是**否定式的机器痕迹**。 */
  "check-circular-deps.cjs": "tests/check-circular-deps.test.ts",
  "check-code-duplication.cjs": "tests/check-code-duplication.test.ts",
  "check-dead-exports.cjs": "tests/check-dead-exports.test.ts",
  "check-function-length.cjs": "tests/check-function-length.test.ts",
  "check-rust-function-length.cjs": "tests/check-rust-function-length.test.ts",
  "check-non-null-assertions.cjs": "tests/check-non-null-assertions.test.ts",
  "check-click-keyboard.cjs": "tests/click-keyboard-gate.test.ts",
  "check-theme-colors.cjs": "tests/check-theme-colors.test.ts",
  "check-test-it-each.cjs": "tests/test-it-each-gate.test.ts",
  "check-infra-file-size.cjs": "tests/check-infra-file-size.test.ts",
  "check-overlay-z.cjs": "tests/check-overlay-z.test.ts",
  "check-comment-language.cjs": "tests/comment-language.test.ts",
  "check-test-sleep.cjs": "tests/test-sleep-gate.test.ts",
  "check-format.cjs": "tests/check-format.test.ts",
  "check-ui-logic-separation.cjs": "tests/check-ui-logic-separation.test.ts",
  /* R5（`src` 侧超 900 行）这一半：基线删了、`--strict` / `--update` 删了，超限即阻断 ——
   * 于是它在本表的棘轮车道上「无对象可判」，改由硬闸形态的否定式钉住。 */
  "check-file-structure.cjs": "tests/check-file-structure.test.ts",
  /* 门禁自测的「手搓临时仓库样板」（ISSUE #1811 收尾）：最后两处待迁存量
   * （`check-reformat-only` / `gate-executors`）迁进 `defineGateRepo` 后基线归零，
   * 于是删基线 + 删 `--update` / `--allow-new`，命中即退 1。
   * 它的落点本就特殊 —— 判的是**别人**的写法而不是 src 代码，所以翻闸后不存在
   * 「棘轮车道空置」那一档（RETIRED_RATCHETS 是给「基线在、--update 在、写回空账」用的）。 */
  "check-gate-repo-boilerplate.cjs": "tests/gate-repo-boilerplate-gate.test.ts",
  /* tw4 这一项（ISSUE #1811 的 tw4 半边）：与上面五条同形状，守的是「CSS 等价改写」而非违规
   * 计数 —— 清零后无对象可判，留基线只多一条「手改 JSON 登记新候选」的通道。R5 与 tw4 是两条
   * 独立翻闸记录，删任一条都会让那一刀退网。自测点名 `tw4-canonical-ratchet`（形状），行为那半
   * 在同名 `tests/tw4-hardgate-behaviour.test.ts`，不进表（表的值是「删了会红的那一份」）。 */
  "tw4-canonical-report.mjs": "tests/tw4-canonical-ratchet.test.ts",
  "tw4-spacing-canonical.mjs": "tests/tw4-canonical-ratchet.test.ts",
};

/** 不是计数棘轮的 `--update` 出口：加条目是它的正常用法，拒涨反而错。理由必须写在册子上。 */
const NOT_A_RATCHET: Record<string, string> = {
  ".gate-executor-ledger.json": "判据执行者台账：新增一条判据就该新增一个条目，这是登记表不是棘轮",
};

/**
 * 从真仓库现算「哪些脚本带 `--update` 且**把某份基线写回去**」—— 不抄第二份清单；认「写回去」
 * 而非「出现过」：`check-tsc-diagnostic-executors.cjs` 会读姊妹索引 `.declaration-readers.json` 核对，
 * 但 `--update` 只写自己台账。按「出现过」算会把别人读的登记表判成出口而误报（§11.18.4）。
 */
function discoveredBaselines(): Array<{ baseline: string; script: string }> {
  const dir = join(import.meta.dirname, "..", "scripts");
  /** 键 = `脚本:基线名`（两者都不含冒号），去重用 Map 而不是拼哨兵字符串。 */
  const found = new Map<string, { baseline: string; script: string }>();
  const push = (script: string, baseline: string) =>
    found.set(`${script}:${baseline}`, { script, baseline });

  for (const script of readdirSync(dir)) {
    if (!/\.(?:cjs|mjs)$/.test(script)) {
      continue;
    }
    const src = readFileSync(join(dir, script), "utf8");
    if (!src.includes("--update")) {
      continue;
    }

    /**
     * `const LEDGER = path.join(<根变量>, …, ".x.json")` 这类声明。根变量**不钉死成 `__dirname`**
     * （`ROOT` / `HERE` 都是同一条通道，tw4 与 `check-dependency-audit` 即如此），按变量筛会把
     * 覆盖面绑在一种拼法上、换拼法静默出网。认这段里第一个 `.` 开头、`.json` 结尾的字面量。
     */
    const declared = new Map<string, string>();
    for (const m of src.matchAll(
      /(?:const|let|var)\s+(?<name>[A-Za-z0-9_$]+)\s*=\s*path\.join\((?<args>[^;]{0,300}?)\)/g,
    )) {
      const name = m.groups?.name;
      const baseline = /"(?<baseline>\.[^"]+\.json)"/.exec(m.groups?.args ?? "")?.groups?.baseline;
      if (name !== undefined && name !== "" && baseline !== undefined && baseline !== "") {
        declared.set(name, baseline);
      }
    }
    /** 真被当作写入目标的变量名。 */
    const writeTargets = new Set<string>();
    for (const m of src.matchAll(
      /(?:fs\.)?write(?:File|FileSync)\(\s*(?<target>[A-Za-z0-9_$]+)/g,
    )) {
      const target = m.groups?.target;
      if (target !== undefined && target !== "") {
        writeTargets.add(target);
      }
    }
    for (const [name, baseline] of declared) {
      if (writeTargets.has(name)) {
        push(script, baseline);
      }
    }
    /** 直接把路径拼在写入调用里的写法（不走变量）也算，别给静默漏登记留第二形状。 */
    for (const m of src.matchAll(
      /(?:fs\.)?write(?:File|FileSync)\(\s*path\.join\([^;]{0,300}?"(?<baseline>\.[^"]+\.json)"/g,
    )) {
      const baseline = m.groups?.baseline;
      if (baseline !== undefined && baseline !== "") {
        push(script, baseline);
      }
    }
  }
  return [...found.values()].sort((a, b) => a.baseline.localeCompare(b.baseline));
}

/** 基线文件名 → 表里的行（`RATCHETS` 的 baseline 带目录前缀，这里按文件名对齐）。 */
function rowByBaseline(baseline: string): Ratchet | undefined {
  const name = baseline.split("/").pop() ?? baseline;
  return RATCHETS.find((r) => r.baseline.endsWith(name));
}

describe("棘轮的 --update 拒涨（台账 E5 的横切判据）", () => {
  /**
   * 跑一条棘轮用例，带上它自己登记的预算。要这层包装是因为 vitest 5 删了 `test(name, fn, {…})`
   * 第三参数写法（表现是整份 0 条用例直接失败），options 只能占第二位；而**没登记预算的行不能
   * 传 `{}`、更不能抄 `30_000`** —— 那会把全局 `testTimeout` 钉死本地（口径同 §11.13）。
   */
  function itRatchet(name: string, ratchet: Ratchet, body: () => void): void {
    /* 条件建测是这层包装的本职：vitest 5 删了三参写法、预算登记表又不许给未登记行
     * 传空 options（会钉死全局 testTimeout），两支只能各走各的签名。
     * 诊断锚定在 if 行（两支各计一次），禁用注明于此。 */
    // oxlint-disable-next-line vitest/no-conditional-tests -- 见上：vitest 5 签名分叉 + 预算登记约束
    if (ratchet.timeout === undefined) {
      it(name, body);
    } else {
      it(name, { timeout: ratchet.timeout }, body);
    }
  }

  for (const ratchet of RATCHETS) {
    itRatchet(`${ratchet.script}：--update 不许把基线往上涨，也不许偷偷落盘`, ratchet, () => {
      const handle = createGateRepo({
        script: ratchet.script,
        dir: ratchet.dir,
        ...ratchet.fixture,
      });
      const { repo } = handle;
      const judge = ratchet.judgeArgs ?? [];
      try {
        /* ① 造一条违规后 --update 必须成功并写出基线 —— 否则后面三步是在判一个空夹具。 */
        ratchet.violate(repo, 1);
        const seed = repo.run(["--update"]);
        expect(seed.code, seed.output).toBe(0);
        expect(repo.exists(ratchet.baseline)).toBe(true);
        const seeded = repo.read(ratchet.baseline);

        /* ② 基线等于现状时必须绿：不先看这一步，第 ④ 步的「非零」可能只是脚本自己跑挂了
         *（退出码与「拦住」逐字同形 —— 台账 E10 / E11 那一族）。 */
        const green = repo.run(judge);
        expect(green.code, green.output).toBe(0);

        /* ③ 再加一条违规必须红 —— 证明这个判据真的在数，而不是恒放行。 */
        ratchet.violate(repo, 2);
        const red = repo.run(judge);
        expect(
          red.code,
          `加第二条违规后判据仍放行，说明这条棘轮没在计数：\n${red.output}`,
        ).not.toBe(0);

        /* ④ 此时 --update 必须拦下，且基线一个字节都没变。 */
        const widen = repo.run(["--update"]);
        expect(
          widen.code,
          `--update 把新增的违规收进了基线（棘轮被放宽）：\n${widen.output}`,
        ).not.toBe(0);
        expect(repo.read(ratchet.baseline)).toBe(seeded);

        /* ⑥ 拒涨那句话必须给出**上涨态里可执行的下一步**。判话术而非退出码：
         * `check-tsc-diagnostic-executors.cjs` 落地时红话写「再跑 `--update`（=收紧基线）」，而
         * 同一旗标对上涨正是非零拒绝 —— 照跑只会再吃一红，真问题「谁执行这条声明」没被回答。
         * 只在 ④ 拦下的那条输出上判，即「拒涨那一刻说的话」；三种自洽写法清单在 helper 文件头。 */
        expectActionableRefusal(widen.output, ratchet.script);
      } finally {
        handle.dispose();
      }
    });

    itRatchet(`${ratchet.script}：基线已经清到 0 时也不许被 --update 放宽`, ratchet, () => {
      const handle = createGateRepo({
        script: ratchet.script,
        dir: ratchet.dir,
        ...ratchet.fixture,
      });
      const { repo } = handle;
      const judge = ratchet.judgeArgs ?? [];
      try {
        /* ⑤ 单独跑这一档：「治理做到 0」正是棘轮最该硬的时候，而 `if (before && after > before)`
         * 在基线总数 0 时整条短路、拒涨检查**根本不执行**（`check-ui-primitives` 今天基线是 0 处；
         * 先例见 `check-ui-logic-separation.cjs` 的 `diffAgainstBaseline`）。造法：干净沙箱 → 建
         * 「0」基线 → 再造一条违规 → `--update` 必须拒。 */
        const seed = repo.run(["--update"]);
        expect(seed.code, seed.output).toBe(0);
        expect(
          repo.exists(ratchet.baseline),
          `干净沙箱下 --update 没写出基线文件，这一档无从判起：\n${seed.output}`,
        ).toBe(true);

        ratchet.violate(repo, 1);
        expect(repo.run(judge).code, "空基线 + 一条违规必须红").not.toBe(0);

        const widen = repo.run(["--update"]);
        expect(
          widen.code,
          `基线为 0 时 --update 把第一条违规收进了基线（棘轮在最不该松的时候松着）：\n${widen.output}`,
        ).not.toBe(0);
      } finally {
        handle.dispose();
      }
    });
  }

  describe("完整性：每一个 --update 出口都要被五张归类表之一点名", () => {
    const found = discoveredBaselines();

    it("现算出的基线清单非空（脚本改动让正则失效时，本条要红而不是静默绿）", () => {
      expect(found.length).toBeGreaterThanOrEqual(RATCHETS.length);
    });

    it("每个带 --update 的落盘脚本都在表里、在本地用例册上、或登记为非棘轮", () => {
      const unclassified = found
        .map((f) => f.baseline)
        .filter(
          (b) =>
            !rowByBaseline(b) &&
            (COVERED_LOCALLY[b] === undefined || COVERED_LOCALLY[b] === "") &&
            (PENDING[b] === undefined || PENDING[b] === "") &&
            (RETIRED_RATCHETS[b] === undefined || RETIRED_RATCHETS[b] === "") &&
            (NOT_A_RATCHET[b] === undefined || NOT_A_RATCHET[b] === ""),
        );
      expect(
        unclassified,
        `这些判据脚本带 --update 且就地落盘基线，却没被任何一张表点名 —— ` +
          `要么补进 RATCHETS（配一条拒涨用例），要么在 PENDING / RETIRED_RATCHETS / ` +
          `NOT_A_RATCHET 里写下理由：\n${unclassified.join("\n")}`,
      ).toEqual([]);
    });

    it("PENDING 必须为空（新棘轮不许靠登记待办把自己变成「已知欠账」）", () => {
      /* 上限从 2 收到 0：它那两格本轮都配上了（一格进 RATCHETS、一格进
       * RETIRED_RATCHETS），再留一个「最多两格」的额度就等于给下一条棘轮
       * 预支一张免配票 —— 而这张票的代价恰恰是那条拒涨分支**没人钉过**。 */
      expect(
        Object.keys(PENDING),
        "待配清单必须为空：新增的棘轮在同一批里就把拒涨判据配好",
      ).toEqual([]);
    });

    it("死路那句话本身必须判红（反例钉子：新扩的分支不许把原始现场又放过去）", () => {
      /* `check-tsc-diagnostic-executors.cjs` 当年落地的就是这句：把上涨态出路指回同一个会 `exit 2`
       * 的旗标。判据后来扩到认四种形状（先改再 --update / 不给 --update / 人的动作 / 例外流程另
       * 给显式旗标），每次扩都可能放过这句，故钉成**否定式**：第四分支带 `--(?!update)`，认另一个
       * 认账旗标而不认把人推回 `--update`。断的是指令形状（一句能抄进终端的话），非具体措辞。 */
      const deadEnd =
        "出口：再跑 `node scripts/check-tsc-diagnostic-executors.cjs --update`" +
        "（= 把基线收紧到 60）";
      expect(deadEnd).not.toMatch(ACTIONABLE_REFUSAL);
    });

    it("COVERED_LOCALLY 点名的那份用例必须真判过「拒涨话给出路」这一半", () => {
      /* 这张表的语义是「沙箱造不出输入面，故由本地用例覆盖拒涨」。那四份原先只钉**退出码 + 一个
       * 短语**（`toContain("拒绝把基线往上涨")`），而「出路是不是死路」这半边只有 ⑥ 判过、⑥ 只跑
       * `RATCHETS` ——「表里点名了 = 判过了」是没有执行者的声明（§11.2.1 假保险的登记形态）。
       * 这里接上：被点名文件必须调用唯一实现 `tests/helpers/ratchet-refusal.ts`，故认符号名。 */
      const missing = Object.entries(COVERED_LOCALLY).filter(([, testFile]) => {
        const src = readFileSync(join(import.meta.dirname, "..", testFile), "utf8");
        return !/expectActionableRefusal\s*\(/.test(src);
      });
      expect(
        missing.map(([b, f]) => `${b} → ${f}`),
        "这几家被 COVERED_LOCALLY 归成「本地已覆盖」，但那份用例里没有一句在判" +
          "「拒涨那句话给出的是上涨态里可执行的下一步」：请调用 " +
          "`expectActionableRefusal(那次拒涨的输出, 脚本名)`",
      ).toEqual([]);
    });

    it("五张归类表里点名的基线文件必须还在（删了脚本却忘了删登记 = 下一格假绿灯）", () => {
      const listed = [
        ...RATCHETS.map((r) => r.baseline.split("/").pop() ?? r.baseline),
        ...Object.keys(COVERED_LOCALLY),
        ...Object.keys(PENDING),
        ...Object.keys(RETIRED_RATCHETS),
        ...Object.keys(NOT_A_RATCHET),
      ];
      const dir = join(import.meta.dirname, "..", "scripts");
      const present = new Set(readdirSync(dir));
      const stale = listed.filter((name) => !present.has(name));
      expect(stale, `这些登记项在 scripts/ 下已不存在：\n${stale.join("\n")}`).toEqual([]);
      /* 反向：现算出的每一个都要真在 found 里（防止表里写了个不存在的脚本名）。 */
      const known = new Set(found.map((f) => f.baseline));
      for (const name of Object.keys(PENDING)) {
        expect(known.has(name), `PENDING 里的 ${name} 不在现算清单里`).toBe(true);
      }
      for (const name of Object.keys(NOT_A_RATCHET)) {
        expect(known.has(name), `NOT_A_RATCHET 里的 ${name} 不在现算清单里`).toBe(true);
      }
      for (const name of Object.keys(RETIRED_RATCHETS)) {
        expect(known.has(name), `RETIRED_RATCHETS 里的 ${name} 不在现算清单里`).toBe(true);
      }
      for (const name of Object.keys(COVERED_LOCALLY)) {
        expect(known.has(name), `册上的 ${name} 不在现算清单里`).toBe(true);
      }
    });

    it("表里每一行的脚本与基线，现算清单都要能认出来（防止判据单方面退网）", () => {
      /**
       * 上面那条判「found ⊆ 五张归类表」，这一条判反向「表 ⊆ found」。只做正向有静默失效面：
       * 某家把落盘写法改成第三种形状（如经变量拼路径），现算清单少一行 —— 正向不红（少的行不在
       * found 里、无需归类），其 RATCHETS 行照样绿，这家拒涨**悄悄退出判决面**；双向则当场红。
       */
      for (const r of RATCHETS) {
        const name = r.baseline.split("/").pop() ?? r.baseline;
        expect(
          found.some((f) => f.script === r.script && f.baseline === name),
          `现算清单认不出 ${r.script} 会把 ${name} 写回去 —— ` +
            "要么落盘形状变了（判据退网），要么这一行该删（基线不再由它落盘）",
        ).toBe(true);
      }
    });

    it("RETIRED_RATCHETS 的理由必须可核：棘轮车道真的没有成员了", () => {
      /**
       * `RETIRED_RATCHETS` 每条都是**关于判据现状的断言**（「棘轮车道已无成员」），不是便签，得有
       * 东西核它：否则下批新判据按棘轮形态落地时，条目继续在册而那家真有一条棘轮、却没有五步用例。
       * 核法是问判据自己：`ratchetOnly()` 从真仓库算不出成员，用空 `src/` 沙箱问它比重列规则稳。
       */
      for (const name of Object.keys(RETIRED_RATCHETS)) {
        const row = found.find((f) => f.baseline === name);
        expect(row, `${name} 不在现算清单里`).toBeDefined();
        /* 问判据自己：**在干净沙箱里 `--update`**，读它落盘的那份基线。
         * 「棘轮车道已无成员」的机器形态就是「它写回去的 `rules` 是空对象」——
         * 棘轮那一支只登记非硬闸规则（见 `ratchetOnly()`）。 */
        const handle = createGateRepo({ script: row!.script, dirs: ["src"] });
        try {
          const seed = handle.repo.run(["--update"]);
          expect(seed.code, seed.output).toBe(0);
          /* 表里的 `baseline` 带目录前缀（用于 `discoveredBaselines` 对齐），
           * 而沙箱里脚本落点是 `scripts/`（`dir` 默认档），读回时要去掉前缀。 */
          const baselineRel = row!.baseline.split("/").pop() ?? row!.baseline;
          const written: unknown = JSON.parse(handle.repo.read(join("scripts", baselineRel)));
          /* 台账形状用运行时守卫收窄（B5 清账，不走 as 断言）。 */
          if (!isRecord(written) || !isRecord(written.rules)) {
            throw new Error("棘轮台账形状不对（缺 rules）");
          }
          expect(
            Object.keys(written.rules ?? {}),
            `${row!.script} 的棘轮车道又有成员了（--update 写回了非空 rules）——` +
              `这一条该从 RETIRED_RATCHETS 移回 RATCHETS 并配五步用例`,
          ).toEqual([]);
        } finally {
          handle.dispose();
        }
      }
    });

    it("`RETIRED_RATCHETS` 与 `HARD_GATE_FLIPS` 互斥，且前者的`--update` 出口必须真的还在", () => {
      /**
       * 两张表说两种相反现状：`RETIRED_RATCHETS` = 车道空置、**出口都还在**但写回空账；`HARD_GATE_FLIPS` =
       * **出口已删**、命中即退 1。同一判据不可能同属两者。2026-10-13 复审：`check-ui-primitives.cjs` 被文字
       * 说成已翻闸而基线与 `--update` 都在；分类可判 ⇒ 两表互斥 + 前者逐条核出「出口还在」即可挡回去。 */
      const dir = join(import.meta.dirname, "..", "scripts");

      /* ① 两表不许有交集（同一份基线同时说「出口已删」与「出口还在」= 自相矛盾）。
       *    `HARD_GATE_FLIPS` 的键是**脚本名**、值是自测文件，所以对齐要经 found 走一遍：
       *    认「这条翻闸脚本今天会写回去的那份基线」。 */
      const flipsBaselines = new Set(
        Object.keys(HARD_GATE_FLIPS).flatMap((script) =>
          found.filter((f) => f.script === script).map((f) => f.baseline),
        ),
      );
      const both = Object.keys(RETIRED_RATCHETS).filter((name) => flipsBaselines.has(name));
      expect(
        both,
        `这些基线同时在 RETIRED_RATCHETS 与 HARD_GATE_FLIPS 里 —— ` +
          `一张说「出口还在」、一张说「出口已删」，只可能有一张对：\n${both.join("\n")}`,
      ).toEqual([]);

      /* ② `RETIRED_RATCHETS` 的每一条：出口必须**真的还在**（基线在场 + 现算清单认得出
       *    它会把那份基线写回去）。出口没了 = 它其实是翻闸，该搬去 HARD_GATE_FLIPS。 */
      for (const name of Object.keys(RETIRED_RATCHETS)) {
        expect(
          existsSync(join(dir, name)),
          `${name} 的基线文件已经不在了 —— 那它不是「车道空置、出口还在」，` +
            `而是已经翻硬闸：这一条该从 RETIRED_RATCHETS 搬去 HARD_GATE_FLIPS`,
        ).toBe(true);
        expect(
          found.some((f) => f.baseline === name),
          `${name} 的 --update 落盘通道现算不出来了 —— 出口没了就不该留在 RETIRED_RATCHETS`,
        ).toBe(true);
      }
    });

    it("HARD_GATE_FLIPS 的否定式必须成立：基线文件已删、`--update` 落盘通道已删", () => {
      /**
       * 翻硬闸正确性有一半是否定式（「不再有放宽通道」），而否定式没有正面判据盯 —— 翻闸后脚本自然从
       * `discoveredBaselines()` 出网、五张表也不再点名。两格：**基线文件必须不在**、**脚本里不许再
       * 有把 `.json` 写回去的调用**（「有人把 `--update` 加回来」的唯一机器痕迹）。
       */
      const dir = join(import.meta.dirname, "..", "scripts");
      for (const [script, spec] of Object.entries(HARD_GATE_FLIPS)) {
        const src = readFileSync(join(dir, script), "utf8");
        /* 认「写一份 `.json`」本身而非变量名 —— 换拼法也躲不过；只认写入调用里的 `.json` 字面量
         * （读回来比对不算）。引号**三种都要认**：此前只认双引号（`"\.[^"]+\.json"`），一处写成
         * 单引号（`writeFileSync(path.join(ROOT,'scripts','.x.json'),'{}')`）的「把基线加回来」实测
         * 照绿 —— 否定式的洞恰在最易被重写的形式上。现在同时认 `'`/`"`/反引号，且不要求字符串以
         * 引号开头（路径可拼在中间）。 */
        const writesJson = [
          ...src.matchAll(/(?:fs\.)?write(?:File|FileSync)\((?<args>[^;]{0,400})/g),
        ].some((m) => /["'`][^"'`]*\.json["'`]/.test(m.groups?.args ?? ""));
        expect(
          writesJson,
          `${script} 里又出现了「把一份 .json 写回去」的调用 —— ` +
            "这一条已翻硬闸（基线删了、--update 删了），别把放宽通道加回来",
        ).toBe(false);
        /* 自测文件必须在（删了它 = 这一条翻闸后没人钉，照 COVERED_LOCALLY 的口径）。 */
        expect(
          existsSync(join(import.meta.dirname, "..", spec)),
          `${script} 翻硬闸时点名的自测 ${spec} 不存在`,
        ).toBe(true);
        /* 也不能再出现在现算清单里（出现 = 它又会写一份基线）。 */
        expect(
          found.some((f) => f.script === script),
          `${script} 又回到了现算清单（它会写一份基线）—— 翻硬闸的脚本不该再落盘`,
        ).toBe(false);
      }
    });

    it("表里每一行的脚本与基线都对得上真仓库（脚本改名/搬基线要同步改表）", () => {
      for (const r of RATCHETS) {
        const src = readFileSync(join(import.meta.dirname, "..", "scripts", r.script), "utf8");
        const name = r.baseline.split("/").pop() ?? r.baseline;
        expect(src, `${r.script} 不再落盘 ${name}`).toContain(`"${name}"`);
      }
    });
  });
});
