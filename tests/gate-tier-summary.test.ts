/**
 * `scripts/gate-tier-summary.cjs` —— 降档收尾那几句话的判断面（ISSUE #2154）。
 *
 * ## 它守的是什么
 *
 * 钩子收尾那段话的**唯一功能**是阻止「本地过了」被读成「全套判据过了」（§13.5.25）。
 * 旧实现把「没跑哪些」的清单**写死成全集**（`（tsc / eslint / 受影响用例 / 静态判据全量）`），
 * 于是在 `COMFY_HEAVY_GATES=1` 那一跑里，这句紧挨着三行 `[ok] ── 组 A / 组 B / 组 D` 打印，
 * 当场推翻自己的上一行；同段那句「本地要 A/B/D 全套：`COMFY_HEAVY_GATES=1` …」在同一次
 * 运行里也已经不适用（它推荐的正是这一轮已经做的事）。当场读数（2026-10-22 那次真提交）：
 *
 * ```text
 *   [ok] ── 组 A：tsc --noEmit
 *   [ok] ── 组 B：eslint（零警告，范围见 package.json lint）
 *   [ok] ── 组 D：静态判据（结构/复用/棘轮/文档）
 * [pre-commit] ⚠ 本次提交本地**没跑**：组 C（tsc / eslint / 受影响用例 / 静态判据全量）
 * [precommit-timing] 已记录本次耗时：总 45.2s（4 组 / 52 步）
 * ```
 *
 * 一句在部分场景下**必假**的免责声明，教给读者的不是「这条会说谎」，而是
 * 「这类警告可以忽略」—— 下一次真只跑了 D0 时，同一个人就会把它当噪音划掉。
 * 这与 ISSUE #2145（合并那段被自己的下一行推翻）、ISSUE #2149（红话把人指给一个不存在的
 * 签字者）是同一个病：**措辞不住在事实旁边，事实变了它不变**。
 *
 * ## 这里能判什么、不能判什么
 *
 * **不能**判「钩子真的把这三张名单传对了」—— 那要跑整条钩子（默认档 8s、重档 45s 起，
 * 且要真暂存），归下面「接线」那一组与 `tests/commit-gate-tier.test.ts` 的文本档管：
 * 钩子必须点名这个脚本、那句「没跑」必须在脚本里。这里判的是脚本收到名单之后**说的话**：
 *
 *   · 降了哪几档就点名哪几档（带钩子里那份说明，逐字）；
 *   · **跑了的不许出现在「没跑」那句里**（这条是本次修的正文）；
 *   · 挪去平台的那一组不许混进「降档」名单（它不是这一跳降的）；
 *   · 标签只有钩子那一份：脚本不许自带一张名单（自带的那份会从第一天开始漂）。
 *
 * 反向复算各条自带：把「跑了」那三组塞进 `--skipped` 会让第 2 条红，
 * 把脚本里的取标签改成写死的表会让第 4 条红。
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(import.meta.dirname, "..");
const SCRIPT = path.join(ROOT, "scripts", "gate-tier-summary.cjs");
const HOOK = path.join(ROOT, ".githooks", "pre-commit");

/** 跑一次脚本，返回 stdout 与退出码。 */
function run(...flags: Array<string>) {
  const got = spawnSync(process.execPath, [SCRIPT, ...flags], {
    encoding: "utf8",
    cwd: ROOT,
  });
  // oxlint-disable-next-line typescript/no-unnecessary-condition -- spawnSync 起不来时 stdout/stderr 实测为 undefined，@types/node 按非空标，空串兜底保留
  return { out: got.stdout ?? "", code: got.status };
}

