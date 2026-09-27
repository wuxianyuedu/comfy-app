/**
 * 门禁脚本里写成**字符串字面量**的仓库路径，必须真实存在。
 *
 * 动因（本轮真实撞到的两类，都不是假想）：
 *   · `check-theme-colors.cjs` 的色值豁免清单里有一条指向
 *     `src/components/studio/canvas/WorkflowCanvasDecorations.tsx` —— 那个路径下从来没有
 *     文件（真身在 `src/components/studio/` 下，另有一条给它的豁免）。**豁免项指错不会
 *     报错**：它只是从此不再豁免任何东西，而下一次有人把那个组件改名搬走，清单上这条
 *     依旧「看起来在守着什么」。这类静默失效和「登记的基线红路径写错」是同一种病。
 *   · `check-ui-primitives.cjs` 的改法提示里曾写着「Empty / Field 基元未装 → 去
 *     `shadcn add`」，而两个基元早就装好 —— 提示会指挥人做错事。
 *
 * 两条判据口径：
 *   1. **只看字符串字面量、剥掉注释**。注释里出现旧路径往往是**有意叙述历史**
 *      （如「自某次拆分起 `src/lib/app-settings.ts` 拆成目录」），那不是缺陷；
 *      写成字符串的路径则是要拿去比对/豁免/提示的，指错就是失效。
 *   2. **扫描面自动发现**（`scripts/check-*.cjs` 全量），不维护清单 —— 手写清单
 *      本身就是会漂的那类东西。另留一组锚点字面量，既证明「自动发现真的收到了这些
 *      脚本」，也让提交前的增量测试层在改到它们时把本文件拉进 C 组（§13.5.8 的
 *      「按路径引用」判据）。
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(import.meta.dirname, "..");
const SCRIPTS_DIR = path.join(ROOT, "scripts");

/** 锚点：只用于「自动发现没漏」与增量层的显式绑定，不作为扫描面的来源。 */
const ANCHOR_SCRIPTS = [
  "scripts/check-theme-colors.cjs",
  "scripts/check-ui-primitives.cjs",
  "scripts/check-dead-exports.cjs",
  "scripts/check-file-structure.cjs",
];

const PATH_RE =
  /["'`]((?:src|tests|scripts|docs|tools|e2e)\/[A-Za-z0-9_./-]*\.(?:ts|tsx|mts|js|jsx|mjs|cjs|json|css|md|py|ps1|rs))["'`]/g;

/**
 * 剥掉块注释与行注释。
 *
 * 行注释用「前面不是 `:`/字母」的判据避开 `https://` 这类 URL 里的 `//`；
 * 字符串里的 `#` 与 URL 不参与本判据，所以宁可少剥也不误剥代码。
 */
export function stripComments(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:\\])\/\/[^\n]*/g, "$1");
}

/** 一份源码里作为字符串字面量出现的仓库路径（已去重）。 */
export function quotedRepoPaths(text: string): string[] {
  const out = new Set<string>();
  for (const m of stripComments(text).matchAll(PATH_RE)) {
    if (m[1]) out.add(m[1]);
  }
  return [...out];
}

function gateScripts() {
  return readdirSync(SCRIPTS_DIR)
    .filter((f) => /^check-.*\.cjs$/.test(f))
    .map((f) => `scripts/${f}`);
}

describe("门禁脚本里的路径字面量必须存在", () => {
  const scripts = gateScripts();

  it("扫描面自动发现，且锚点脚本都在其中", () => {
    /* 现实测 26 条；门槛取 20：门禁脚本只会增多，掉下来说明发现逻辑或
     * `check-*` 命名约定变了 —— 那时本判据的扫描面就是空的。 */
    expect(scripts.length).toBeGreaterThan(20);
    for (const anchor of ANCHOR_SCRIPTS) {
      expect(scripts, `锚点脚本没被自动发现：${anchor}`).toContain(anchor);
    }
  });

  it("全部 check-*.cjs 的路径字面量都解析得到", () => {
    const dead = [];
    let seen = 0;
    for (const rel of scripts) {
      const paths = quotedRepoPaths(readFileSync(path.join(ROOT, rel), "utf8"));
      seen += paths.length;
      for (const p of paths) {
        if (!existsSync(path.join(ROOT, p))) dead.push(`${rel} → ${p}`);
      }
    }
    /* 自证：扫描面没匹配到任何路径字面量时，上面的空清单断言是**空转**
     * （同 `check-dead-exports` 对「清单为空」的警惕，也同本仓库那条
     * 「永远返回空的扫描器会让断言全绿」）。实测 26 个 check-*.cjs 里共
     * 111 条路径字面量，门槛取 50 —— 掉下去意味着提取形态变了，不是「变干净了」。 */
    expect(seen, "一条路径字面量都没扫到：判据形态或写法变了").toBeGreaterThan(
      50,
    );
    expect(
      dead,
      `这些路径被门禁当数据用（豁免项 / 比对目标 / 改法提示），但仓库里没有：\n  ${dead.join("\n  ")}\n` +
        "要么改成真存在的路径，要么删掉这条已经指不到东西的记录（留着 = 假装在守）",
    ).toEqual([]);
  });

  it("假路径判为不存在、真路径判为存在（上面那条不是空转）", () => {
    const src = [
      'const ok = "scripts/check-ui-primitives.cjs";',
      'const gone = "src/components/studio/canvas/DefinitelyNotThere.tsx";',
      "// 注释里的历史路径不算：src/lib/app-settings.ts",
      'const url = "https://example.com/src/not/a/path.ts";',
    ].join("\n");
    const found = quotedRepoPaths(src);
    expect(found).toContain("scripts/check-ui-primitives.cjs");
    expect(found).toContain(
      "src/components/studio/canvas/DefinitelyNotThere.tsx",
    );
    expect(
      found,
      "注释里的旧路径不该进判据面（那多半是在叙述历史）",
    ).not.toContain("src/lib/app-settings.ts");
    expect(found.filter((p) => !existsSync(path.join(ROOT, p))).length).toBe(1);
  });
});
