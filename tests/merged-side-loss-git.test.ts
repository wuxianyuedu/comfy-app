/**
 * `scripts/merged-side-loss-git.mjs` 取证层单测（规范 §11.23.5 / §11.23.6）：真脚本+真仓库测不出 spawn 次数（旧写法变更文件×历史条目，约 2–3s/文件，premerge 与提交前档恒超时），故用注入的假 run 钉住：①每个函数各只起一条 git；②读不懂的输出一律判「没跑起来」，不部分采信、不猜。
 * 覆盖 resolveBlobs（正常/缺失/去重/失败/行数或格式不符⇒null）、historyByFile（候选序与路径过滤/失败⇒null）、空格与类提交标记的路径。
 * 两个执行者的源码必须经这一层取证（不再自拼 `<rev>:<path>` 逐条 rev-parse）。
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test, vi } from "vitest";
import { historyByFile, resolveBlobs } from "../scripts/merged-side-loss-git.mjs";

/* 这些用例全是纯函数 + 假 run，最贵的一条是拼字符串；30s 的全局预算用不到，
 * 但本文件的夹具仓库类兄弟文件都显式钉过，这里同样就地钉死，避免随全局漂移。 */
vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

/** `--batch-check` 的一行输出（类型固定 blob，尺寸随意 —— 判据不看它）。 */
const line = (sha: string) => `${sha} blob 12`;
const SHA_A = "a".repeat(40);
const SHA_B = "b".repeat(40);
const SHA_C = "c".repeat(40);

describe("resolveBlobs —— 一次批量解析换掉逐条 rev-parse", () => {
  test("① 每个请求一行、逐条对齐；路径在那个版本不存在给 null", () => {
    const run = vi.fn(() => [line(SHA_A), line(SHA_B), "HEAD:gone.ts missing"].join("\n"));
    const out = resolveBlobs(run, ["HEAD:a.ts", "HEAD:b.ts", "HEAD:gone.ts"]);
    expect(out).toBeInstanceOf(Map);
    expect(out!.get("HEAD:a.ts")).toBe(SHA_A);
    expect(out!.get("HEAD:b.ts")).toBe(SHA_B);
    expect(out!.get("HEAD:gone.ts")).toBeNull();
  });

  test("① 重复请求只解析一次（喂给 git 的行数 = 去重后的条数）", () => {
    const run = vi.fn((args: Array<string>, input?: string) => {
      expect(args).toEqual(["cat-file", "--batch-check"]);
      expect(input!.trim().split("\n")).toEqual(["HEAD:a.ts"]);
      return line(SHA_A);
    });
    const out = resolveBlobs(run, ["HEAD:a.ts", "HEAD:a.ts", "HEAD:a.ts"]);
    expect(out!.get("HEAD:a.ts")).toBe(SHA_A);
    expect(run).toHaveBeenCalledTimes(1);
  });

  test("① 空清单不起进程", () => {
    const run = vi.fn();
    expect(resolveBlobs(run, [])!.size).toBe(0);
    expect(run).not.toHaveBeenCalled();
  });

  test("② run 失败 ⇒ null（不许把「没取到」说成「没命中」）", () => {
    expect(
      resolveBlobs(
        vi.fn(() => null),
        ["HEAD:a.ts"],
      ),
    ).toBeNull();
  });

  test("② 输出行数少于请求数 ⇒ null（对不上就是不猜）", () => {
    const run = vi.fn(() => line(SHA_A));
    expect(resolveBlobs(run, ["HEAD:a.ts", "HEAD:b.ts"])).toBeNull();
  });

  test("② 某行读不懂 ⇒ null，且不带出半份结论", () => {
    const run = vi.fn(() => [line(SHA_A), "??????", line(SHA_B)].join("\n"));
    expect(resolveBlobs(run, ["HEAD:a.ts", "HEAD:b.ts", "HEAD:c.ts"])).toBeNull();
  });
});

