/**
 * tw4 两份「CSS 等价改写」判据的**硬闸行为**自检（ISSUE #1811 的 tw4 项）。
 *
 * 为什么这一族需要**行为**用例，而不是只有 `tests/tw4-canonical-ratchet.test.ts`
 * 那份形态守卫：那一份读的是文本（判定档在不在、放宽通道有没有被加回来），它
 * **判不出**「判定档真的会退 1」—— 一个把 `--check` 分支写成永远 `exit(0)` 的
 * 版本同样能满足「`--check` 在场 + 有 `process.exit(1)` 字样」。这里把两份工具
 * 当黑盒跑在临时工作区上，正面钉住：
 *
 *   · 干净输入 → 判定档退 0；
 *   · 塞一条真候选 → 判定档退 1，且点出是哪个文件；
 *   · 注释里的示例（`!bg-subtle` 与下面夹具那条 px 任意值）**不算**候选 —— 这是
 *     `tw4-scan-core.mjs` 剥注释那一层的回归；
 *   · `--update` 这个出口已经不存在：传了既不落盘 JSON、也不放宽判定（断头用例）。
 *
 * 为什么夹具要链 `node_modules`：这两份是 **ESM** 的 `import "tailwindcss"`，而
 * `NODE_PATH` 对 ESM 解析无效（只按脚本自身位置向上找）——链一份回真仓库是唯一
 * 走得通的路（`symlinkDir` = Windows 免特权那一档）。`src/app/globals.css` 是
 * design system 的输入，缺它脚本直接 ENOENT。
 *
 * 单次预算：起 Tailwind 引擎约 5s，一格跑 1–2 次，按实测登记（口径同 §11.13）。
 */
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect } from "vitest";
import { defineGateRepo, type GateRepo, type GateRepoOptions } from "./helpers/gate-repo";
import { symlinkDir } from "./helpers/symlink-dir";

/** 起引擎的实测单次预算（口径同 §11.13：真进程慢到贴边就登记实测值）。 */
const ENGINE_TIMEOUT = 120_000;

/**
 * 样本类名运行期拼：`tests/**` 也在 Tailwind 的扫描面里，本文件写全一枚候选名，
 * 产物里就多一条谁都不用的规则（口径见 `tests/docs-candidate-hygiene.test.ts`）。
 * 夹具真正要的是**写进临时仓那份文件里**的完整形状 —— 临时仓不在扫描面内。
 */
const PX_LITERAL_CLASS = "h-" + "[22px]";

/**
 * 「判定档退 1 且**点名是哪个文件**」这条断言的读法。
 *
 * 两份工具打的是 `path.relative()` 的结果，Windows 上就是 `src\Dirty.tsx`，
 * 而这一格要钉的是**有没有点名**、不是路径分隔符。从前它写成
 * `toContain("src/Dirty.tsx")`，于是在 Windows 检出上恒红：本地钩子拦下每一个
 * 提交，而 PR 是平台侧 squash 合并、不跑钩子，#623 之后也没有 CI 兜底 ——
 * 这条红是**直接从 master 落进仓库**的。与台账 R12-01「判据不许假定读者的 git
 * 配置」同一族：**判据也不许假定读者的路径分隔符**。
 */
function namesFile(output: string, relPosix: string): boolean {
  return output.replaceAll("\\", "/").includes(relPosix);
}

/** 两份工具的公共夹具：`scripts/` 落点 + globals.css + 链回来的 node_modules。 */
function tw4Fixture(script: string): GateRepoOptions {
  return {
    script,
    dirs: ["src"],
    copy: [{ from: "src/app/globals.css", to: "src/app/globals.css" }],
    setup: (repo: GateRepo) =>
      symlinkDir(join(process.cwd(), "node_modules"), join(repo.dir, "node_modules")),
  };
}

/** 临时工作区 `scripts/` 下现存的基线 JSON（判「`--update` 有没有落盘」用）。 */
function baselinesIn(root: string): Array<string> {
  const dir = join(root, "scripts");
  if (!existsSync(dir)) {
    return [];
  }
  return readdirSync(dir).filter((name) => name.endsWith(".json"));
}

/* `defineGateRepo` 返回的是「扩展过 repo fixture 的 test」+ vitest 本来的 expect ——
 * 两份工具各要一套夹具，所以各起一个 test；expect 从 vitest 直接来（同一份）。 */
const { test: canonicalTest } = defineGateRepo(tw4Fixture("tw4-canonical-report.mjs"));
const { test: spacingTest } = defineGateRepo(tw4Fixture("tw4-spacing-canonical.mjs"));

