/**
 * 「每一个棘轮的 `--update` 都拒涨」这条**横切**判据（台账 E5）。
 *
 * 现场：本仓有若干「带 `--update` 且真把一份基线写回去」的判据脚本，各自在源码里写了一行
 * 「净数不许往上涨」的兜底。但**没有人判过那一行有没有生效** —— 把任意一个脚本的
 * 拒涨分支改成直接落盘（或删除它），全仓用例一个字都不会红，而那条棘轮就此变成
 * 「谁都能用一次 `--update` 悄悄放宽」的门面。这类「判据写了、但没被执行过」正是
 * §11.2.1 那一族里最贵的一格：它一次污染的是**整套棘轮**，不是一个文件。
 *
 * ## 为什么不能各家的测试文件里各加一条
 *
 * 那只能覆盖「已经写了用例的那几家」，而这条判据要的是**集合本身**：
 * 新增一个带 `--update` 与基线文件的判据脚本，如果没被归类，就必须在这里红一次
 * （`完整性：每一个 --update 出口都要被五张归类表之一点名` 那条用例）。
 * 抄 20 遍「搭临时仓库跑一次」的样板还会踩 §12.12 的孪生 —— 所以走
 * `tests/helpers/gate-repo.ts` 的命令式出口 `createGateRepo()`，表里每行只写
 * 「这条判据的违规长什么样」。
 *
 * ## 每行的判据（六条，缺一不可）
 *
 * 1. 造一条违规 → `--update` 必须成功，且基线文件出现（**夹具不是空转**）；
 * 2. 基线=现状时不带 `--update` 跑一次必须**绿** —— 否则第 4 步的「非零」可能只是
 *    脚本自己跑挂了（退出码同形，这是台账 E10/E11 那一族）；
 * 3. 再加一条违规 → 不带 `--update` 必须**红**（证明这个判据真的在计数，而不是一律放行）；
 * 4. 此时 `--update` 必须**非零退出，且基线一个字节都没变**（既拦下、也不落盘）；
 * 5. 再单独跑一档「基线已清到 0」：`if (before && after > before)` 这类写法在 `before=0`
 *    时整条短路、拒涨分支根本不执行，而「治理到 0」恰恰是最不该松的那一刻；
 * 6. 第 4 步那句**拒涨的话本身**要给出可执行的下一步（先改再 `--update` / 明说不要用
 *    `--update` / 改成人的手工登记 / 例外流程另给一个显式认账旗标 —— 四种形状的清单与
 *    为什么这么分，只住在 `tests/helpers/ratchet-refusal.ts` 的文件头）。
 *
 *    第 6 步的实现只有一份，`COVERED_LOCALLY` 那四家的本地用例也调它 ——
 *    那张表写的是「本地已覆盖拒涨」，而原先那四份钉的都是退出码加一个短语，
 *    「出路是不是死路」这半边没有执行者（见下面 `COVERED_LOCALLY 点名的那份用例…` 那条）。
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { createGateRepo, type GateRepo, type GateRepoOptions } from "./helpers/gate-repo";
import { expectActionableRefusal, ACTIONABLE_REFUSAL } from "./helpers/ratchet-refusal";

/** 一条棘轮的完整描述：脚本、基线落点、夹具输入、以及「怎么再加一条违规」。 */
interface Ratchet {
  script: string;
  /** 基线相对**工作区根**的路径（脚本落 scripts/ 时它落在 scripts/ 下）。 */
  baseline: string;
  /** 脚本在工作区里的落点（与 `createGateRepo` 同义，这里显式写出来便于核对基线路径）。 */
  dir?: "scripts" | "root";
  fixture?: Pick<GateRepoOptions, "dirs" | "env" | "files" | "copy" | "setup">;
  /**
   * 「判定档」的命令行参数 —— 不带 `--update` 的那一次跑。
   *
   * 多数判据的默认档就是判定档（`[]`），但 `--check` 型工具（tw4 那两份）默认档是
   * **报告**、永远退 0：用默认档判第 ②/③ 步会得到「加第二条违规仍然绿」，
   * 而那判的是「我没把判定档打开」，不是棘轮。
   */
  judgeArgs?: Array<string>;
  /**
   * 这条棘轮的单次预算（毫秒）。
   *
   * 起 Tailwind 引擎的那两家单次约 5s，一格要跑 3–4 次 —— 全局 30s 在并发下会被顶穿
   * （口径同 §11.13：真进程慢到贴边就登记实测值，不让它去撞默认档）。
   */
  timeout?: number;
  /** 加第 `n` 条违规；实现必须让「第 n+1 条」让计数**严格变大**（不同文件名，别覆盖上一条）。 */
  violate: (repo: GateRepo, n: number) => void;
}

