/**
 * 「每一个棘轮的 `--update` 都拒涨」这条**横切**判据（台账 E5）。
 *
 * 现场：本仓有 20 个「基线 + `--update` 就地落盘」的判据脚本，各自在源码里写了一行
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
 * ## 每行的判据（四条，缺一不可）
 *
 * 1. 造一条违规 → `--update` 必须成功，且基线文件出现（**夹具不是空转**）；
 * 2. 基线=现状时不带 `--update` 跑一次必须**绿** —— 否则第 4 步的「非零」可能只是
 *    脚本自己跑挂了（退出码同形，这是台账 E10/E11 那一族）；
 * 3. 再加一条违规 → 不带 `--update` 必须**红**（证明这个判据真的在计数，而不是一律放行）；
 * 4. 此时 `--update` 必须**非零退出，且基线一个字节都没变**（既拦下、也不落盘）。
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  createGateRepo,
  type GateRepo,
  type GateRepoOptions,
} from "./helpers/gate-repo";

/** 一条棘轮的完整描述：脚本、基线落点、夹具输入、以及「怎么再加一条违规」。 */
interface Ratchet {
  script: string;
  /** 基线相对**工作区根**的路径（脚本落 scripts/ 时它落在 scripts/ 下）。 */
  baseline: string;
  /** 脚本在工作区里的落点（与 `createGateRepo` 同义，这里显式写出来便于核对基线路径）。 */
  dir?: "scripts" | "root";
  fixture?: Pick<GateRepoOptions, "dirs" | "env" | "files" | "copy">;
  /** 加第 `n` 条违规；实现必须让「第 n+1 条」让计数**严格变大**（不同文件名，别覆盖上一条）。 */
  violate: (repo: GateRepo, n: number) => void;
}

/** AST 类判据在临时工作区旁边没有 node_modules，靠 NODE_PATH 指回源码仓库。 */
const AST_ENV = { NODE_PATH: join(process.cwd(), "node_modules") };

/** 函数体行数超过阈值（阈值的唯一来源是脚本自己，这里只保证「一定超」）。 */
function longFunction(name: string, bodyLines: number): string {
  return (
    `export function ${name}() {\n` +
    Array.from({ length: bodyLines }, (_, i) => `  const v${i} = ${i};`).join(
      "\n",
    ) +
    `\n}\n`
  );
}

