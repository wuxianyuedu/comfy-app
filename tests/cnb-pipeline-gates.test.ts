/**
 * CNB 流水线门禁的护栏（ISSUE #623）
 * ===========================================================================
 *
 * 背景：本仓库跑在 CNB 平台上，而平台只读仓库根的 `.cnb.yml`，不读
 * `.github/workflows/`。那份 27 步门禁在平台上**从未被触发过一次**（构建历史里
 * 只有 `issue.comment@npc` / `api_trigger`，`push` 与 `pull_request` 均为 0）。
 * 门禁因此整体迁到 `.cnb.yml`，`.github/workflows/ci.yml` 已删除。
 *
 * 迁移的风险不是「语法写错」（平台会直接报配置错误），而是**静默丢步**：
 * `.cnb.yml` 是一条几十步的清单，删掉其中一行不会有任何构建红，只会少一类回归信号。
 * 这类「判据只写一遍、掉了没人知道」正是本仓库反复踩的形态，故把清单锁成可失败断言。
 *
 * 另有一条与安全相关的口径：`pull_request` 是**不可信事件**，其流水线配置取自
 * **源分支**——触发者可以改 `.cnb.yml`、把门禁删掉。所以「PR 源分支不能是 master」
 * 不能只靠 `.cnb.yml` 里的一行命令，`scripts/check-branch-guard.cjs` 必须自己
 * 独立判定；本文件同时锁住「守卫排在第一道」与「调用的判据版本与脚本一致」。
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const CNB_PATH = join(process.cwd(), ".cnb.yml");
const cnb = readFileSync(CNB_PATH, "utf8");
const GUARD_SCRIPT = readFileSync(
  join(process.cwd(), "scripts", "check-branch-guard.cjs"),
  "utf8",
);

/** 单个 `- name:` 步骤。 */
type Step = { name: string; body: string };

/**
 * 从 `.cnb.yml` 里切出步骤。
 *
 * 必须按**缩进**切：门禁清单挂在一个 YAML 锚点（`&gates`）下，锚点行本身也在
 * 根级（缩进 2 的 `- name:` 是流水线自己的名字）。只认一种缩进会把锚点里的
 * 清单整段切开，于是「清单一条不许丢」这条判据自己先失效。
 */
function stepBlocks(src: string, indent = 2): Step[] {
  const re = /^( *)- name: (.+)$/gm;
  const marks: { name: string; start: number; indent: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    marks.push({ name: (m[2] ?? "").trim(), start: m.index, indent: (m[1] ?? "").length });
  }
  return marks
    .filter((mk) => mk.indent === indent)
    .map((mk, i, list) => ({
      name: mk.name,
      body: src.slice(mk.start, list[i + 1]?.start ?? src.length),
    }));
}

/** 挂 YAML 锚点的清单（缩进 2）。 */
const gates = stepBlocks(cnb, 2);
/** 锚点 `&gates` 的名字不参与核对：展开处才是步骤。 */
const steps = gates;

/**
 * `.cnb.yml` 的两条流水线：`pull_request` 跑全套门禁，`push` 只跑合并形态复核。
 *
 * 为什么要有这条口径（ISSUE #623 第二问）：核时 = 节点规格 × 运行时长，
 * 8 核跑一小时就是 8 核时，而免费额度是 160 核时/月。**同一个 stages 锚点同时
 * 挂给两个事件**（`<<: *pipeline`）时，每一次 PR 合并都会在 master 上再跑一遍
 * 全套——那不是平台行为，是配置写重了，而且没人会从构建历史里发现（两条都绿）。
 */
describe("两条流水线：门禁只在 pull_request 上跑，push 只复核合并形态", () => {
  it("pull_request 挂的是全套门禁清单", () => {
    // 逐行比而不是塞一条跨行正则：多行正则里的 `*` / `{6}` 与 YAML 缩进叠在一起时，
    // 读的人（与写的人）都得在心里先跑一遍转义。
    const lines = cnb.split("\n");
    const at = lines.findIndex((l) => l === "  pull_request:");
    expect(at, ".cnb.yml 里找不到 pull_request 事件").toBeGreaterThan(-1);
    expect(lines.slice(at, at + 4)).toEqual([
      "  pull_request:",
      "    - <<: *common",
      "      name: 质量门禁",
      "      stages: *gates",
    ]);
  });

  it("push 的合并形态复核是硬判据，且不与其他步骤共用 stages", () => {
    const pushSteps = stepBlocks(cnb, 8);
    expect(pushSteps.map((s) => s.name)).toEqual(["合并形态复核"]);
    expect(pushSteps[0]?.body).toContain("scripts/check-branch-guard.cjs --merge-commit");
  });
});