describe("historyByFile —— 一次遍历换掉逐文件 git log", () => {
  const log = [
    `@${SHA_A}`,
    "src/a.ts",
    "",
    `@${SHA_B}`,
    "src/deep/nested file.ts",
    "docs/api/ignored.html",
    "",
    `@${SHA_C}`,
    "src/a.ts",
  ].join("\n");

  test("③ 每个被关心的文件一条清单，序为 git 的日志序（新 → 旧）", () => {
    const run = vi.fn((..._args: Array<unknown>) => log);
    const out = historyByFile(run, {
      ref: "baseline",
      files: ["src/a.ts", "src/deep/nested file.ts"],
    })!;
    expect(out.get("src/a.ts")).toEqual([SHA_A, SHA_C]);
    /* 路径带空格也必须认得：旧写法逐文件传 pathspec，批量读法靠比对整行。 */
    expect(out.get("src/deep/nested file.ts")).toEqual([SHA_B]);
    expect(run).toHaveBeenCalledTimes(1);
    /* `-c core.quotePath=false` 是取证层的前缀（ISSUE #2272）：git 默认会把含非 ASCII
     * 的路径转义加引号，转义后与真实路径对不上 ⇒ 判成「没改」而恒绿。断言把前缀一起钉住，
     * 免得它被顺手摘掉时这一层看不见。 */
    expect(run.mock.calls[0]?.[0]).toEqual([
      "-c",
      "core.quotePath=false",
      "log",
      "--format=@%H",
      "--name-only",
      "--no-merges",
      "baseline",
    ]);
  });

  /* 消费点（`check-pending-merge-loss.mjs` 收候选那一步）写的是 `hist.get(f) ?? []`，
   * 而那里的注释说「保证在生产端」—— 保证就是这一行：入口按传进来的 `files` 预置空数组。
   * 这条断言把那个保证钉住：谁把预置改成「只给日志里出现过的路径建条目」，这里要红，
   * 而不是让消费点那一句 `?? []` 变成「静默少一个文件的候选」。 */
  test("日志里一次没出现过的文件，清单里仍有它的空条目（入口预置那一步）", () => {
    const out = historyByFile(
      vi.fn(() => log),
      { ref: "b", files: ["src/a.ts", "src/never-touched.ts"] },
    )!;
    expect(out.get("src/never-touched.ts")).toEqual([]);
    expect([...out.keys()]).toEqual(["src/a.ts", "src/never-touched.ts"]);
  });

  test("③ 没被关心的路径不进清单（也不给它们建条目）", () => {
    const out = historyByFile(
      vi.fn(() => log),
      { ref: "b", files: ["src/a.ts"] },
    )!;
    expect([...out.keys()]).toEqual(["src/a.ts"]);
  });

  test("④ run 失败 ⇒ null；空文件清单不起进程", () => {
    expect(
      historyByFile(
        vi.fn(() => null),
        { ref: "b", files: ["src/a.ts"] },
      ),
    ).toBeNull();
    const run = vi.fn();
    expect(historyByFile(run, { ref: "b", files: [] })!.size).toBe(0);
    expect(run).not.toHaveBeenCalled();
  });

  test("⑤ 名字长得像提交标记的文件：不假命中，最多多要一次解析（结果为 null 就放过）", () => {
    /* 标记是「@ + 纯十六进制」，与路径撞形的后果只能是：该路径自己那一行被当成新提交，
     * 于是清单里混进一个不存在的 sha —— 它解析出来是 null，永远等不到「与结果版相同」。 */
    const tricky = `@${SHA_A}\n@${SHA_B}`;
    const out = historyByFile(
      vi.fn(() => tricky),
      { ref: "b", files: [SHA_A] },
    )!;
    expect(out.get(SHA_A)).toEqual([]);
  });
});

describe("两个执行者必须经这一层取证", () => {
  /* 这一条钉的是**回潮**：`rev-parse` 逐条取 `<rev>:<path>` 是这条判据唯一的
   * 超线性成本来源（次数 = 文件数 × 历史条目数）。谁把它抄回执行者里，
   * 上面那些用例看不见，这条能看见。 */
  for (const script of [
    "scripts/check-merged-side-loss.mjs",
    "scripts/check-pending-merge-loss.mjs",
  ]) {
    test(`${script} 的取证只走 merged-side-loss-git`, () => {
      const src = readFileSync(join(process.cwd(), script), "utf8");
      expect(src).toContain("./merged-side-loss-git.mjs");
      expect(src).toMatch(/resolveBlobs\(/);
      expect(src).toMatch(/historyByFile\(/);
      /* 逐条取 blob / 逐文件取历史的写法不许留在执行者里。
       * 注意这里只拦**实现形态**（把 `cat-file` 当 git 参数传、把路径当 pathspec 逐文件传），
       * 放行话术里对这条通道的点名说明 —— 报错文案要能指出「是哪一层没跑起来」。 */
      expect(src).not.toMatch(/rev-parse",\s*`\$\{/);
      expect(src).not.toMatch(/"--",\s*(file|f)\b/);
      expect(src).not.toMatch(/\[\s*"cat-file"/);
    });
  }
});
