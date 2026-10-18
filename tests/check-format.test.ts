/**
 * 提交门槛自检：prettier 格式判据（ISSUE #575 第 9 项 / #1811 收尾 / 规范 §13.5）。
 *
 * 这一条在 ISSUE #1811 收尾时**从棘轮翻成硬闸**：存量已清零，于是棘轮车道没有
 * 成员 —— `--update` 写回去的永远是一份空账，留下的却是「手改 JSON 就能把新
 * 违规登记成已知存量」这条通道（§13.6.2 的两类对照）。基线文件已删、
 * `--update` / `--strict` 已不存在。
 *
 * 价值仍在**两个方向**都成立上：真的拦住脏文件，也放过干净文件（一个永远返回
 * 非空的扫描器会让一切都红）。用「临时工作区 + 只放被测文件」跑真脚本。
 *
 * 为什么用子进程而不是 import：脚本被 pre-commit 以 `node scripts/xxx.cjs`
 * 调用，且用 `process.cwd()` 定位扫描根 —— 复用同一调用方式才等价于真实门禁。
 *
 * 规范：docs/standards/13-提交与-code-review.md §13.5
 */
import { createRequire } from "node:module";
import { join } from "node:path";
import { defineGateRepo, describe } from "./helpers/gate-repo";
import { vi } from "vitest";

/* 每条用例都要在临时工作区里真跑 git（init / add / commit）并**真起 prettier**
 * —— 门禁按 glob 各调一次 `prettier --list-different`，实测单次约 300~550ms。
 * 默认 5s 的用例超时在本机是「刚好够用」，CI 全量并行满载时会直接被击穿：现场
 * 是 `Test timed out in 5000ms`，且报错会落在**调度顺序**排在后面的任意一条用例
 * 上（看起来像「某条用例写得慢」，实际是整条固定成本顶着上限跑）。
 *
 * 这一处方与 `check-reformat-only.test.ts` 同源：那里把「每条用例起十几个
 * prettier」收敛成「整批一次」，这里没有可收敛的调用数（每条用例都要建一个独立
 * 仓库 + 基线），所以只能放宽整文件的超时。放宽只影响本文件。 */
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

/** 真实仓里 prettier 的入口（沙箱用例通过 `COMFYAPP_PRETTIER_ENTRY` 借给它）。 */
const PRETTIER_ENTRY = createRequire(join(process.cwd(), "noop.js")).resolve(
  "prettier/bin/prettier.cjs",
);

const { test, expect } = defineGateRepo({
  script: "check-format.cjs",
  dirs: ["src/lib"],
  /* 沙箱里没有 `node_modules`，不借这条接缝就会走「入口解析不到 → exit 2」
   * 那一档（那是脚本**正确**的 fail-closed 行为，不是本文件要验的形态）。
   * 「借不到」那一档由 `run(..., { env: { COMFYAPP_PRETTIER_ENTRY: undefined } })`
   * 单独造（见下面两条 fail-closed 用例）。 */
  env: { COMFYAPP_PRETTIER_ENTRY: PRETTIER_ENTRY },
  /* `--staged` 那批用例要读 `git diff --cached` —— 临时工作区必须是个真的 git 仓库。 */
  setup: (repo) => {
    repo.git("init", "-q");
    repo.git("config", "user.email", "t@local");
    repo.git("config", "user.name", "t");
    repo.git("config", "commit.gpgsign", "false");
    repo.git("config", "tag.gpgsign", "false");
  },
});

// 脏内容：多余空格 + 多余空行，prettier 一定会改它。
const DIRTY = "export const PROBE={a:1,\n\n\n  b:2};\n";
const CLEAN = "export const PROBE = { a: 1, b: 2 };\n";

