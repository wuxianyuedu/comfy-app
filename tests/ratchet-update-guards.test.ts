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
 * （`完整性：每一个 --update 出口都要被三张表之一点名` 那条用例）。
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
 *    `--update` / 改成人的手工登记）—— 退出码判对了、话术把人指向一条自己会拒绝的命令，
 *    同样是在教人绕开判据（`check-tsc-diagnostic-executors.cjs` 就是这样落地的）。
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  createGateRepo,
  type GateRepo,
  type GateRepoOptions,
} from "./helpers/gate-repo";
import { symlinkDir } from "./helpers/symlink-dir";

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
  judgeArgs?: string[];
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

/**
 * 起 Tailwind 引擎的那两家（`tw4-canonical-report` / `tw4-spacing-canonical`）不能靠
 * `NODE_PATH`：它们是 ESM 的 `import "tailwindcss"`，而 **`NODE_PATH` 对 ESM 解析无效**，
 * 解析只按脚本自身位置向上找 `node_modules`。所以夹具链一份回真仓库（`symlinkDir` =
 * Windows 免特权那一档），另把 `src/app/globals.css` 作为输入拷进去 —— design system 的
 * spacing 倍数表就来自那文件的 `@theme`，缺它脚本直接 ENOENT。
 *
 * `dispose()` 的 `rmSync(recursive)` 把链接当文件 unlink、不穿透（实测真 `node_modules`
 * 完好），所以链进来的东西不会被删掉。
 */
function linkNodeModules(repo: GateRepo): void {
  symlinkDir(
    join(process.cwd(), "node_modules"),
    join(repo.dir, "node_modules"),
  );
}

/** 上面那两家的共同夹具输入（都要 globals.css 才建得起 design system）。 */
const TW4_FIXTURE: Pick<GateRepoOptions, "dirs" | "copy" | "setup"> = {
  dirs: ["src"],
  copy: [{ from: "src/app/globals.css", to: "src/app/globals.css" }],
  setup: linkNodeModules,
};

const RATCHETS: Ratchet[] = [
  /* 基础设施层的**文件**长度棘轮（§12.6 R5 的姊妹档）：R5 / 函数长度 / 非空断言 /
   * 孪生对四类债务判据的扫描根都只有 `src`，判据自己那一层（`scripts/**` 的 .cjs/.mjs
   * 与 `tools/**` 的 .ps1，约 43k 行）因此在自己的硬闸之外。它配得进这张表而不是
   * PENDING —— 沙箱里造一条违规只碰它自己这一条规则：R5 那份之所以进 PENDING，
   * 是因为同一脚本里 950 行的探针会连带命中 R1–R12 其它规则，第 ② 步配不出来。 */
  {
    script: "check-infra-file-size.cjs",
    baseline: "scripts/.infra-file-size-baseline.json",
    fixture: { dirs: ["scripts", "tools"] },
    violate: (repo, n) =>
      repo.write(
        `scripts/big${n}.cjs`,
        `// 拆分候选\n`.repeat(905) + `module.exports = ${n};\n`,
      ),
  },
  {
    script: "check-non-null-assertions.cjs",
    baseline: "scripts/.non-null-assertions-baseline.json",
    fixture: { dirs: ["src"], env: AST_ENV },
    violate: (repo, n) =>
      repo.write(
        `src/nn${n}.ts`,
        `export function nn${n}(x?: string): string {\n  return x!;\n}\n`,
      ),
  },
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
  {
    script: "check-overlay-z.cjs",
    baseline: "scripts/.overlay-z-baseline.json",
    fixture: {
      dirs: ["src/components/studio", "src/components/ui", "src/app"],
    },
    /**
     * 落点必须**避开 `src/components/ui/`** —— 那是脚本自己的豁免目录（shadcn 生成件，
     * §16.1）。把违规写进豁免目录会得到「加第二条仍然绿」，而那判的是豁免而不是棘轮。
     */
    violate: (repo, n) =>
      repo.write(
        `src/components/studio/Overlay${n}.tsx`,
        `export function Overlay${n}() {\n  return <div style={{ zIndex: ${n + 40} }} />;\n}\n`,
      ),
  },
  {
    script: "check-ui-logic-separation.cjs",
    baseline: "scripts/.ui-logic-baseline.json",
    fixture: { dirs: ["src/components"] },
    violate: (repo, n) =>
      repo.write(
        `src/components/Net${n}.tsx`,
        `export function Net${n}(): Promise<Response> {\n  return fetch("/api/x${n}");\n}\n`,
      ),
  },
  {
    script: "check-comment-language.cjs",
    baseline: "scripts/.comment-language-baseline.json",
    fixture: {
      dirs: ["src/lib"],
      copy: [{ from: "scripts/doc-facts.cjs", to: "scripts/doc-facts.cjs" }],
      files: {
        "docs/.keep": "",
        "docs/reference-facts.md":
          "# refs\n\n| `comment.language.asciiOnly` |  | 白名单 | 本行 | 解析本行 |\n",
      },
    },
    violate: (repo, n) =>
      repo.write(
        `src/lib/en${n}.ts`,
        `/** Combine the input parameters and fall back to defaults. */\nexport const en${n} = ${n};\n`,
      ),
  },
  {
    /**
     * 「按需跑」的两份棘轮（不进 pre-commit，所以**更**需要行为判据：钩子里那几档
     * 至少天天响，这一族今天没有任何东西在钉它的 `--update`）。
     * 它们的文件头一直写着「只许降不许升」，而 `--update` 那一支今天是无条件落盘 ——
     * 台账 E5 的同一形状，由本判据的现算清单照出来（旧的自测只 `toContain("--update")`，
     * 那判的是「旗标在场」，不是「旗标拒涨」）。
     */
    script: "tw4-canonical-report.mjs",
    baseline: "scripts/.tw4-canonical-baseline.json",
    judgeArgs: ["--check"],
    /* 实测单次 4.8–5.6s（每次都重新起 design system），一格 3–4 次 → 全局 30s 会顶穿。 */
    timeout: 120_000,
    fixture: TW4_FIXTURE,
    violate: (repo, n) =>
      repo.write(
        `src/Canonical${n}.tsx`,
        `export const cls${n} = "!bg-subtle";\n`,
      ),
  },
  {
    script: "tw4-spacing-canonical.mjs",
    baseline: "scripts/.tw4-spacing-baseline.json",
    judgeArgs: ["--check"],
    fixture: TW4_FIXTURE,
    violate: (repo, n) =>
      repo.write(`src/Spacing${n}.tsx`, `export const h${n} = "h-[22px]";\n`),
  },
];