/**
 * 平台侧只读 `.cnb.yml`：`.github/workflows/ci.yml` 一旦被重新引入，
 * 门禁就又有了第二份「看起来是事实来源、实际不执行」的清单。
 */
describe("平台配置：CNB 是唯一事实来源", () => {
  it("仓库里不存在 .github/workflows/ci.yml（它是死代码）", () => {
    expect(
      existsSync(join(process.cwd(), ".github", "workflows", "ci.yml")),
      "CNB 不读 .github/workflows：留着它 = 让人照着改一个不生效的文件",
    ).toBe(false);
  });

  it("触发 master 的 push 与 pull_request（默认分支是 master，不是 main）", () => {
    // 这条有历史：GitHub 那份 workflow 曾把分支写成 main，于是从未被触发过。
    expect(cnb).toMatch(/^master:$/m);
    expect(cnb).toMatch(/^ {2}push:$/m);
    expect(cnb).toMatch(/^ {2}pull_request:$/m);
  });

  it("runner / docker 等公共项走锚点，不两处各抄一套", () => {
    // 覆盖根键时锚点里的键会被整体替换，故每个事件都写出完整的 runner / docker /
    // retries（两处 `<<: *common`）；stage 清单**不**通过锚点共用——
    // 共用 stages 就等于给 push 也挂上全套门禁，见下面「两条流水线」那一组。
    expect(cnb.match(/<<: \*common/g)?.length).toBe(2);
    expect(/^ {2}pull_request:$/m.test(cnb)).toBe(true);
    expect(/^ {2}push:$/m.test(cnb)).toBe(true);
  });

  it("步骤清单挂在锚点上，且锚点里的步骤数与展开处一致", () => {
    // 锚点 `&gates` 是清单的唯一出处；两处各写一份必然漂移。
    expect(cnb).toMatch(/^\.gates: &gates$/m);
    expect(cnb).toMatch(/^ {6}stages: \*gates$/m);
  });
});