describe("prettier 格式判据（硬闸）", () => {
  test("全库格式干净 → 通过", ({ repo }) => {
    repo.write("src/lib/keep.ts", CLEAN);
    const r = repo.run();
    expect(r.code).toBe(0);
    expect(r.output).toContain("[format] OK");
  });

  test("未过格式的文件 → 阻断，并指出是哪个文件", ({ repo }) => {
    repo.write("src/lib/keep.ts", CLEAN);
    repo.write("src/lib/fresh.ts", DIRTY);
    const r = repo.run();
    expect(r.code).toBe(1);
    expect(r.output).toContain("src/lib/fresh.ts");
    expect(r.output).toContain("未过 prettier");
  });

  test("把原本干净的文件弄脏 → 同样阻断（没有存量额度）", ({ repo }) => {
    repo.write("src/lib/keep.ts", DIRTY);
    const r = repo.run();
    expect(r.code).toBe(1);
    expect(r.output).toContain("src/lib/keep.ts");
  });

  test("翻硬闸后 --update / --strict 是断头的（不许有隐藏放宽通道）", ({ repo }) => {
    /* 少了这一格，「删了 --update」与「--update 还在但没人调」看起来一样。 */
    repo.write("src/lib/fresh.ts", DIRTY);
    for (const flag of ["--update", "--strict"]) {
      const r = repo.run([flag]);
      expect(r.code, `${flag} 不该放行脏文件`).toBe(1);
      /* 出路不该是「跑 --update 收紧基线」——那条路已经不存在（判据的输出里
       * 只能出现「本判据是硬闸（无基线、无 --update）」这半句声明）。 */
      expect(r.output, `${flag} 的出路不该指向 --update`).not.toContain("--update 收紧");
    }
  });

  test("prettier 入口取不到 → exit 2，且**不许**读成「全库干净」", ({
    repo,
  }) => {
    /* 这条钉的是原来的 fail-open（台账 E11）：门禁过去经 `pnpm exec` 找 prettier，
     * 命令找不到时退出 1、stdout 为空，而脚本把「空清单」当成「0 个文件未过」
     * 并打 `[format] OK` 退出 0 —— 依赖缺失 / 形态选错的机器上门禁就这样瞎掉。 */
    repo.write("src/lib/keep.ts", CLEAN);
    const r = repo.run([], { env: { COMFYAPP_PRETTIER_ENTRY: undefined } });
    expect(r.code).toBe(2);
    expect(r.output).toContain("找不到 prettier 入口");
    expect(r.output).not.toContain("[format] OK");
  });

  test("prettier 退出 1 却一行都没列出来 → exit 2（「没跑成」与「有差异」分开）", ({
    repo,
  }) => {
    /* 沙箱里放一个「只按退出码说话」的假入口：`--list-different` 返回 1 的含义是
     * 「有差异，清单在 stdout」，清单为空就说明这句话不可信。 */
    repo.write("src/lib/keep.ts", CLEAN);
    const stubRel = "scripts/fake-prettier.cjs";
    repo.write(stubRel, "process.exit(1);\n");
    const stub = join(repo.dir, stubRel);
    const r = repo.run([], { env: { COMFYAPP_PRETTIER_ENTRY: stub } });
    expect(r.code).toBe(2);
    expect(r.output).toContain("不是「全库干净」");
    expect(r.output).not.toContain("[format] OK");
  });

  test("测试 / 脚本 / 根级配置 / 非源码产物落在白名单里 → 不误报", ({
    repo,
  }) => {
    // 白名单是「形态」而不是文件列表：新增的这类文件自动豁免。
    repo.write("tests/fresh.test.ts", DIRTY);
    repo.write("scripts/fresh.mjs", DIRTY);
    repo.write("e2e/fresh.spec.ts", DIRTY);
    /* Rust 壳的构建输出：它被**嵌套的** src-tauri/.gitignore 忽略，而 prettier 只
     * 按仓库根读 .gitignore —— 不进白名单就会拿它阻断每一次提交（ISSUE #638 修好
     * pnpm 启动形态后本门禁第一次真正扫到全库时暴露的现象）。 */
    repo.write(
      "src-tauri/target/debug/build/app-1/out/__global-api-script.js",
      DIRTY,
    );
    const r = repo.run();
    expect(r.code).toBe(0);
  });
});

