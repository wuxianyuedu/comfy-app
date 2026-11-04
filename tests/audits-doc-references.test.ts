/**
 * `docs/audits/**` 的引用漂移判据（ISSUE #1811 遗留项）：台账不在 `doc:check` 的 SCOPED_DOC_DIRS 面内，点名已删基线不会变红。
 * 只判能证明的一半：台账写了一份已删的 `scripts/.*-baseline.json` 且同行未明写历史快照（名单从 `git log --diff-filter=D` 现算）。
 * 不判路径存在（会假红：`src-tauri/static` 构建产物、`docs/standards/12` 章节号、沿革叙述）；git 带 `-- scripts/` 后 13.3s→3.3s。
 */
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(import.meta.dirname, "..");
const AUDITS_DIR = path.join(ROOT, "docs", "audits");

/** 台账目录下参与判定的文件（`.md` 一份文件一份台账；`.dot` 是图，无路径引用形态）。 */
function auditFiles(): Array<string> {
  return readdirSync(AUDITS_DIR)
    .filter((f) => f.endsWith(".md"))
    .map((f) => path.join("docs", "audits", f))
    .sort();
}

/**
 * 现算「曾入库、今天已不在」的 scripts 基线文件名。只算文件名（台账里全路径与裸名两种写法都有）。
 * 用 `--all`：基线可能在别的分支上删的（squash 合并后进主线），只读 HEAD 会漏。
 * `git` 不可用（浅检出 / 无 git 沙箱）时退化成空集 —— 那是「判据面为空」不是「全绿」，有专门用例判红。
 */
/** 模块级 memo：整份文件最多走一趟 git（每条用例都重算是白付 I/O）。 */
let retiredCache: Array<string> | null = null;

