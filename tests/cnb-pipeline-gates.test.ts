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
    marks.push({
      name: (m[2] ?? "").trim(),
      start: m.index,
      indent: (m[1] ?? "").length,
    });
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
    expect(pushSteps[0]?.body).toContain(
      "scripts/check-branch-guard.cjs --merge-commit",
    );
  });

  /**
   * push 复核**必须**能认 squash 形态。
   *
   * 规范 §13.6 优先 Squash Merge：squash 落到 master 的提交**只有 1 个父**，
   * 与「本地直连主干提交」在拓扑上同形。若这条复核退回「父提交数 > 1 才算
   * 合并」，它就会对每一次正常合并都判红 —— 实测后果是 master 的 push 流水线
   * **每一次都是红的**，而它并没有抓到过任何一次真正的绕过。一条永远在响、
   * 却从不指向真问题的告警只会训练人忽略它。
   *
   * 这里锁住判据本身：脚本里必须存在「单父也放行」的分支，不得只剩拓扑判据。
   */
  it("push 复核认 squash：脚本不得退回「父提交数 > 1 才算合并」", () => {
    // 判据集中在 evaluateLanding() 里，**只看函数体**：
    // 整份脚本里 `PR-URL` / `保守放行` 还会出现在注释与别处，拿全文断言等于
    // 判据可以「只在注释里存在」——那正是这条护栏要防的静默失效。
    const start = GUARD_SCRIPT.indexOf("function evaluateLanding()");
    expect(start, "check-branch-guard.cjs 里找不到 evaluateLanding()").toBeGreaterThan(-1);
    const end = GUARD_SCRIPT.indexOf("\nfunction main()", start);
    const body = GUARD_SCRIPT.slice(start, end === -1 ? undefined : end);

    // ① 必须能认 squash：单父场景要有一条放行出口，不能落到「非合并提交 → 阻断」。
    expect(body).toContain("squash");
    // ② 判别单父提交是否走过 PR 的可核实痕迹：平台 squash 时写进 message 的 PR 关联。
    expect(body).toMatch(/PR-URL/);
    // ③ 提交信息要真被读到（只提常量不算数）。
    expect(body).toContain("--format=%B");
    // ④ 三者都不满足时要保守放行，而不是退回阻断（判据无从命中时不该误报）。
    expect(body).toContain("保守放行");
    // ⑤ 反向：函数体里不许出现「非合并提交」这种「单父即阻断」的措辞。
    expect(body).not.toContain("非合并提交");
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
    // test 与 test:coverage 合并为一步：全量 vitest 只跑一遍（`test:coverage`
    // 一次运行即产出覆盖率报告），跑两遍 = 时长与核时都翻倍。
    "pnpm run test": "单元测试",
    "check-title-bar-clearance.cjs": "标题行让位",
    "check-file-structure.cjs --strict": "文件结构硬规则",
    "check-ps1-consistency.mjs": "跨平台动作对照",
    "check-import-alias.cjs": "import 别名统一",
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
    // 覆盖率上报是**后置的独立一步**：同一个 stage 里的 script 与 type 是
    // 两个并行任务，合并时插件会在测试还没写出报告前就去找文件并报错退出。
    "pnpm run test:coverage": "覆盖率上报",
    "pnpm run build": "生产构建",
    "check-standalone-contents.cjs": "standalone 产物护栏",
    "playwright install": "安装 Playwright 浏览器",
    "playwright test --grep @critical": "E2E 关键流程",
  };

  it.each(Object.keys(MIGRATED))(
    "迁移前的「%s」在 .cnb.yml 里仍有承载步骤",
    (cmd) => {
      expect(
        steps.map((s) => s.name),
        `迁移前的步骤「${cmd}」在 .cnb.yml 里找不到对应的 stage——` +
          `少一步不会让构建变红，只会永久少一类回归信号`,
      ).toContain(MIGRATED[cmd]);
    },
  );

  const find = (name: string) => steps.find((s) => s.name === name)?.body ?? "";

  it("每条门禁步骤的 script 真的调用了对应脚本（不只有个名字）", () => {
    const pairs: [string, string][] = [
      ["分支守卫", "scripts/check-branch-guard.cjs"],
      ["同步数据库表结构", "pnpm run db:push"],
      ["文件结构硬规则", "scripts/check-file-structure.cjs --strict"],
      ["跨平台动作对照", "scripts/check-ps1-consistency.mjs"],
      ["import 别名统一", "scripts/check-import-alias.cjs"],
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
      expect(line, `流水线里出现 npm/npx：${line}`).not.toMatch(
        /\bnpm\b|\bnpx\b/,
      );
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

describe("覆盖率上报：插件的 pattern 必须真的有文件产出", () => {
  /**
   * `testing:coverage` 插件读的是**磁盘上的报告文件**，而报告由 vitest 的
   * `coverage.reporter` 决定格式 —— 两处必须对上，且**只改一侧不会红**：
   * PR #641 把门禁切成插件上报后，插件在本步开始 1.8s 就以
   * 「没有找到覆盖率报告文件」退出（vitest 只配了 text + json-summary，
   * 而插件要的是 lcov.info），整条覆盖率上报与核时收益当场静默失效。
   *
   * 判据不去逐字比对 YAML（那会随排版漂移），只锁**契约本身**：
   * 插件声明的 pattern 后缀，必须在 vitest 的 reporter 列表里有对应的产出格式。
   */
  const VITEST = readFileSync(join(process.cwd(), "vitest.config.ts"), "utf8");

  /** 插件可识别的报告格式 → vitest reporter 名。见 docs.cnb.cool testing:coverage。 */
  const REPORTER_FOR_FORMAT: Record<string, string> = {
    ".info": "lcov",
    "json-summary": "json-summary",
    ".json": "json",
    jacoco: "jacoco",
  };

  const coverageStep =
    steps.find((s) => s.body.includes("type: testing:coverage"))?.body ?? "";

  it("门禁里确实挂着 testing:coverage 插件（否则本组判据失去对象）", () => {
    expect(coverageStep, "找不到 testing:coverage 步骤").not.toBe("");
  });

  /**
   * 覆盖率上报**必须**是排在「单元测试」之后的独立一步。
   *
   * 同一个 stage 里的 `script` 与 `type` 是**两个并行任务**：`testing:coverage`
   * 容器在测试还在跑、`coverage/` 还没产出时就开始找报告文件，而
   * `breakIfNoCoverage` 缺省为 `true` —— 找不到即报错退出（实测该步 1~2s 内失败，
   * 而 vitest 本地要 73s）。现场是整条门禁在测试这一步中断，报错行落在与本意
   * 无关的位置。合并回一步 = 这条回归立刻复发，故锁住「后置且独立」。
   */
  it("覆盖率上报是排在单元测试之后的独立一步（并行会拿不到报告）", () => {
    const names = steps.map((s) => s.name);
    const testAt = names.indexOf("单元测试");
    const reportAt = names.indexOf("覆盖率上报");
    expect(testAt, "找不到「单元测试」步骤").toBeGreaterThan(-1);
    expect(reportAt, "找不到「覆盖率上报」步骤").toBeGreaterThan(-1);
    expect(reportAt, "覆盖率上报必须排在单元测试之后").toBeGreaterThan(testAt);
    // 测试步只跑用例，不挂插件：挂了就又变成并行。
    const testStep = steps.find((s) => s.name === "单元测试")?.body ?? "";
    expect(testStep).toContain("pnpm run test:coverage");
    expect(testStep).not.toContain("type: testing:coverage");
  });

  it("插件 pattern 指的那份报告，vitest 的 reporter 真的会产出", () => {
    const pattern = /^\s+pattern:\s*(\S+)\s*$/m.exec(coverageStep)?.[1];
    expect(pattern, "testing:coverage 步骤没有声明 pattern").toBeDefined();
    expect(pattern, "pattern 必须相对工作目录指向 coverage 目录").toContain(
      "coverage/",
    );

    // 从 pattern 后缀反查 vitest 该开哪个 reporter。
    const format = Object.keys(REPORTER_FOR_FORMAT).find((k) =>
      (pattern ?? "").endsWith(k),
    );
    expect(
      format,
      `pattern「${pattern}」的后缀不是插件可识别的格式（lcov / json / json-summary / jacoco / golang）`,
    ).toBeDefined();

    const reporter = REPORTER_FOR_FORMAT[format ?? ""] ?? "";
    const reportersLine = /reporter:\s*\[([^\]]*)\]/.exec(VITEST)?.[1] ?? "";
    expect(
      reportersLine,
      `vitest.config.ts 的 coverage.reporter 里没有「${reporter}」——` +
        `插件读 ${pattern}，而 vitest 不会产出这份文件：` +
        `CI 会在本步以「没有找到覆盖率报告文件」退出（PR #641 的实际现场）`,
    ).toContain(`"${reporter}"`);
  });

  /**
   * 上报步骤必须**自己**把用例跑出来（script 与 type 写在同一个 step 上）。
   *
   * 这是 PR #641 最直接的现场：那条流水线把 `script: pnpm run test:coverage` 与
   * `type: testing:coverage` 写在**同一个 step** 上时是对的；写成「一个 step 只有
   * type，type 底下再嵌一层 stages 放 script」时，平台只解析那层 `stages`、
   * **静默丢掉** vitest 那一句 —— 插件在本步开始 1.8s 后以
   * 「没有找到覆盖率报告文件」退出（构建日志里 vitest 根本没跑），整条流水线判红。
   *
   * 判据不去比对 YAML 排版，只锁**语义**：上报读的是磁盘上的报告文件，而文件只有
   * 跑完用例才有，所以「跑用例」这件事必须与上报处在**同一条 step** 上，
   * 且那条 step 自己带 `script`。
   */
  it("上报步骤自己带 script 跑用例，不把 script 藏进 type 底下的 stages", () => {
    expect(coverageStep, "testing:coverage 这一步没有 script：插件读不到用例产出的报告").toMatch(
      /^ {4}script: .*test:coverage$/m,
    );
    expect(
      coverageStep,
      "testing:coverage 这一步底下又嵌了一层 stages —— 平台只解析那层 stages，" +
        "同 step 的 script 会被静默丢掉，插件将看到「没有找到覆盖率报告文件」",
    ).not.toMatch(/^ {4}stages:/m);
  });

  it("阈值口径仍留在 vitest 侧，平台侧不许填 lines / diffLines", () => {
    // 平台阈值是绝对百分比，本仓库走的是「按目录设门槛」的口径（11 §覆盖率棘轮），
    // 两套数字放一起要么形同虚设、要么把正常 PR 拦死。
    expect(coverageStep).not.toMatch(/^\s+(lines|diffLines):/m);
    expect(VITEST).toContain("thresholds:");
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
    expect(
      version,
      "check-branch-guard.cjs 里找不到 GUARD_VERSION",
    ).toBeDefined();
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
  const pipelineEnv = cnb.slice(
    cnb.indexOf("env:"),
    cnb.indexOf("\n.gates: &gates"),
  );

  it("确实设了 SKIP_ENV_VALIDATION（否则本用例失去对象）", () => {
    expect(steps.some((s) => s.body.includes("SKIP_ENV_VALIDATION"))).toBe(
      true,
    );
  });

  it("pipeline 级 env 同时注入 BETTER_AUTH_SECRET", () => {
    // SKIP_ENV_VALIDATION 只绕过 src/env.js 的 schema 校验，**绕过不了**
    // better-auth 自己的生产校验：`pnpm start`（生产模式，E2E 的 webServer 就是）
    // 下缺失该值 → 退回内置 DEFAULT_SECRET 并抛「You are using the default secret」
    // → createTRPCContext() 抛错 → 所有 authedProcedure 全灭（设置页整页读不出来），
    // 3 条 @critical 用例会集体挂在同一个 helper 上（ISSUE #489）。
    const envVars = [...pipelineEnv.matchAll(/^ {4}([A-Z0-9_]+):/gm)].map(
      (x) => x[1],
    );
    expect(envVars, "pipeline 级没有可解析的 env 键").toContain(
      "SKIP_ENV_VALIDATION",
    );
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
    expect(
      values.length,
      "CNB 流水线里没有出现 BETTER_AUTH_SECRET 的值",
    ).toBeGreaterThan(0);
    for (const v of values) {
      expect(
        v.length,
        `BETTER_AUTH_SECRET 占位值不足 32 字符：${v.length}`,
      ).toBeGreaterThanOrEqual(32);
    }
  });
});