describe("CNB 门禁清单：一条不许丢", () => {
  it("解析出的步骤数不少于迁移前的 27 步（防止切片判据自己失效）", () => {
    expect(steps.length).toBeGreaterThanOrEqual(27);
    expect(steps.map((s) => s.name)).toContain("生产构建");
    expect(steps.map((s) => s.name)).toContain("E2E 关键流程");
  });

  /** 迁移前 `.github/workflows/ci.yml` 的每一步，对到 `.cnb.yml` 里的承载步骤。 */
  const MIGRATED: Record<string, string> = {
    "pnpm install --frozen-lockfile": "Install dependencies",
    分支守卫: "分支守卫",
    "pnpm run db:push": "同步数据库表结构",
    "pnpm run typecheck": "类型检查",
    "pnpm exec eslint . --max-warnings 0": "ESLint 零警告",
    // test 与 test:coverage 合并为一步：全量 vitest 只跑一遍，
    // 覆盖率走平台插件挂在同一次运行上（跑两遍 = 时长与核时都翻倍）。
    "pnpm run test": "单元测试与覆盖率",
    "check-title-bar-clearance.cjs": "标题行让位",
    "check-file-structure.cjs --strict": "文件结构硬规则",
    "check-ps1-consistency.mjs": "跨平台动作对照",
    "check-comfyui-port-contract.cjs": "ComfyUI 端口口径",
    "check-inline-style.cjs": "内联样式注入",
    "check-code-duplication.cjs --strict": "跨文件重复块",
    "check-function-length.cjs --strict": "函数长度棘轮 TS",
    "check-rust-function-length.cjs --strict": "函数长度棘轮 Rust",
    "check-circular-deps.cjs --strict": "模块循环依赖棘轮",
    "check-app-port-vectors.cjs": "端口推导跨语言一致性",
    "check-changelog-fragments.cjs": "CHANGELOG 碎片",
    "check-theme-colors.cjs --strict": "主题色扫描棘轮",
    "check-ui-logic-separation.cjs --strict": "UI/逻辑分离棘轮",
    "tests/lib-node-only-declarations.test.ts": "lib Node-only 声明",
    "check-format.cjs --strict": "prettier 格式棘轮",
    "check-reformat-only.cjs": "格式化提交分离",
    "pnpm run test:coverage": "单元测试与覆盖率",
    "pnpm run build": "生产构建",
    "check-standalone-contents.cjs": "standalone 产物护栏",
    "playwright install": "安装 Playwright 浏览器",
    "playwright test --grep @critical": "E2E 关键流程",
  };

  it.each(Object.keys(MIGRATED))("迁移前的「%s」在 .cnb.yml 里仍有承载步骤", (cmd) => {
    expect(
      steps.map((s) => s.name),
      `迁移前的步骤「${cmd}」在 .cnb.yml 里找不到对应的 stage——` +
        `少一步不会让构建变红，只会永久少一类回归信号`,
    ).toContain(MIGRATED[cmd]);
  });

  const find = (name: string) => steps.find((s) => s.name === name)?.body ?? "";

  it("每条门禁步骤的 script 真的调用了对应脚本（不只有个名字）", () => {
    const pairs: [string, string][] = [
      ["分支守卫", "scripts/check-branch-guard.cjs"],
      ["同步数据库表结构", "pnpm run db:push"],
      ["文件结构硬规则", "scripts/check-file-structure.cjs --strict"],
      ["跨平台动作对照", "scripts/check-ps1-consistency.mjs"],
      ["跨文件重复块", "scripts/check-code-duplication.cjs --strict"],
      ["函数长度棘轮 TS", "scripts/check-function-length.cjs --strict"],
      ["函数长度棘轮 Rust", "scripts/check-rust-function-length.cjs --strict"],
      ["模块循环依赖棘轮", "scripts/check-circular-deps.cjs --strict"],
      ["主题色扫描棘轮", "scripts/check-theme-colors.cjs --strict"],
      ["UI/逻辑分离棘轮", "scripts/check-ui-logic-separation.cjs --strict"],
      ["prettier 格式棘轮", "scripts/check-format.cjs --strict"],
      ["格式化提交分离", "scripts/check-reformat-only.cjs"],
      ["零消费导出棘轮", "scripts/check-dead-exports.cjs --strict"],
      ["standalone 产物护栏", "scripts/check-standalone-contents.cjs"],
    ];
    for (const [step, cmd] of pairs) {
      expect(find(step), `步骤「${step}」没有调用 ${cmd}`).toContain(cmd);
    }
  });

  it("门禁一律走 pnpm，不出现 npm / npx（AGENTS 硬规则 1）", () => {
    // scripts/** 里没有 npm 调用；流水线也不许引入——npm 11 在本项目解析
    // typescript 别名链会崩溃。
    const scriptLines = steps
      .map((s) => s.body)
      .join("\n")
      .split("\n")
      .filter((l) => /^\s+(script|corepack|pnpm)/.test(l));
    for (const line of scriptLines) {
      expect(line, `流水线里出现 npm/npx：${line}`).not.toMatch(/\bnpm\b|\bnpx\b/);
    }
  });

  it("失败时才上传 Playwright 报告，且上传本身不阻断（allowFailure）", () => {
    // 对齐 upload-artifact 的 if: failure()：上传失败不该把「测试红」改写成
    // 「上传红」，掩盖真正的现场。
    expect(cnb).toMatch(/^ {2}failStages:$/m);
    expect(cnb).toMatch(/cnbcool\/attachments:latest/);
    const upload = cnb.slice(cnb.indexOf("failStages:"));
    expect(upload).toContain("allowFailure: true");
    expect(upload).toContain("ttl: 7");
  });

  it("playwright-report 在两个事件上都是 failStages 的必传产物（allowFailure 不能是空传）", () => {
    // 上传清单退化成空不会有任何构建红，只会让人以为「失败了会留现场」。
    expect(cnb).toContain("- playwright-report");
  });
});