describe("glob 白名单判定（纯函数，不跑 prettier）", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require("../scripts/check-format.cjs") as {
    isIgnored: (rel: string) => boolean;
    globToRegExp: (glob: string) => RegExp;
  };

  test.for([
    ["scripts/check-format.cjs", true],
    ["tests/anything.test.ts", true],
    ["e2e/smoke.spec.ts", true],
    ["docs/api/assets/main.js", true],
    ["next.config.js", true],
    ["vitest.config.ts", true],
    // 非源码产物（Rust 壳构建输出）豁免；glob 锚在 src-tauri 下，不是「任何 target 目录」
    ["src-tauri/target/release/build/app-x/out/__global-api-script.js", true],
    ["src-tauri/src/main.rs", false],
    ["src/lib/target/keep.ts", false],
    ["src/lib/endpoints.ts", false],
    ["src/components/ui/button.tsx", false],
    ["src/app/api/health/route.ts", false],
  ] as const)("%s → ignored=%s", ([rel, expected]) => {
    expect(mod.isIgnored(rel)).toBe(expected);
  });

  test("`*.config.{ts,js}` 这一类花括号展开只匹配一层目录", () => {
    expect(mod.isIgnored("prettier.config.js")).toBe(true);
    expect(mod.isIgnored("src/lib/next.config.js")).toBe(false);
  });
});

/**
 * `--staged` 的输入面跳过（ISSUE #1747）。
 *
 * ⚠️ 这一档自 ISSUE #2010 起**不再是钩子里的那一条**（钩子那一步整体挪到了平台侧，
 * 平台侧跑的是全量档、不带 `--staged`）。它留下来是因为 `--staged` 仍是**人的动作**
 * ——提交前自查「我这一批改动有没有带脏文件进来」，而人不想为此扫全库。
 * 判据本体与前一档一字不差，判法也不变（下面这些用例判的是那个 flag 的语义，
 * 与谁在什么时候敲它无关）。
 *
 * 这一步的扫描面由 `GLOBS` 与 `IGNORE_GLOBS` 现算（实测只剩 `src/**` 与
 * `.storybook/**`），两个方向都要钉住：不在扫描面内 ⇒ 跳过（省下全库扫描），
 * 在扫描面内 ⇒ **照旧真扫**（跳过不是「让判据松掉」的后门）。
 *
 * 为什么断言 `code === 0` 之外还要看输出：「跳过」与「扫过之后没有脏文件」是同
 * 一个退出码，只看退出码的话，一条把 `--staged` 实现成「永远跳过」的改动能全绿
 * 通过 —— 那正是门禁静默失效的形态（§11.23 的「声明 ⇄ 读者」）。
 */
describe("prettier 格式判据 --staged 输入面跳过（ISSUE #1747）", () => {
  test("暂存文件全在扫描面外 → 跳过（不起 prettier）", ({ repo }) => {
    repo.write("src/lib/dirty.ts", DIRTY);
    repo.git("add", "-A");
    repo.commit("clean-baseline");
    // 改一个不在 prettier 靶子里的文件：`IGNORE_GLOBS` 收 `scripts/**`。
    repo.write("scripts/probe.cjs", "module.exports = {a:1,   b:2}\n");
    repo.git("add", "scripts/probe.cjs");
    const r = repo.run(["--staged"]);
    expect(r.code).toBe(0);
    expect(r.output).toContain("未触及扫描面");
    expect(r.output).not.toContain("运行 prettier");
  });

  test("暂存文件落在扫描面内 → 真扫（脏文件照旧阻断）", ({ repo }) => {
    repo.write("src/lib/dirty.ts", CLEAN);
    repo.git("add", "-A");
    repo.commit("clean-baseline");
    repo.write("src/lib/dirty.ts", DIRTY);
    repo.git("add", "src/lib/dirty.ts");
    const r = repo.run(["--staged"]);
    expect(r.code).toBe(1);
    expect(r.output).not.toContain("未触及扫描面");
    expect(r.output).toContain("src/lib/dirty.ts");
  });

  test("无暂存改动 → 跳过（不为空提交白扫全库）", ({ repo }) => {
    const r = repo.run(["--staged"]);
    expect(r.code).toBe(0);
    expect(r.output).toContain("未触及扫描面");
  });
});
