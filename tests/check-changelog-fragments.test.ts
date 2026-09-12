/**
 * CHANGELOG 碎片门禁自测（ISSUE #408「changelog 经常改动，总是冲突」）。
 *
 * 这条门禁的价值全在判定口径上：太松 → 碎片写成什么都放行，发版并入时才发现；
 * 太紧（比如把 README.md 也当碎片校验）→ 成员直接删门禁。用「临时仓库 + 只放
 * 被测碎片」跑真脚本，断言「该拦的拦、不该误伤的放过」。
 *
 * 规范：docs/standards/13-提交与-code-review.md §13.10.5
 */
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const SCRIPT = path.resolve(__dirname, "../scripts/check-changelog-fragments.cjs");
const tempDirs: string[] = [];

/**
 * 造一个只含被测碎片的临时仓库（脚本按自身位置解析仓库根，故必须把脚本
 * 一起复制进去，否则扫的还是真实仓库 —— 那样用例会「总是通过」，等于没测）。
 */
function scanner(files: Record<string, string>) {
  const root = mkdtempSync(path.join(tmpdir(), "changelog-"));
  tempDirs.push(root);
  mkdirSync(path.join(root, "scripts"), { recursive: true });
  copyFileSync(SCRIPT, path.join(root, "scripts", path.basename(SCRIPT)));
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(root, rel);
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  }
  const run = (): { ok: boolean; output: string } => {
    try {
      return {
        ok: true,
        output: execFileSync(
          process.execPath,
          [path.join(root, "scripts", path.basename(SCRIPT))],
          { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
        ),
      };
    } catch (err) {
      const e = err as { stdout?: string; stderr?: string };
      return { ok: false, output: `${e.stdout ?? ""}${e.stderr ?? ""}` };
    }
  };
  return { root, run };
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("check-changelog-fragments", () => {
  it("放过形态正确的碎片", () => {
    const { run } = scanner({
      "changelog.d/408-changelog-conflict-free.md": "## Changed\n\n- 条目正文。\n",
      "changelog.d/0-no-issue-fragment.md": "## Fixed\n\n- 条目正文。\n",
    });
    const res = run();
    expect(res.ok).toBe(true);
    expect(res.output).toContain("2 个碎片形态正确");
  });

  it("拦住只有段落标题、没有正文的空碎片", () => {
    const { run } = scanner({ "changelog.d/408-empty.md": "## Added\n" });
    const res = run();
    expect(res.ok).toBe(false);
    expect(res.output).toContain("没有条目正文");
  });

  it("拦住首行不是固定段落的碎片", () => {
    const { run } = scanner({ "changelog.d/408-freeform.md": "# 我的改动\n\n- 条目。\n" });
    const res = run();
    expect(res.ok).toBe(false);
    expect(res.output).toContain("首行须是段落标题");
  });

  it("拦住文件名不带 issue 号与 slug 的碎片", () => {
    const { run } = scanner({ "changelog.d/fix-bug.md": "## Fixed\n\n- 条目。\n" });
    const res = run();
    expect(res.ok).toBe(false);
    expect(res.output).toContain("<issue号>-<slug>.md");
  });

  it("不把 README.md 当碎片校验", () => {
    const { run } = scanner({
      "changelog.d/README.md": "# changelog.d\n\n说明性文档，没有段落标题。\n",
    });
    expect(run().ok).toBe(true);
  });

  it("未启用碎片目录时跳过而不是报错", () => {
    const { run } = scanner({ "CHANGELOG.md": "# 更新日志\n" });
    const res = run();
    expect(res.ok).toBe(true);
    expect(res.output).toContain("未启用碎片目录");
  });
});