describe("gate-tier-summary：按这一轮实际跑了什么念", () => {
  /** 钩子里那五行 `run_group <id> "<说明>"` 是标签的**唯一出处**，测试也从它取（不另抄一份）。 */
  const hookLabels = new Map<string, string>();
  for (const [, id = "", desc = ""] of readFileSync(HOOK, "utf8").matchAll(
    /^run_group ([A-Z0-9]+) "([^"]*)"/gm,
  )) {
    hookLabels.set(id, desc);
  }

  it("默认档：降下来的 A B D 逐组点名，带上钩子里那份说明", () => {
    const { out, code } = run("--ran", "D0", "--skipped", "A B D", "--moved", "C");
    expect(code, out).toBe(0);
    for (const id of ["A", "B", "D"]) {
      expect(out, `「没跑」那句里应当点名组 ${id}`).toContain(`组 ${id}：${hookLabels.get(id)}`);
    }
    /* 收尾那句跟着档位走：只跑了 D0 ⇒ 重档仍在外头。 */
    expect(out).toContain("入选档位全部通过 ✓（跑了：D0；重档见平台）");
  });

  it("重档全开：不许再说「本地没跑」，也不许再推荐这一轮已经在做的事", () => {
    const { out } = run("--ran", "D0 A B D", "--skipped", "", "--moved", "C");
    /* 这三条就是本次修的那一句：A/B/D 刚跑完并打了 [ok]，这句话在同一轮里必假。 */
    expect(out).not.toContain("本次提交本地**没跑**");
    expect(out).not.toContain("本地要 A/B/D 全套");
    expect(out).not.toContain("重档见平台");
    expect(out).toContain("入选档位全部通过 ✓（跑了：D0 A B D）");
    /* 而 C 那一格仍然要说：它不是降档，是换了执行者 —— 撤掉它等于把结论藏起来。 */
    expect(out).toContain("组 C（受影响用例）本地不再执行");
  });

  it("挪去平台的那一组不混进「降档」名单（旧形态把它写在「组 A B C D」里）", () => {
    const { out } = run("--ran", "D0", "--skipped", "A B D", "--moved", "C");
    const sentence = out.split("\n").find((line) => line.includes("本次提交本地**没跑**"));
    expect(sentence, out).toBeDefined();
    expect(sentence).not.toMatch(/组 C/);
    expect(sentence).toContain("组 A");
  });

  /**
   * 标签只许有一份，且那一份住在**被解析的一侧**（钩子）。
   *
   * 判法是变异而不是扫源码找字面量（扫字面量会把文件头里那段引证也判成违规，而那段
   * 恰恰是要留着说清为什么修）：给脚本一份**改了名的**钩子，它必须跟着改口。
   * 自带一张表的实现在这里会露出来 —— 而自带的那份表从第一天开始漂（§12.12）。
   */
  it("钩子里没有的组号 ⇒ 明说读不到；钩子改了名 ⇒ 跟着改口（表不许长在脚本里）", () => {
    const missing = run("--ran", "D0", "--skipped", "Z", "--moved", "");
    expect(missing.code, missing.out).toBe(0);
    expect(missing.out).toContain("组 Z：(钩子里读不到这一组的说明)");

    const dir = mkdtempSync(path.join(tmpdir(), "gate-tier-hook-"));
    try {
      const fixture = path.join(dir, "pre-commit");
      writeFileSync(
        fixture,
        readFileSync(HOOK, "utf8").replace(
          'run_group A "tsc --noEmit"',
          'run_group A "类型检查（换了名的那一组）"',
        ),
        "utf8",
      );
      const renamed = run("--hook", fixture, "--ran", "D0", "--skipped", "A", "--moved", "");
      expect(renamed.out).toContain("组 A：类型检查（换了名的那一组）");
      expect(renamed.out).not.toContain("组 A：tsc --noEmit");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("恒退 0：它是措辞档，不参与判决（判决住在钩子里）", () => {
    /* 三个参数一个都不给 —— 拿不到名单时也不许崩、不许退非零（那会把一次绿提交判成红）。 */
    const { code, out } = run();
    expect(code, out).toBe(0);
    expect(out).toContain("入选档位全部通过 ✓");
  });
});