/** AST 类判据在临时工作区旁边没有 node_modules，靠 NODE_PATH 指回源码仓库。 */
const AST_ENV = { NODE_PATH: join(process.cwd(), "node_modules") };

const RATCHETS: Array<Ratchet> = [
  {
    script: "check-void-floats.cjs",
    baseline: "scripts/.void-floats-baseline.json",
    fixture: { dirs: ["src/lib"], env: AST_ENV },
    violate: (repo, n) =>
      repo.write(
        `src/lib/vf${n}.ts`,
        `async function vf${n}(): Promise<void> {}\nvoid vf${n}();\n`,
      ),
  },
  /* 这里**没有** tw4 那两份（`tw4-canonical-report.mjs` / `tw4-spacing-canonical.mjs`）：
   * 它们在 ISSUE #1811 的 tw4 项里翻了硬闸 —— 基线删掉、`--update` 删掉，`--check`
   * 命中即退 1，于是「拒涨」在这两家**无对象可判**（没有基线可写回去，
   * 这一张表的现算清单 `discoveredBaselines()` 也就认不出它们了）。
   * 它们的硬闸形态由 `tests/tw4-canonical-ratchet.test.ts` 守形状、由
   * `tests/tw4-hardgate-behaviour.test.ts` 守行为。 */
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
  /* client chunk 体积预算（ISSUE #1781）：它的输入是 `next build` 的产物目录，且
   * 带「产物不存在就跳过、文件数低于下限就判红」两道边界 —— 套不进表里那条
   * 「干净沙箱 → `--update` 必须写出基线」的第 ⑤ 步（干净沙箱里没有 `.next`，
   * 本脚本按设计打「跳过」退 0、**不写基线**）。它的拒涨与「掏空基线应变红」
   * 由本地用例 `tests/check-bundle-budget.test.ts` 覆盖（造够下限的 chunk 后
   * 先 --update 落一份基线的等价形态）。 */
  ".bundle-budget-baseline.json": "tests/check-bundle-budget.test.ts",
  /* 脚本档类型检查的账本（ISSUE #2524 / 规范 §13.5.14.1）：它的沙箱**不是**这张表那五步的
   * 形状 —— 那五步把判据脚本**拷进**临时工作区再跑，而这一档的工具本体必须留在真仓库里
   * （`typescript` 与它的 `lib/tsc.js` 按脚本自己的位置解析），跟着拷走的只有「被判决的那棵树」
   * （`COMFY_SCRIPTS_TYPECHECK_ROOT` 注入根，口径同 `DOC_RENDER_ROOT` / ISSUE #2415）。
   * 本地用例实测过「新增格子 ⇒ 红」「`--update` 拒涨 ⇒ 红且**一个字节都不写回基线**」，
   * 并调 `expectActionableRefusal` 判那句话给出路（那五步与这一半都齐，只是换了载体）。 */
  ".scripts-typecheck-baseline.json": "tests/scripts-typecheck-ratchet.test.ts",
};