/**
 * 判据自己写了拒涨那一支、且**已有本地行为用例**钉过的棘轮（值 = 那份用例）。
 * 列在这里而不是搬进上面的表，是为了不在两处重复跑同一家的沙箱；
 * 但「它在不在册」这件事仍由完整性那条用例判 —— 删掉本地用例而不改这张表会红。
 */
const COVERED_LOCALLY: Record<string, string> = {
  ".format-baseline.json": "tests/check-format.test.ts",
  ".form-field-wiring-baseline.json": "tests/form-field-wiring-gate.test.ts",
  ".gate-repo-boilerplate-baseline.json":
    "tests/gate-repo-boilerplate-gate.test.ts",
  ".test-sleep-baseline.json": "tests/test-sleep-gate.test.ts",
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
};

/** 待配：判据写了拒涨那一支，但今天没有任何行为用例钉过（**只许减，不许增**）。 */
const PENDING: Record<string, string> = {
  ".file-size-baseline.json":
    "沙箱里放一份 950 行的文件会连带命中同脚本的 R1–R12 其它规则，四步里的第 ② 步（基线=现状时必须是绿的）先配不出来",
  ".ui-primitives-baseline.json":
    "它的拒涨按 rule id 比较，而「旧基线里没有这个 rule id」既被当成正当的判据引入、又是今天 0 处基线上新增违规的形状 —— 要先把 rule 集合本身钉住才能配拒涨判据",
};

