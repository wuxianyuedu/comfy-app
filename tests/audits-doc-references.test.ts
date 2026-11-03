/**
 * `docs/audits/**` 的**引用漂移**判据 —— 那一层此前没有任何执行者。
 *
 * ## 立案现场（ISSUE #1811 收尾复审第四轮之后的遗留项）
 *
 * 台账 `docs/audits/2026-10-12-architecture-risk-review.md` 自己承认了这件事：
 * 「`docs/audits/**` 不在 `doc:check` 的核对面里，所以这份台账自己的引用漂移
 * 没有判据会红」—— 它连**自己**都没能把这句话变成红的。`doc:check` 的遍历面是
 * `doc-facts.cjs` 的 `SCOPED_DOC_DIRS`（只含 `docs/standards` 与 `docs/guides`），
 * 于是「台账点名了一份已经不存在的基线 / 已经删掉的模块」不会让任何东西变红。
 *
 * ## 为什么不能直接「台账里的路径都得存在」
 *
 * 那会**假红一片**，而会误报的判据活不过一次评审（§11.18.4）。本仓当场就能举出反例：
 *
 *   · `src-tauri/static` —— 台账里出现两次，而该目录**今天不存在**。但它是**构建产物**
 *     （`src-tauri/.gitignore` 的 `/static/*` 忽略、`git ls-files src-tauri/static` 为 0），
 *     不构建就没有。要求它存在 = 逼人每天先跑一次全量构建才能提交。
 *   · `docs/standards/12`（L17 / L368）—— 那是**被引用的章节号**，不是文件路径。
 *   · 沿革叙述里如实写着「随 `90c627e3` 删除」的模块路径 —— 那时的**正确**写法。
 *
 * ## 所以这一格只判「能证明的那一半」（与 `check-gate-flag-claims.cjs` 同口径）
 *
 * 靶子收窄到一件事：**台账点名了一份 `scripts/.*-baseline.json` 基线文件，而该文件
 * 已经不在**，且**同一行没有明写它是历史快照**。
 *
 * 为什么恰好是它：
 *   · **名单不抄第二份** —— 「哪些基线被删过」是**版本控制的事实**，现从
 *     `git log --diff-filter=D` 算；翻闸（ISSUE #1811）删掉的 20 份基线由此动态进入
 *     判据面，新增一次翻闸不需要回来改本文件。
 *   · **它没有正当形态** —— 一份「基线 `scripts/x-baseline.json`」的写法**只可能**在
 *     断言「这条棘轮今天带着这份基线」。而基线文件一旦删除，棘轮那条路就已经收掉
 *     （`--update` 一并删了，见 `HARD_GATE_FLIPS`），这句话就是**纯过期引用**。
 *   · 沿革叙述有**显式形态**：台账里写「曾带 / 已删 / 已不存在 / 当日快照」的那些行
 *     是**如实记述**，跳过。这不是让判据猜语义，而是把已知的正当形态列出来
 *     （与各判据的 `EXEMPT_SITES` 同构），下面每一条豁免都有实例可指。
 *
 * ## 刻意不判（明写在案，别当成漏报）
 *
 *   · **构建产物路径**（`src-tauri/static`、`.next/**`）：不构建即不存在，判它等于
 *     假红（上面举过实例）。
 *   · **正文里的模块路径**：台账写成「随 `90c627e3` 删除」是**正确**写法，而「删了却
 *     没加注」的形态在文本上更接近「参考实现」而不可分 —— 判它会误报，收益也不成比例
 *     （它是叙述性引用，不是「照它去跑」的命令）。
 *   · **章节号**（`docs/standards/12`）：不是路径。
 *
 * ## 为什么进固定清单
 *
 * 它守的是「台账这类**过程文档**的引用还指得着东西」这条全库级不变量，与任何一次
 * 具体改动无关；`docs/audits/**` 也不在 `doc:check` 的面里，不跑它就等于没有。
 * 成本是读几份文本 + **一趟** git 调用（零网络），照 §13.5.4 该进固定清单。
 *
 * ## 这一格为什么便宜得起（实测，别退回去）
 *
 * `retiredBaselineNames()` 的 git 调用**带 `-- scripts/` pathspec**，结果 memo 在模块级，
 * 整份文件最多走一趟。本机实测：不带 pathspec 那趟 `git log --all --diff-filter=D --name-only`
 * 要 13.3s 并吐 608 行；带上之后 3.3s / 64 行，而**过滤出来的文件名集合逐字相等**（20 个）——
 * 下一步本来就把非 `scripts/.…baseline….json` 的行全丢掉，让 git 遍历整棵树只是白付 I/O。
 * 这条是**降成本**，不是抬超时（§13.6.4 反对的正是后者）：起因是本检出上那两条 git 用例
 * 在争用下各自涨到 20s 以上，贴着 30s 的全局 `testTimeout` —— 判据在固定清单里，
 * 贴边意味着任何人都可能提交不了，而红的是时间不是内容。
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
 * 现算「曾经入库、今天已不在」的 scripts 基线的**文件名**。
 *
 * 只算**文件名**而不算全路径：台账里写的是 `scripts/.dead-exports-baseline.json`
 * 或裸的 `.infra-file-size-baseline.json` 两种形态都有，按文件名对齐才不挑写法。
 *
 * 用 `--all` 而不是当前分支：基线可能是在别的分支上删的（PR squash 合并后它就在
 * 主线历史里了），只读 HEAD 会漏。
 *
 * `git` 不可用（比如浅检出 / 无 git 的沙箱）时退化成空集 —— **那是「判据面为空」，
 * 不是「全绿」**，下面有一条专门的用例把这个形态判红（一个永远返回空集的扫描器
 * 会让「台账干净」恒真）。
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
 * 台账里出现的基线文件名。
 *
 * 两种写法都要认：`scripts/.x-baseline.json`（全路径）与 `.x-baseline.json`（裸名）。
 * 归一化成**带前导点**的 basename，与 `retiredBaselineNames()` 同一把尺子 ——
 * 不归一的话「`scripts/.a-baseline.json`」会被自己的分组吃掉那个点，两边对不上而静默出网。
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
 * 判据本体：出现「已删基线 + 该行没有历史口径」。
 *
 * 抽成纯函数是为了让用例能造两个方向：真仓库跑一遍（反向锚点：判据面非空），
 * 再用合成文本跑「该红则红 / 带历史口径则该绿」。
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
   * 判据面**非空**：这条守的是本文件最坏的失效形态 —— `git` 不可用（浅检出 / 沙箱）时
   * `retiredBaselineNames()` 退化成空集，上面那条会**恒绿**而看上去「台账很干净」。
   * 一个永远返回空的扫描器等于没有判据，所以这里正面断言「本仓库今天确实有已删基线」。
   *
   * 为什么不是「断言 `git` 能跑」：那是环境断言，改不了就把人堵在提交上。断言
   * **事实**（仓库历史里确实删过基线）才是这条判据自己成立的前提 —— 若哪天全仓
   * 一条基线都不曾删过，那这条判据该删，而不是让它继续恒绿。
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
   * 反向锚点：台账里那处**真漂移**的形态，必须在**仍存在**时也认得出。
   *
   * 这一格守的是「判据不是只认今天这几处」—— 用台账里真实出现过的检索式造一行，
   * 断言它被判据认成引用（与 `docs/audits/2026-10-12` 里那一行的形状一致）。
   */
  it("认得出台账里的表格引用形态（`基线 \\`scripts/.x-baseline.json\\``）", () => {
    const names = citedBaselineNames(
      "| 7 | 同上 | 在 pre-commit 与 CI 强制，基线 `scripts/.dead-exports-baseline.json` | 零消费导出 |",
    );
    expect(names).toEqual([".dead-exports-baseline.json"]);
  });

  /** 建产物目录形态不许进判据面：这不是「路径存在性」判据。 */
  it("构建产物路径不在判据面内（`src-tauri/static` 不存在也不管）", () => {
    /* 这里从前第一行写的是 `expect(existsSync("src-tauri/static")).toBe(false)` ——
     * 与这一格自己的标题和注释正好相反：它**就是**一条路径存在性判据，而且是台机器上
     * 必红的那种（`src-tauri/static` 是桌面构建产物，`.gitignore:101` 收着它；任何跑过
     * `pnpm build` 的检出都会让这条拦住提交）。要证「不存在也不管」，靠的是下面那条
     * 「判据对着一份写着这个路径的文档不报红」—— 与目录在不在无关，所以这里不需要、
     * 也不该有存在性断言。 */
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