/**
 * 待配：判据写了拒涨那一支，但今天没有任何行为用例钉过。
 *
 * **现在为空，而且判据是「必须为空」**（见下面那条用例）—— 这张表只该在
 * 「某条棘轮刚落地、行为用例还没跟上」的那一小段时间里非空。留着它的意义是
 * 让那段空窗**被指名**（而不是让一条没被钉过的拒涨分支混在 21 格里看不见），
 * 不是给「懒得配用例」一个永久的出口。
 *
 * 曾经的两格怎么清的：
 *   · `.file-size-baseline.json` —— 卡点写着「沙箱里放一份 950 行文件会连带命中
 *     R1–R12 其它规则、第 ② 步配不出来」。拆开看：连带命中是真的（缺
 *     `src/proxy.ts` 时 R11 当场红），但那份文件是**可配的输入**，
 *     把 R1–R12 都喂绿第 ② 步就成立 —— 于是它进了 `RATCHETS`，夹具里带
 *     `src/proxy.ts`。
 *   · `.ui-primitives-baseline.json` —— 卡点写着「拒涨按 rule id 比较，要先把
 *     rule 集合钉住」。本轮实测：`HARD_GATE_RULES` 已覆盖全部 85 条，
 *     `ratchetOnly()` 的返回恒为空 —— **棘轮那条车道上一个成员都没有**，
 *     于是「拒涨」在这一家无对象可判（`--update` 写回去的永远是一份空账）。
 *     它不该按「还没配用例」记账，而该按「判据已整条升硬闸、棘轮车道空置」
 *     记账 —— 见下面 `RETIRED_RATCHETS`。
 */
const PENDING: Record<string, string> = {};

/**
 * 已退出棘轮车道、**只剩硬闸**的判据（基线文件仍在、`--update` 仍是个出口，
 * 但它写回去的永远是一份空账）。
 *
 * 与 `NOT_A_RATCHET` 的差别：那里是「加条目本就是正常用法」，这里是
 * 「棘轮形态本身被淘汰了」—— 两条路都不该走五步拒涨判据，理由却完全不同，
 * 所以分两张表。**这一张只许增不许减**（把它退回 PENDING 等于假装还有存量）。
 */
const RETIRED_RATCHETS: Record<string, string> = {
  ".ui-primitives-baseline.json":
    "85 条判据全部在 HARD_GATE_RULES 里（`ratchetOnly()` 恒返回空），棘轮车道已无成员；`--update` 写回去的永远是空账，拒涨无对象可判",
};

/**
 * **已翻硬闸**的棘轮（ISSUE #1811 收尾那一批）：基线文件已删、`--update` /
 * `--strict` 已从脚本里删掉，命中即退 1。
 *
 * 为什么这张表必须存在（而不是「翻了就完事」）：翻闸的正确性有一半是**否定式**
 * 的 —— 「这条判据不再有任何放宽通道」。而否定式没有任何**正面**判据会盯：
 * `discoveredBaselines()` 现算的是「带 `--update` 且写回基线」的脚本，翻闸之后
 * 它们自然出网、五张归类表也都不再点名它们 —— 于是「有人把基线加回去 + 把 `--update`
 * 也加回去」在**这一个文件里**不会有任何反应（它只会重新出现在 found 里，
 * 而那时五张归类表里恰好也没有它 → 完整性那一格才会红。这一格是把那条路的**前半段**
 * 也钉住：脚本里既不该有那份基线，也不该有 `--update` 的写入通道）。
 *
 * 值 = 那条判据的 **自测文件**（照 `COVERED_LOCALLY` 的口径点名，删了它会红）。
 */
const HARD_GATE_FLIPS: Record<string, string> = {
  /* ── 第一至五刀翻的那一批（ISSUE #1811 前半段）────────────────────────────
   * 这十条**此前不在这张表里** —— 表是第六刀才建的，而它当时只登记了「从它自己
   * 那一刀起」的翻闸，前四刀翻的那些一直只靠各自的自测守形态。
   * 缺口的后果正是这张表存在的理由：把 `--update` 与基线通道加回
   * `check-dead-exports.cjs`，正面判据一格都不会红（它已从 `discoveredBaselines()`
   * 出网、五张归类表也都不点名它）。收尾时按 git 里「已删的基线文件」反查补齐：
   * 每一个「基线已删 + 脚本里已无 `.json` 落盘通道」的判据都该在册。
   * 它们的自测都已断言硬闸形态（基线不存在、`--update` 不落盘 JSON），所以补进来
   * 不会产生假红 —— 补的是**否定式的机器痕迹**。 */
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
  /* tw4 这一项（ISSUE #1811 的 tw4 半边）：与上面五条同一形状，只是它守的是
   * 「CSS 等价改写」而不是违规计数 —— 清零后棘轮无对象可判，留着基线只等于多一条
   * 「手改 JSON 把新候选登记成已知存量」的通道。两刀改到同一张表，合并后**两条都在**：
   * R5 与 tw4 各自是一条翻闸记录，删掉任意一条都会让那一刀退网。
   * 自测点名 `tw4-canonical-ratchet`（形状）：行为那一半在同名的
   * `tests/tw4-hardgate-behaviour.test.ts`，不进这张表 —— 这张表的值是「删了它会红
   * 的那一份」，而形状那份同时守着台账登记与判定档在位。 */
  "tw4-canonical-report.mjs": "tests/tw4-canonical-ratchet.test.ts",
  "tw4-spacing-canonical.mjs": "tests/tw4-canonical-ratchet.test.ts",
};

