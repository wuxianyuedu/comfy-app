/**
 * `scripts/gate-tier-summary.cjs` —— 降档收尾那几句话的判断面（ISSUE #2154）：唯一功能是不让「本地过了」被读成
 * 「全套判据过了」（§13.5.25）。旧实现写死全集，`COMFY_HEAVY_GATES=1` 那一跑当场推翻自己（同族 #2145/#2149）。
 * 只判脚本收到名单后说的话：降档点名、跑了的不进「没跑」、挪去平台的不并入降档、标签只认钩子那份（变异验证）。
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
  return { out: got.stdout ?? "", code: got.status };
}

describe("gate-tier-summary：按这一轮实际跑了什么念", () => {
  /** 钩子里那五行 `run_group <id> "<说明>"` 是标签的**唯一出处**，测试也从它取（不另抄一份）。 */
  const hookLabels = new Map<string, string>();
  for (const m of readFileSync(HOOK, "utf8").matchAll(
    /^run_group (?<id>[A-Z0-9]+) "(?<desc>[^"]*)"/gm,
  )) {
    hookLabels.set(m.groups?.id ?? "", m.groups?.desc ?? "");
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
   * 标签只许有一份，且住在**被解析的一侧**（钩子）。判法是变异而非扫字面量（扫字面量会连文件头引证一起判违规）：
   * 给脚本一份改了名的钩子，它必须跟着改口 —— 自带一张表的实现在这里露出来，而那份表从第一天开始漂（§12.12）。
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