describe("tw4-canonical-report 硬闸", () => {
  canonicalTest(
    "干净输入：判定档退 0",
    ({ repo }) => {
      repo.write("src/Clean.tsx", `export const cls = "bg-subtle";\n`);
      const r = repo.run(["--check"]);
      expect(r.code, r.output).toBe(0);
      expect(r.output).toContain("0 处");
    },
    ENGINE_TIMEOUT,
  );

  canonicalTest(
    "一条真候选即阻断（源文件里的类名会被应用，须为 0）",
    ({ repo }) => {
      repo.write("src/Dirty.tsx", `export const cls = "!bg-subtle";\n`);
      const r = repo.run(["--check"]);
      expect(r.code).toBe(1);
      expect(namesFile(r.output, "src/Dirty.tsx"), r.output).toBe(true);
    },
    ENGINE_TIMEOUT,
  );

  canonicalTest(
    "注释里的示例不算候选（剥注释那一层的回归钉）",
    ({ repo }) => {
      /* 这正是 `repository-row.ts` 报出 `` `!row` `` 的形态：反引号引的示例
       * 在注释里，与 className 同形。修好之后它必须一条都数不出来。 */
      repo.write(
        "src/Comment.tsx",
        `// 先前写成 \`!bg-subtle\`，已改为后缀形态\nexport const cls = "bg-subtle!";\n`,
      );
      const r = repo.run(["--check"]);
      expect(r.code, r.output).toBe(0);
    },
    ENGINE_TIMEOUT,
  );

  canonicalTest(
    "`--update` 这个出口**已经不存在**：既不落盘 JSON、也不放宽判定（断头用例）",
    ({ repo }) => {
      repo.write("src/Dirty.tsx", `export const cls = "!bg-subtle";\n`);
      const r = repo.run(["--update"]);
      // `--update` 不再是已知旗标：它被当普通参数，判定档照跑（这里没带 `--check`
      // 就走默认报告档，退 0），而**关键是它一个字节都没写回去**。
      expect(baselinesIn(repo.dir)).toEqual([]);
      expect(r.code).toBe(0);
      /* 再走判定档：候选还在，仍然被拦 —— 「传了 --update 就放过」这条路不存在。 */
      const check = repo.run(["--check"]);
      expect(check.code).toBe(1);
      expect(baselinesIn(repo.dir)).toEqual([]);
    },
    ENGINE_TIMEOUT,
  );
});

describe("tw4-spacing-canonical 硬闸", () => {
  spacingTest(
    "干净输入：判定档退 0",
    ({ repo }) => {
      repo.write("src/Clean.tsx", `export const cls = "h-5";\n`);
      const r = repo.run(["--check"]);
      expect(r.code, r.output).toBe(0);
    },
    ENGINE_TIMEOUT,
  );

  spacingTest(
    "一条真候选即阻断（px 任意值等价于 spacing 倍数）",
    ({ repo }) => {
      repo.write("src/Dirty.tsx", `export const cls = "${PX_LITERAL_CLASS}";\n`);
      const r = repo.run(["--check"]);
      expect(r.code).toBe(1);
      expect(namesFile(r.output, "src/Dirty.tsx"), r.output).toBe(true);
    },
    ENGINE_TIMEOUT,
  );

  spacingTest(
    "注释里的示例不算候选（`--write` 也不会去改它）",
    ({ repo }) => {
      repo.write(
        "src/Comment.tsx",
        `// 此前写成 \`${PX_LITERAL_CLASS}\`\nexport const cls = "h-5.5";\n`,
      );
      const check = repo.run(["--check"]);
      expect(check.code, check.output).toBe(0);
      repo.run(["--write"]);
      expect(repo.read("src/Comment.tsx")).toContain(`此前写成 \`${PX_LITERAL_CLASS}\``);
    },
    ENGINE_TIMEOUT,
  );

  spacingTest(
    "`--update` 这个出口**已经不存在**（断头用例）",
    ({ repo }) => {
      repo.write("src/Dirty.tsx", `export const cls = "${PX_LITERAL_CLASS}";\n`);
      repo.run(["--update"]);
      expect(baselinesIn(repo.dir)).toEqual([]);
      const check = repo.run(["--check"]);
      expect(check.code).toBe(1);
      expect(baselinesIn(repo.dir)).toEqual([]);
    },
    ENGINE_TIMEOUT,
  );
});