const RATCHETS: Ratchet[] = [
  {
    script: "check-function-length.cjs",
    baseline: "scripts/.function-length-baseline.json",
    fixture: { dirs: ["src"] },
    violate: (repo, n) =>
      repo.write(`src/big${n}.ts`, longFunction(`big${n}`, 450)),
  },
  {
    script: "check-rust-function-length.cjs",
    baseline: "scripts/.rust-function-length-baseline.json",
    fixture: { dirs: ["src-tauri/src"] },
    violate: (repo, n) =>
      repo.write(
        `src-tauri/src/r${n}.rs`,
        `fn big${n}() {\n` +
          Array.from({ length: 140 }, (_, i) => `  let _${i} = ${i};`).join(
            "\n",
          ) +
          `\n}\n`,
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
    script: "check-dead-exports.cjs",
    baseline: ".dead-exports-baseline.json",
    dir: "root",
    fixture: {
      dirs: ["src/lib", "src/trpc", "src/components", "scripts", "tests"],
    },
    violate: (repo, n) =>
      repo.write(
        `src/lib/orphan${n}.ts`,
        `export function orphan${n}(): number {\n  return ${n};\n}\n`,
      ),
  },
  {
    script: "check-circular-deps.cjs",
    baseline: ".circular-deps-baseline.json",
    dir: "root",
    fixture: { dirs: ["src", "scripts"] },
    violate: (repo, n) => {
      repo.write(
        `src/loop${n}a.ts`,
        `import { b${n} } from "./loop${n}b";\nexport const a${n} = b${n};\n`,
      );
      repo.write(
        `src/loop${n}b.ts`,
        `import { a${n} } from "./loop${n}a";\nexport const b${n} = a${n};\n`,
      );
    },
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
     * 孪生判据的违规形状是「两份 ≥60 行、逐行重合 ≥75%」—— 单文件写不出违规，
     * 所以每一档写**一对**，且每对的变量名带上档位序号：四份内容全同的文件会被
     * 数成 C(4,2)=6 对，计数照样涨但涨幅不可预期，判「净数不许放宽」时就不是在判一件事了。
     */
    script: "check-code-duplication.cjs",
    baseline: "scripts/.code-duplication-baseline.json",
    fixture: { dirs: ["src"] },
    violate: (repo, n) => {
      const body = Array.from(
        { length: 60 },
        (_, i) => `export const dup${n}v${i} = ${i};`,
      ).join("\n");
      repo.write(`src/dup${n}a.ts`, `// 孪生对夹具第 ${n} 对\n${body}\n`);
      repo.write(`src/dup${n}b.ts`, `// 孪生对夹具第 ${n} 对\n${body}\n`);
    },
  },
  {
    script: "check-theme-colors.cjs",
    baseline: "scripts/.theme-color-baseline.json",
    fixture: { dirs: ["src"] },
    violate: (repo, n) =>
      repo.write(
        `src/Palette${n}.ts`,
        `/** 第 ${n} 处写死色值（没走 token）。 */\nexport const COLOR${n} = "#ff880${n % 10}";\n`,
      ),
  },
];

/**
 * 判据自己写了拒涨那一支、且**已有本地行为用例**钉过的棘轮（值 = 那份用例）。
 * 列在这里而不是搬进上面的表，是为了不在两处重复跑同一家的沙箱；
 * 但「它在不在册」这件事仍由完整性那条用例判 —— 删掉本地用例而不改这张表会红。
 */
const COVERED_LOCALLY: Record<string, string> = {
  ".format-baseline.json": "tests/check-format.test.ts",
  ".click-keyboard-baseline.json": "tests/click-keyboard-gate.test.ts",
  ".form-field-wiring-baseline.json": "tests/form-field-wiring-gate.test.ts",
  ".gate-repo-boilerplate-baseline.json":
    "tests/gate-repo-boilerplate-gate.test.ts",
  ".test-it-each-baseline.json": "tests/test-it-each-gate.test.ts",
  ".test-sleep-baseline.json": "tests/test-sleep-gate.test.ts",
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

/** 从真仓库里现算「哪些脚本带 --update 且就地落盘一份基线」——不抄第二份清单。 */
function discoveredBaselines(): Array<{ script: string; baseline: string }> {
  const dir = join(import.meta.dirname, "..", "scripts");
  const rows: Array<{ script: string; baseline: string }> = [];
  for (const script of readdirSync(dir)) {
    if (!/\.(cjs|mjs)$/.test(script)) continue;
    const src = readFileSync(join(dir, script), "utf8");
    if (!src.includes("--update")) continue;
    for (const m of src.matchAll(
      /path\.join\(\s*__dirname\s*,\s*"(\.[^"]+\.json)"\s*\)/g,
    )) {
      const baseline = m[1];
      // 正则只在带上捕获组的那一形命中，取不到名字说明形状变了 ——
      // 那种情况由「现算清单非空」那一格兜，不在这里塞一个空基线名。
      if (!baseline) continue;
      rows.push({ script, baseline });
    }
  }
  return rows.sort((a, b) => a.baseline.localeCompare(b.baseline));
}

/** 基线文件名 → 表里的行（`RATCHETS` 的 baseline 带目录前缀，这里按文件名对齐）。 */
function rowByBaseline(baseline: string): Ratchet | undefined {
  const name = baseline.split("/").pop() ?? baseline;
  return RATCHETS.find((r) => r.baseline.endsWith(name));
}

describe("棘轮的 --update 拒涨（台账 E5 的横切判据）", () => {
  for (const ratchet of RATCHETS) {
    it(`${ratchet.script}：--update 不许把基线往上涨，也不许偷偷落盘`, () => {
      const handle = createGateRepo({
        script: ratchet.script,
        dir: ratchet.dir,
        ...ratchet.fixture,
      });
      const { repo } = handle;
      try {
        /* ① 造一条违规后 --update 必须成功并写出基线 —— 否则后面三步是在判一个空夹具。 */
        ratchet.violate(repo, 1);
        const seed = repo.run(["--update"]);
        expect(seed.code, seed.output).toBe(0);
        expect(repo.exists(ratchet.baseline)).toBe(true);
        const seeded = repo.read(ratchet.baseline);

        /* ② 基线等于现状时必须绿：不先看这一步，第 ④ 步的「非零」可能只是脚本自己跑挂了
         *（退出码与「拦住」逐字同形 —— 台账 E10 / E11 那一族）。 */
        const green = repo.run();
        expect(green.code, green.output).toBe(0);

        /* ③ 再加一条违规必须红 —— 证明这个判据真的在数，而不是恒放行。 */
        ratchet.violate(repo, 2);
        const red = repo.run();
        expect(
          red.code,
          `加第二条违规后判据仍放行，说明这条棘轮没在计数`,
        ).not.toBe(0);

        /* ④ 此时 --update 必须拦下，且基线一个字节都没变。 */
        const widen = repo.run(["--update"]);
        expect(
          widen.code,
          `--update 把新增的违规收进了基线（棘轮被放宽）：\n${widen.output}`,
        ).not.toBe(0);
        expect(repo.read(ratchet.baseline)).toBe(seeded);
      } finally {
        handle.dispose();
      }
    });

    it(`${ratchet.script}：基线已经清到 0 时也不许被 --update 放宽`, () => {
      const handle = createGateRepo({
        script: ratchet.script,
        dir: ratchet.dir,
        ...ratchet.fixture,
      });
      const { repo } = handle;
      try {
        /* ⑤ 这一档单独跑，是因为「治理做到 0」正是棘轮最该硬的时候，而它有一种
         * 共同的失效写法：`if (before && after > before)` —— 基线总数为 0 时整个条件
         * 短路，拒涨检查**根本不执行**（`check-theme-colors` 与 `check-ui-primitives`
         * 今天的基线都是 0 处；口径与非 --update 路径共用的先例见
         * `check-ui-logic-separation.cjs` 的 `diffAgainstBaseline` 注释）。
         * 干净沙箱 → 先建立一份「0」基线 → 再造一条违规 → --update 必须拒。 */
        const seed = repo.run(["--update"]);
        expect(seed.code, seed.output).toBe(0);
        expect(
          repo.exists(ratchet.baseline),
          `干净沙箱下 --update 没写出基线文件，这一档无从判起：\n${seed.output}`,
        ).toBe(true);

        ratchet.violate(repo, 1);
        expect(repo.run().code, "空基线 + 一条违规必须红").not.toBe(0);

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