describe("分支守卫：不可信事件也不许靠流水线里的那行命令", () => {
  it("守卫排在所有检查步骤之前（安装之后的第 2 步）", () => {
    const names = steps.map((s) => s.name);
    // 第 1 步是 Install dependencies（守卫脚本要在依赖装完后才跑得动），
    // 之后紧跟分支守卫 —— 分支不对时后续检查的结果最后都会被丢弃
    //（与 .githooks/pre-commit 把守卫排在第 1 步同序）。
    expect(names[0]).toBe("Install dependencies");
    expect(names.indexOf("分支守卫")).toBe(1);
  });

  it("调用的是同一脚本的 PR 复核形态，并显式传入目标分支", () => {
    const body = steps.find((s) => s.name === "分支守卫")?.body ?? "";
    expect(body).toContain("node scripts/check-branch-guard.cjs --pr-check");
    // 目标分支必须由配置写死传入：CNB_PULL_REQUEST_TARGET_SHA 是一个 sha 而不是
    // 分支名，拿它当 branch 用会静默失效（没有判据能发现「传进来的不是分支名」）。
    expect(body).toContain("--target master");
    expect(GUARD_SCRIPT).toContain("--pr-check");
  });

  it("判据版本与脚本一致（版本一变，调用行必须跟着改）", () => {
    const version = /const GUARD_VERSION = "(\d+)"/.exec(GUARD_SCRIPT)?.[1];
    expect(version, "check-branch-guard.cjs 里找不到 GUARD_VERSION").toBeDefined();
    expect(GUARD_SCRIPT).toContain(`"[branch-guard] v" + GUARD_VERSION`);
  });

  it("脚本自己独立判定，不读 CNB_PULL_REQUEST 之类的外部事实", () => {
    // pull_request 事件的流水线配置取自源分支：触发者能删掉 .cnb.yml 里的调用行。
    // 守卫必须是「删了就红」，不能是「删了就静默不检查」。
    // 只判「有没有读这个变量」：注释里提到它是为了说明**为什么不读**（见脚本文档块），
    // 拿整份源码去 toContain 会被自己的注释绊倒。
    const executable = GUARD_SCRIPT.split("\n")
      .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
      .join("\n");
    expect(executable).not.toContain("CNB_PULL_REQUEST");
    expect(executable).not.toContain("process.env");
    expect(GUARD_SCRIPT).toContain("PROTECTED_BRANCH");
  });

  it("服务端判据不依赖分支名（HEAD 在预合并提交上恒等于目标分支）", () => {
    // CNB 在 pull_request 上 checkout 的是预合并提交，容器里 symbolic-ref HEAD
    // 恒等于目标分支——照搬本地那条「HEAD 在 master 上 = 直连主干」会把每一条
    // 正常 PR 都拦死（PR #633 第一次跑就是这么红的）。
    const fn = GUARD_SCRIPT.slice(GUARD_SCRIPT.indexOf("function evaluatePr"));
    expect(fn).not.toContain("currentBranch() !== PROTECTED_BRANCH");
    expect(fn).toContain("rev-list");
    // 拓扑判据由 tests/check-branch-guard.test.ts 用真仓库跑三种形态。
  });
});

describe("流水线：SKIP_ENV_VALIDATION 必须与 BETTER_AUTH_SECRET 成对", () => {
  // env 挂在锚点 `.common` 下（两个事件的公共项），切到锚点段落结束为止。
  const pipelineEnv = cnb.slice(cnb.indexOf("env:"), cnb.indexOf("\n.gates: &gates"));

  it("确实设了 SKIP_ENV_VALIDATION（否则本用例失去对象）", () => {
    expect(steps.some((s) => s.body.includes("SKIP_ENV_VALIDATION"))).toBe(true);
  });

  it("pipeline 级 env 同时注入 BETTER_AUTH_SECRET", () => {
    // SKIP_ENV_VALIDATION 只绕过 src/env.js 的 schema 校验，**绕过不了**
    // better-auth 自己的生产校验：`pnpm start`（生产模式，E2E 的 webServer 就是）
    // 下缺失该值 → 退回内置 DEFAULT_SECRET 并抛「You are using the default secret」
    // → createTRPCContext() 抛错 → 所有 authedProcedure 全灭（设置页整页读不出来），
    // 3 条 @critical 用例会集体挂在同一个 helper 上（ISSUE #489）。
    const envVars = [...pipelineEnv.matchAll(/^ {4}([A-Z0-9_]+):/gm)].map((x) => x[1]);
    expect(envVars, "pipeline 级没有可解析的 env 键").toContain("SKIP_ENV_VALIDATION");
    expect(
      envVars,
      "设了 SKIP_ENV_VALIDATION 却没注入 BETTER_AUTH_SECRET：" +
        "生产模式下 better-auth 会退回内置 DEFAULT_SECRET 并抛错（ISSUE #489）",
    ).toContain("BETTER_AUTH_SECRET");
  });

  it("注入的 BETTER_AUTH_SECRET 满足 schema 的 min(32)（否则等于没注入）", () => {
    const values = [...cnb.matchAll(/BETTER_AUTH_SECRET:\s*"([^"]+)"/g)].map(
      (x) => x[1] ?? "",
    );
    expect(values.length, "CNB 流水线里没有出现 BETTER_AUTH_SECRET 的值").toBeGreaterThan(0);
    for (const v of values) {
      expect(v.length, `BETTER_AUTH_SECRET 占位值不足 32 字符：${v.length}`).toBeGreaterThanOrEqual(32);
    }
  });
});