/** 不是计数棘轮的 `--update` 出口：加条目是它的正常用法，拒涨反而错。理由必须写在册子上。 */
const NOT_A_RATCHET: Record<string, string> = {
  ".gate-executor-ledger.json":
    "判据执行者台账：新增一条判据就该新增一个条目，这是登记表不是棘轮",
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
    if (!/\.(cjs|mjs)$/.test(script)) continue;
    const src = readFileSync(join(dir, script), "utf8");
    if (!src.includes("--update")) continue;

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
      if (name && baseline) declared.set(name, baseline);
    }
    /** 真被当作写入目标的变量名。 */
    const writeTargets = new Set<string>();
    for (const m of src.matchAll(
      /(?:fs\.)?write(?:File|FileSync)\(\s*([A-Za-z0-9_$]+)/g,
    )) {
      if (m[1]) writeTargets.add(m[1]);
    }
    for (const [name, baseline] of declared) {
      if (writeTargets.has(name)) push(script, baseline);
    }
    /** 直接把路径拼在写入调用里的写法（不走变量）也算，别给静默漏登记留第二形状。 */
    for (const m of src.matchAll(
      /(?:fs\.)?write(?:File|FileSync)\(\s*path\.join\([^;]{0,300}?"(\.[^"]+\.json)"/g,
    )) {
      const baseline = m[1];
      if (baseline) push(script, baseline);
    }
  }
  return [...found.values()].sort((a, b) =>
    a.baseline.localeCompare(b.baseline),
  );
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
    itRatchet(
      `${ratchet.script}：--update 不许把基线往上涨，也不许偷偷落盘`,
      ratchet,
      () => {
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
           * 三种自洽写法都算通过：**先改再 --update**（把顺序写明）、**明说不要用
           * `--update`**（把这条堵死）、**改成人的动作**（手工登记 / 逐条写理由）。
           * 这条只在 ④ 已经拦下的那条输出上判，所以判的是「拒涨那一刻说的话」，
           * 不是脚本里随便哪句提到旗标的注释。 */
          expect(
            widen.output,
            `${ratchet.script}：--update 拒涨了，但红话没给出可执行的下一步`,
          ).toMatch(
            /先[\s\S]{0,240}?(再|之后)[\s\S]{0,60}--update|不要用\s*`?--update`?|`?--update`?\s*(是|只用于|不能拿来|拒绝)|(手工|逐条)[\s\S]{0,60}(登记|改|写)/,
          );
        } finally {
          handle.dispose();
        }
      },
    );

    itRatchet(
      `${ratchet.script}：基线已经清到 0 时也不许被 --update 放宽`,
      ratchet,
      () => {
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
      },
    );
  }

  describe("完整性：每一个 --update 出口都要被三张表之一点名", () => {
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
            !NOT_A_RATCHET[b],
        );
      expect(
        unclassified,
        `这些判据脚本带 --update 且就地落盘基线，却没被任何一张表点名 —— ` +
          `要么补进 RATCHETS（配一条拒涨用例），要么在 PENDING / NOT_A_RATCHET 里写下理由：\n` +
          unclassified.join("\n"),
      ).toEqual([]);
    });

    it("PENDING 只许减不许增（新棘轮不许靠登记待办把自己变成「已知欠账」）", () => {
      const ceiling = 2;
      expect(
        Object.keys(PENDING).length,
        `待配清单只剩 ${ceiling} 格的上限，多出来的那一格必须直接配用例`,
      ).toBeLessThanOrEqual(ceiling);
    });

    it("三张表里点名的基线文件必须还在（删了脚本却忘了删登记 = 下一格假绿灯）", () => {
      const listed = [
        ...RATCHETS.map((r) => r.baseline.split("/").pop() ?? r.baseline),
        ...Object.keys(COVERED_LOCALLY),
        ...Object.keys(PENDING),
        ...Object.keys(NOT_A_RATCHET),
      ];
      const dir = join(import.meta.dirname, "..", "scripts");
      const present = new Set(readdirSync(dir));
      const stale = listed.filter((name) => !present.has(name));
      expect(
        stale,
        `这些登记项在 scripts/ 下已不存在：\n${stale.join("\n")}`,
      ).toEqual([]);
      /* 反向：现算出的每一个都要真在 found 里（防止表里写了个不存在的脚本名）。 */
      const known = new Set(found.map((f) => f.baseline));
      for (const name of Object.keys(PENDING)) {
        expect(known.has(name), `PENDING 里的 ${name} 不在现算清单里`).toBe(
          true,
        );
      }
      for (const name of Object.keys(NOT_A_RATCHET)) {
        expect(
          known.has(name),
          `NOT_A_RATCHET 里的 ${name} 不在现算清单里`,
        ).toBe(true);
      }
      for (const name of Object.keys(COVERED_LOCALLY)) {
        expect(known.has(name), `册上的 ${name} 不在现算清单里`).toBe(true);
      }
    });

    it("表里每一行的脚本与基线，现算清单都要能认出来（防止判据单方面退网）", () => {
      /**
       * 上面那条判「found ⊆ 三张表」，这一条判反向「表 ⊆ found」。
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

    it("表里每一行的脚本与基线都对得上真仓库（脚本改名/搬基线要同步改表）", () => {
      for (const r of RATCHETS) {
        const src = readFileSync(
          join(import.meta.dirname, "..", "scripts", r.script),
          "utf8",
        );
        const name = r.baseline.split("/").pop() ?? r.baseline;
        expect(src, `${r.script} 不再落盘 ${name}`).toContain(`"${name}"`);
      }
    });
  });
});