/** 不是计数棘轮的 `--update` 出口：加条目是它的正常用法，拒涨反而错。理由必须写在册子上。 */
const NOT_A_RATCHET: Record<string, string> = {
  ".gate-executor-ledger.json": "判据执行者台账：新增一条判据就该新增一个条目，这是登记表不是棘轮",
};

/**
 * 从真仓库里现算「哪些脚本带 `--update` 且**把某份基线写回去**」—— 不抄第二份清单。
 *
 * 认「写回去」而不是认「脚本里出现过这份基线名」：`check-tsc-diagnostic-executors.cjs`
 * 会读姊妹索引 `.declaration-readers.json` 做逐行同源核对，但它的 `--update` 一支只写
 * 自己那份台账。按「出现过」算等于把**别人读的登记表**判成本脚本的 `--update` 出口，
 * 于是这条判据会开始报不存在的东西 —— 判据一旦误报，下一次「真的漏登记」就被当成
 * 又一轮噪声（§11.18.4「会误报的判据活不过一次评审」）。
 */
function discoveredBaselines(): Array<{ script: string; baseline: string }> {
  const dir = join(import.meta.dirname, "..", "scripts");
  /** 键 = `脚本:基线名`（两者都不含冒号），去重用 Map 而不是拼哨兵字符串。 */
  const found = new Map<string, { script: string; baseline: string }>();
  const push = (script: string, baseline: string) =>
    found.set(`${script}:${baseline}`, { script, baseline });

  for (const script of readdirSync(dir)) {
    if (!/\.(cjs|mjs)$/.test(script)) {
      continue;
    }
    const src = readFileSync(join(dir, script), "utf8");
    if (!src.includes("--update")) {
      continue;
    }

    /**
     * `const LEDGER = path.join(<根变量>, …, ".x.json")` 这类声明。
     *
     * 根变量**不钉死成 `__dirname`**：`path.join(ROOT, "scripts", …)`、`path.join(HERE, …)`
     * 都是同一条落盘通道（tw4 那两份与 `check-dependency-audit` 就是这么写的），
     * 而按「以什么变量当根」去筛等于把判据的覆盖面绑在一种拼法上 —— 换拼法就静默出网。
     * 认「这一段里第一个以 `.` 开头、以 `.json` 结尾的字面量」：目录段不会以 `.` 开头，
     * 所以这个形状没有歧义。
     */
    const declared = new Map<string, string>();
    for (const m of src.matchAll(
      /(?:const|let|var)\s+([A-Za-z0-9_$]+)\s*=\s*path\.join\(([^;]{0,300}?)\)/g,
    )) {
      const name = m[1];
      const baseline = /"(\.[^"]+\.json)"/.exec(m[2] ?? "")?.[1];
      if (name && baseline) {
        declared.set(name, baseline);
      }
    }
    /** 真被当作写入目标的变量名。 */
    const writeTargets = new Set<string>();
    for (const m of src.matchAll(/(?:fs\.)?write(?:File|FileSync)\(\s*([A-Za-z0-9_$]+)/g)) {
      if (m[1]) {
        writeTargets.add(m[1]);
      }
    }
    for (const [name, baseline] of declared) {
      if (writeTargets.has(name)) {
        push(script, baseline);
      }
    }
    /** 直接把路径拼在写入调用里的写法（不走变量）也算，别给静默漏登记留第二形状。 */
    for (const m of src.matchAll(
      /(?:fs\.)?write(?:File|FileSync)\(\s*path\.join\([^;]{0,300}?"(\.[^"]+\.json)"/g,
    )) {
      const baseline = m[1];
      if (baseline) {
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
   * 跑一条棘轮用例，带上它自己登记的预算。
   *
   * 为什么要这一层包装而不是每次都传 options：vitest 5 起 `test(name, fn, {…})` 那种
   * 第三参数写法被删掉了（表现是整份文件 0 条用例直接失败），而 options 只能在第二参数位；
   * 但**没有登记预算的行不能在这里传 `{}`**，更不能抄一个 `30_000` —— 那等于把全局
   * `testTimeout` 钉死在本地，配置文件以后调档这一族不会跟着动（口径同 §11.13）。
   */
  function itRatchet(name: string, ratchet: Ratchet, body: () => void): void {
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

        /* ⑥ 拒涨那句话必须给出**上涨态里可执行的下一步**。
         *
         * 判的对象是话术而不是退出码：`check-tsc-diagnostic-executors.cjs` 落地时红话写着
         * 「再跑 `--update`（= 把基线收紧到 N）」，而同一个 `--update` 对上涨正是非零拒绝 ——
         * 照它跑只会再吃一次红，真问题（「这条声明由谁执行」）一次都没被回答。
         * 这条只在 ④ 已经拦下的那条输出上判，所以判的是「拒涨那一刻说的话」，
         * 不是脚本里随便哪句提到旗标的注释。三种自洽写法的清单在 helper 文件头。 */
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
        /* ⑤ 这一档单独跑，是因为「治理做到 0」正是棘轮最该硬的时候，而它有一种
         * 共同的失效写法：`if (before && after > before)` —— 基线总数为 0 时整个条件
         * 短路，拒涨检查**根本不执行**（`check-ui-primitives` 今天的基线是 0 处；
         * 口径与非 --update 路径共用的先例见
         * `check-ui-logic-separation.cjs` 的 `diffAgainstBaseline` 注释）。
         * 干净沙箱 → 先建立一份「0」基线 → 再造一条违规 → --update 必须拒。 */
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
            !COVERED_LOCALLY[b] &&
            !PENDING[b] &&
            !RETIRED_RATCHETS[b] &&
            !NOT_A_RATCHET[b],
        );
      expect(
        unclassified,
        `这些判据脚本带 --update 且就地落盘基线，却没被任何一张表点名 —— ` +
          `要么补进 RATCHETS（配一条拒涨用例），要么在 PENDING / RETIRED_RATCHETS / ` +
          `NOT_A_RATCHET 里写下理由：\n` +
          unclassified.join("\n"),
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
      /* `check-tsc-diagnostic-executors.cjs` 当年落地的就是这一句 —— 它把上涨态的出路
       * 指回同一个会 `exit 2` 拒绝这个方向的旗标。这条判据后来被扩到认四种形状
       *（先改再 --update / 明说不要用·不给 --update / 人的动作 / 例外流程另给一个显式旗标），
       * 每扩一次都可能顺手把这句放过去，所以把它钉成**否定式**期望：
       * 第四个分支带的是 `--(?!update)`，认「另一个认账旗标」而不认把人推回 `--update`。
       * 断的是**指令的形状**（一句真能被抄进终端的话），不是某个脚本的具体措辞。 */
      const deadEnd =
        "出口：再跑 `node scripts/check-tsc-diagnostic-executors.cjs --update`" +
        "（= 把基线收紧到 60）";
      expect(deadEnd).not.toMatch(ACTIONABLE_REFUSAL);
    });

    it("COVERED_LOCALLY 点名的那份用例必须真判过「拒涨话给出路」这一半", () => {
      /* 这张表的语义是「沙箱造不出它们的输入面，所以由本地用例覆盖拒涨」——
       * 实测那四份本地用例原先钉的都是**退出码 + 句子里的一个短语**
       *（`toContain("拒绝把基线往上涨")` 那一形），而「那条出路是不是死路」这半边
       * 只有上面第 ⑥ 步判过、而 ⑥ 只跑 `RATCHETS`。于是「表里点名了 = 判过了」
       * 是一句没有执行者的声明，正是 §11.2.1 那一族（假保险的登记形态）。
       * 这里把它接上：被点名的文件必须调用那份唯一实现（`tests/helpers/ratchet-refusal.ts`），
       * 判的是「有没有这个执行者」，所以认符号名而不是认某句措辞或某种行形状。 */
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
       * 上面那条判「found ⊆ 五张归类表」，这一条判反向「表 ⊆ found」。
       *
       * 只做正向会有一个静默失效面：把某家的落盘写法改成第三种形状（比如经由一个
       * 变量拼路径），现算清单就少一行 —— 正向那条不会红（少的那一行不在 found 里，
       * 无需归类），而它的 RATCHETS 行照样绿，于是这一家的拒涨**悄悄退出了判决面**。
       * 双向配上，形状漂移就当场红。
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
       * `RETIRED_RATCHETS` 的每一条都是一句**关于判据现状的断言**（「棘轮车道已无成员」），
       * 而不是一个「暂时先这么记着」的便签。既然它是断言，就得有东西核它 —— 否则
       * 下一批新判据按棘轮形态落地（先冻结存量、再清零，那正是这条判据鼓励的顺序）
       * 时，这个条目会继续在册、而那家**真有一条棘轮**却没有五步用例。
       *
       * 核的方式是问判据自己而不是抄一份规则清单：`check-ui-primitives.cjs` 的
       * `ratchetOnly()` 现在从真仓库里算不出任何成员。用一个空 `src/` 沙箱问它，
       * 比在用例里重列一遍 `HARD_GATE_RULES` 稳（后者会随每次升闸漂）。
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
          const written = /* SAFETY: 类型断言已复核 */ JSON.parse(
            handle.repo.read(join("scripts", baselineRel)),
          ) as { rules?: Record<string, unknown> };
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
       * 这两张表在说**两种相反的现状**：
       *   · `RETIRED_RATCHETS` = 「棘轮车道空置，但**出口都还在**，只是写回去的是空账」；
       *   · `HARD_GATE_FLIPS`  = 「**出口已经删了**，命中即退 1」。
       *
       * 同一条判据不可能同时是两者。这一格此前不存在，而它缺的后果 2026-10-13 的复审
       * 里现了一回：`check-ui-primitives.cjs` 被 §11.25.1 那句「按判据整条升硬闸记进
       * `RETIRED_RATCHETS`」说成了已翻闸 —— 而它的基线文件与 `--update` 都还在。
       * **那句文字没有任何判据会红**（文字不可判），但「它属于哪一类」这件事可以：
       * 只要两张表互斥、且 `RETIRED_RATCHETS` 的每一条都被核出「出口真的还在」，
       * 「把它说成已翻闸」就再也写不进去 —— 要么它进 `HARD_GATE_FLIPS`（那时基线必须
       * 真的不在），要么留在这里（那时基线必须真的在）。
       */
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
       * 翻硬闸的正确性有一半是否定式的（「不再有任何放宽通道」），而否定式没有
       * 正面判据会盯 —— 翻闸之后这些脚本自然从 `discoveredBaselines()` 出网、
       * 五张归类表也都不再点名它们。两格：**那份基线文件必须不在**、
       * **脚本里不许再出现把 `.json` 写回去的调用**。
       *
       * 第二格是「有人把 `--update` 加回来」的唯一机器痕迹：加回来必然带一处
       * 落盘调用（`fs.writeFileSync(<…>.json, …)`），而这一格里看得见。
       */
      const dir = join(import.meta.dirname, "..", "scripts");
      for (const [script, spec] of Object.entries(HARD_GATE_FLIPS)) {
        const src = readFileSync(join(dir, script), "utf8");
        /* 认「写一份 .json」这件事本身，而不是认某个变量名 —— 换拼法也躲不过。
         * 只认写入调用里出现的 `.json` 字面量（读回来比对不算）。
         *
         * 引号**三种都要认**：这条判据此前只认双引号（`"\.[^"]+\.json"`），
         * 于是一处写成单引号（`writeFileSync(path.join(ROOT,'scripts','.x.json'),'{}')`）
         * 的「把基线加回来」实测**照绿** —— 否定式的洞恰恰在它最容易被人重写的形式上。
         * 现在同时认 `'` / `"` / 反引号，且不要求字符串以引号开头（路径可以拼在中间）。 */
        const writesJson = [
          ...src.matchAll(/(?:fs\.)?write(?:File|FileSync)\(([^;]{0,400})/g),
        ].some((m) => /["'`][^"'`]*\.json["'`]/.test(m[1] ?? ""));
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