function retiredBaselineNames(): Array<string> {
  if (retiredCache) {
    return retiredCache;
  }
  let out;
  try {
    out = execFileSync(
      "git",
      [
        "log",
        "--all",
        "--diff-filter=D",
        "--name-only",
        "--pretty=format:",
        // 只要 scripts/ 那一层：下面按名字筛的就是 `scripts/.…baseline….json`。
        // 实测 13.3s → 3.3s，而结果集逐字相等（见文件头那一节）。
        "--",
        "scripts/",
      ],
      { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
    );
  } catch {
    return [];
  }
  const names = new Set<string>();
  for (const raw of out.split("\n")) {
    const rel = raw.trim();
    if (!rel) {
      continue;
    }
    if (!/^scripts\/\.[^/]*baseline[^/]*\.json$/.test(rel)) {
      continue;
    }
    names.add(path.basename(rel));
  }
  retiredCache = [...names].sort();
  return retiredCache;
}

/** 当年那份台账写下的「这是历史快照 / 已经没有了」的显式口径。 */
const HISTORICAL_MARKERS = [
  "已删",
  "均已删",
  "已不存在",
  "已收掉",
  "当日快照",
  "当日",
  "已退役",
  "已下线",
];

/**
 * 台账里出现的基线文件名。两种写法都认：`scripts/.x-baseline.json` 与裸的 `.x-baseline.json`；
 * 归一化成**带前导点**的 basename，与 `retiredBaselineNames()` 同一把尺子 —— 不归一会让
 * 「`scripts/.a-baseline.json`」被分组吃掉前导点，两边对不上而静默出网。
 */
function citedBaselineNames(line: string): Array<string> {
  const out = new Set<string>();
  for (const m of line.matchAll(/(\.?[A-Za-z0-9_-]*baseline[A-Za-z0-9_-]*\.json)/g)) {
    const name = m[1];
    if (name !== undefined && name !== "") {
      out.add(name.startsWith(".") ? name : `.${name}`);
    }
  }
  return [...out];
}

type Finding = { baseline: string; file: string; line: number; text: string };

/**
 * 判据本体：出现「已删基线 + 该行没有历史口径」。抽成纯函数好让用例造两个方向：
 * 真仓库跑一遍（反向锚点：判据面非空），再用合成文本跑「该红则红 / 带历史口径则该绿」。
 */
function findRetiredBaselineClaims(
  files: Array<{ rel: string; text: string }>,
  retired: Set<string>,
): Array<Finding> {
  const found: Array<Finding> = [];
  for (const { rel, text } of files) {
    text.split(/\r?\n/).forEach((line, i) => {
      if (HISTORICAL_MARKERS.some((m) => line.includes(m))) {
        return;
      }
      for (const name of citedBaselineNames(line)) {
        if (!retired.has(name)) {
          continue;
        }
        found.push({
          file: rel,
          line: i + 1,
          baseline: name,
          text: line.trim(),
        });
      }
    });
  }
  return found;
}

describe("docs/audits/** 的台账引用不许漂到已删的棘轮基线上", () => {
  it(
    "台账里点名一份已删基线时，必须当场写明它是历史快照",
    /* 预算带实测出处（§13.6.4 不许静默抬预算）：本条承担整趟历史遍历 —— 加了
     * `-- scripts/` pathspec 之后那趟 git 实测 3.3s（不带是 13.3s，结果集逐字相等），
     * 而这条用例在本机争用下实测 20.2s。全局 `testTimeout` 是 30s，对一份**挂在固定清单**
     * 里的判据太薄：贴边时的红是时间红、不是内容红，而它拦住的是所有人的提交。
     * 下一个改这个数的人请先复测（`--no-file-parallelism` 单跑本文件），别顺手删。 */
    { timeout: 90_000 },
    () => {
      const retired = new Set(retiredBaselineNames());
      const files = auditFiles().map((rel) => ({
        rel,
        text: readFileSync(path.join(ROOT, rel), "utf8"),
      }));
      const bad = findRetiredBaselineClaims(files, retired);
      expect(
        bad.map((b) => `${b.file}:${b.line} 点名已删基线 ${b.baseline}（同一行没有历史口径）`),
      ).toEqual([]);
    },
  );

  /**
   * 判据面**非空**：守的是最坏失效形态 —— `git` 不可用时 `retiredBaselineNames()` 退化成空集，
   * 上面那条会**恒绿**而看上去「台账很干净」。所以正面断言「本仓库今天确实有已删基线」；
   * 不断言 `git` 能跑（那是环境断言，改不了就把人堵在提交上）—— 断言事实才是判据成立的前提。
   */
  it("判据面非空：仓库历史里确实有已删的棘轮基线（否则上面那条在空转）", () => {
    const retired = retiredBaselineNames();
    expect(retired.length).toBeGreaterThan(0);
    expect(retired).toContain(".dead-exports-baseline.json");
  });

  /** 合成文本：该红的形态必须红（不靠真仓库里恰好存在的那几处）。 */
  it("合成文本：点名已删基线且无历史口径 → 红", () => {
    const bad = findRetiredBaselineClaims(
      [
        {
          rel: "docs/audits/x.md",
          text: "见基线 `scripts/.gone-baseline.json`。",
        },
      ],
      new Set([".gone-baseline.json"]),
    );
    expect(bad).toHaveLength(1);
    expect(bad[0]?.baseline).toBe(".gone-baseline.json");
  });

  /** 合成文本：带历史口径的如实记述必须放过（否则沿革叙述全被误报）。 */
  it("合成文本：同一行写明「已删 / 当日快照」→ 绿", () => {
    for (const marker of HISTORICAL_MARKERS) {
      const bad = findRetiredBaselineClaims(
        [
          {
            rel: "docs/audits/x.md",
            text: `当日 \`scripts/.gone-baseline.json\`（${marker}）`,
          },
        ],
        new Set([".gone-baseline.json"]),
      );
      expect(bad, `marker=${marker}`).toEqual([]);
    }
  });

  /** 合成文本：**还在**的基线不许被误报（判据面只收已删的那些）。 */
  it("合成文本：点名一份仍在的基线 → 绿", () => {
    const bad = findRetiredBaselineClaims(
      [
        {
          rel: "docs/audits/x.md",
          text: "它的基线是 `scripts/.void-floats-baseline.json`",
        },
      ],
      new Set([".gone-baseline.json"]),
    );
    expect(bad).toEqual([]);
  });

  /**
   * 反向锚点：台账里那处**真漂移**的形态，在**仍存在**时也必须认得出 —— 守「判据不是只认今天这几处」，
   * 用台账真实出现过的检索式造一行（与 `docs/audits/2026-10-12` 那一行同形）。
   */
  it("认得出台账里的表格引用形态（`基线 \\`scripts/.x-baseline.json\\``）", () => {
    const names = citedBaselineNames(
      "| 7 | 同上 | 在 pre-commit 与 CI 强制，基线 `scripts/.dead-exports-baseline.json` | 零消费导出 |",
    );
    expect(names).toEqual([".dead-exports-baseline.json"]);
  });

  /** 建产物目录形态不许进判据面：这不是「路径存在性」判据。 */
  it("构建产物路径不在判据面内（`src-tauri/static` 不存在也不管）", () => {
    /* 这里从前写的是 `expect(existsSync("src-tauri/static")).toBe(false)` —— 与标题正好相反：那是路径存在性判据，
     * 且在跑过 `pnpm build` 的检出上必红（`src-tauri/static` 是构建产物，`.gitignore:101`）。要证「不存在也不管」，
     * 靠下面那条「判据对着一份写着这个路径的文档不报红」，与目录在不在无关 —— 所以这里不需要存在性断言。 */
    const bad = findRetiredBaselineClaims(
      [
        {
          rel: "docs/audits/x.md",
          text: "出厂载荷 `src-tauri/static` 的数产物判据",
        },
      ],
      new Set(retiredBaselineNames()),
    );
    expect(bad).toEqual([]);
  });
});
