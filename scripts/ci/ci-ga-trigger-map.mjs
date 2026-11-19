/**
 * ci-ga-trigger-map.mjs — CNB 触发口 ⇄ GA workflow 的**配对注册表**（ISSUE #3504）
 * ===========================================================================
 *
 * 背景：CNB 侧不再执行任何构建（`daily_gates` / `oneshot_*` / `package_gates`
 * 三张执行清单随 #3504 整体退役），CNB 的手动 / API 触发口只做一件事 ——
 * 调 GA 的 `workflow_dispatch` 把对应档派发到 GitHub Actions 上跑。
 *
 * 「哪条触发口派发到哪个 workflow 文件」是一个**决定**，不能从文本推出来，
 * 所以它存在这里，判据 import 它：
 *
 *   · `tests/ci-ga-trigger-map.test.ts` 解析 `.cnb.yml` 里每条触发口的派发 stage，
 *     断言 `--preset` 与本表逐字相等；再对每个 workflow 文件断言它存在、
 *     带 `workflow_dispatch`（带 `head_sha` 输入）、并发组与本表一致。
 *
 * 表里的每个键都是**判据面**：加一条触发口必须同批加一行；删一条必须同批删一行 ——
 * 「按钮还在、派发目标没了」或「派发目标在、没人触发」都当场红。
 */

/**
 * 一行的形状：一个触发档 + 它的两个触发口事件键 + 两条流水线名 + GA 派发目标。
 *
 * ⚠️ `preset` 是 `ci-ga-dispatch.mjs` 的 `--preset` 入参（派发脚本的唯一路由依据）；
 * `workflow` 是镜像仓（`GITHUB_MIRROR_REPO`，缺省 `wuxianyuedu/comfy-app`）里
 * `.github/workflows/` 下的文件名 —— 派发走 `POST /actions/workflows/{file}/dispatches`。
 *
 * ⚠️ `concurrencyGroup` 是 GA 侧 `concurrency.group` 的字面值：同一档连点两次时
 * GA 自己掐掉旧跑（与 CNB 那把同族锁互为两面 —— CNB 锁挡「重复派发排队」，
 * GA 并发组挡「两跑同时压 runner」）。
 *
 * @typedef {{
 *   preset: string,
 *   eventWeb: string,
 *   eventApi: string,
 *   pipelineWeb: string,
 *   pipelineApi: string,
 *   workflow: string,
 *   concurrencyGroup: string,
 * }} GaTriggerTarget
 */

/** @type {GaTriggerTarget[]} */
export const GA_TRIGGER_TARGETS = [
  {
    preset: "daily",
    eventWeb: "web_trigger_daily",
    eventApi: "api_trigger_daily",
    pipelineWeb: "每日档（手动触发）",
    pipelineApi: "每日档（API 触发）",
    workflow: "daily.yml",
    concurrencyGroup: "daily",
  },
  {
    preset: "build",
    eventWeb: "web_trigger_build",
    eventApi: "api_trigger_build",
    pipelineWeb: "单跑生产构建（手动触发）",
    pipelineApi: "单跑生产构建（API 触发）",
    workflow: "oneshot-build.yml",
    concurrencyGroup: "oneshot-build",
  },
  {
    preset: "e2e",
    eventWeb: "web_trigger_e2e",
    eventApi: "api_trigger_e2e",
    pipelineWeb: "单跑全量E2E（手动触发）",
    pipelineApi: "单跑全量E2E（API 触发）",
    workflow: "oneshot-e2e.yml",
    concurrencyGroup: "oneshot-e2e",
  },
  {
    preset: "unit",
    eventWeb: "web_trigger_unit",
    eventApi: "api_trigger_unit",
    pipelineWeb: "单跑全量单测（手动触发）",
    pipelineApi: "单跑全量单测（API 触发）",
    workflow: "oneshot-unit.yml",
    concurrencyGroup: "oneshot-unit",
  },
  {
    preset: "package",
    eventWeb: "web_trigger_package",
    eventApi: "api_trigger_package",
    pipelineWeb: "桌面成品包（手动触发）",
    pipelineApi: "桌面成品包（API 触发）",
    workflow: "package-desktop.yml",
    concurrencyGroup: "package",
  },
];

/**
 * 按 preset 取一行。派发脚本用它把 `--preset` 路由到 workflow 文件；
 * 缺名 / 打错名在这里就红（三态退 2），而不是等到 GitHub 404 才看见。
 *
 * @param {string} preset `--preset` 入参
 * @param {GaTriggerTarget[]} [targets] 缺省用本表（测试可注入替身）
 * @returns {GaTriggerTarget | undefined}
 */
export function findTriggerTarget(preset, targets = GA_TRIGGER_TARGETS) {
  return targets.find((t) => t.preset === preset);
}

/**
 * 每日档的「格名 ⇄ GA daily.yml step 名」对照（ISSUE #3504）。
 *
 * 键 = 每日格的**逻辑名**（带 `每日` 前缀的那一套）：`FRESHNESS_TRACKS[*].ciStage`、
 * 门格总账的历史登记、freshness-gate 的读数话术都念它 —— 改它要同批改三处，所以它
 * 留作稳定键。值 = `.github/workflows/daily.yml` 里承接同一格的 **step 名（逐字，
 * 含括号后缀）**：执行者核对面从 `.cnb.yml` 的 `COMFYAPP_CI_DAILY_GATES`（已退役）
 * 换到 GA 侧这份文件，step 名就是判据的匹配面 —— 改 step 名必须同批改这里的值。
 *
 * 刻意**不**收进来的：`检出` / `装 pnpm` / `装 Node`（GA 的前提设施，不是门格）、
 * `环境证据`（`if: failure()` 的诊断读数，恒不判红）—— 见总账的 infra 豁免清单。
 *
 * @type {Record<string, string>}
 */
export const DAILY_GATE_EXECUTORS = {
  每日失败立案: "失败立案（补洞：GA 每日档跑红 ⇒ CNB 单，按格名去重）",
  每日安装依赖: "安装依赖（allowBuilds 清单见 pnpm-workspace.yaml）",
  每日同步数据库表结构: "同步数据库表结构（cnb 同款判据一字不改）",
  每日新鲜度账: "新鲜度账（cnb 同款判据一字不改）",
  每日生产构建: "生产构建（cnb 同款判据一字不改）",
  "每日 ESLint 零警告": "ESLint 零警告（cnb 同款判据一字不改：pnpm run lint，不是 eslint .）",
  每日浏览器安装: "浏览器安装（cnb 同款入口；npmmirror 镜像源同 CNB）",
  每日全量E2E: "全量E2E（cnb 同款判据一字不改）",
  "每日 API 文档生成与自检": "API 文档生成与自检（cnb 同款判据一字不改）",
  每日单元测试: "单元测试（排最后：唯一会因机器负载而红的一档，同 CNB 口径）",
  覆盖率上报: "覆盖率报告（artifact；对位 CNB 的 `覆盖率上报` 格）",
};

/**
 * 按逻辑格名取它在 GA daily.yml 里的执行者 step 名。
 * 打错键在这里就抛（判据面缺一行当场红），而不是等核对面静默放行。
 *
 * @param {string} gate 每日格的逻辑名（如 `每日生产构建`）
 * @param {Record<string, string>} [executors] 缺省用本表（测试可注入替身）
 * @returns {string}
 */
export function dailyGateExecutor(gate, executors = DAILY_GATE_EXECUTORS) {
  const step = executors[gate];
  if (typeof step !== "string" || step === "") {
    throw new Error(`每日格缺 GA 执行者登记：${gate}`);
  }
  return step;
}

/**
 * GA 派发 stage 在 `.cnb.yml` 里的格名（按档起名，web / API 两条流水线共用同一格名
 * —— 两条的格正文逐字相同，与旧 `*daily_gates` 锚点被两条触发口共用的形态同构）。
 *
 * @param {GaTriggerTarget} target
 * @returns {string}
 */
export function dispatchStageName(target) {
  /** @type {Record<string, string>} */
  const labels = {
    daily: "每日档",
    build: "单跑生产构建",
    e2e: "单跑全量E2E",
    unit: "单跑全量单测",
    package: "桌面成品包",
  };
  const label = labels[target.preset];
  if (!label) {
    throw new Error(`preset 缺格名映射：${String(target.preset)}`);
  }
  return `GA 派发·${label}`;
}
