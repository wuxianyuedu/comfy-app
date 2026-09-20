// @ts-nocheck -- 提交门槛脚本:文件命名/组织硬规则(供 .githooks/pre-commit 调用)
/**
 * 文件组织硬规则(规范见 docs/standards/12-代码组织与文件结构.md):
 *   R1  src 下 .tsx 文件名必须 PascalCase(测试伙伴文件 X.test.tsx 同样以大写开头;
 *       豁免:src/app 下 Next 保留名、CONVENTION_EXEMPT 列出的库惯例文件、
 *       目录索引 index.tsx;src/components/ui/ 采用 shadcn 官方 kebab-case 约定
 *       (硬强制 kebab,禁止 PascalCase——§12.6/§12.8)
 *   R2  src 下 .ts 文件名禁止 PascalCase(非组件模块一律 kebab-case)
 *       (src/ 根下的 Next 约定文件 proxy.ts 由 R2_EXEMPT 豁免——它是框架
 *        保留名,不能改名;配套 R11 保证它没被放错位置或悄悄消失)
 *   R3  禁止时间戳备份文件(\d{8}_\d{6} 模式)——版本回退用 git,不进 src
 *   R4  src/lib 下禁止 .tsx(12.5:lib 无 React)
 *   R5  src/ 下超 900 行的文件列入拆分候选。**默认只提醒不阻塞**;
 *       `--strict`(CI)下按棘轮 `scripts/.file-size-baseline.json` 判:**新增**
 *       超限文件即阻断(存量的只许降不许升)。
 *       扫描范围是**整个 src/**:页面的纯展示视图在 src/app/(settings/SettingsPageView.tsx
 *       2499 行),逻辑层的大文件在 src/lib/(lifecycle.ts 1041 行)——
 *       只扫 components 会让最大的那几个文件完全落在护栏之外(ISSUE #536)。
 *       棘轮的理由(ISSUE #575 第 8 项):「只提醒」挡不住新增长文件 ——
 *       提醒出现在一屏输出里,没有人会因为一行提示去拆文件,于是文件只增不减。
 *   R7  Windows 双击入口一律 .ps1:仓库内禁止新增 .bat/.cmd/.vbs
 *       (ISSUE #23 / 规范 launch-and-build.md §8:.bat 走 cmd 的 GBK 代码页,
 *        中文必乱码,历史上被迫做成"不含中文不含逻辑"的哑壳)
 *   R8  scripts/ tools/ 下含中文的 .ps1 必须以 UTF-8 BOM 保存(否则 PowerShell
 *       5.1 按 GBK 解码,与 .bat 乱码同源)
 *   R9  根目录只放工程配置,禁止再散落 .ps1 双击入口(ISSUE #29):入口一律归入
 *       tools/<分类>/;根入口的 discoverability 由 README 的入口清单承担,
 *       不靠"铺在根目录第一眼看见"
 *   R10 注释里禁止「历史流水」:日期(2026-08-17)、改动编号(R-ardot114 / R83 /
 *       R-Next)、任务批次号(T12-3)。这些归 git log,写进注释会随代码搬迁过期
 *       失真(ISSUE #46 / 规范 12.4.2 / 反模式表 G4)。
 *       扫 `.ts` / `.tsx` **与 `.css`** —— 样式文件的注释同样会写「R-ardot18
 *       (2026-08-14): 这里为什么这么写」,而它恰恰是最容易被搬来搬去的一类
 *       (只扫 TS 时,globals.css 里就有三处这样的遗留长期未被发现)。
 *   R13 src/lib 子域纪律:根目录只放「顶层单例地基」(见 DOMAIN_EXEMPT),
 *       其余模块一律归属某个子域目录(§12.5.3)。叶子域平铺、不再套一层
 *       admin/other/shared —— 那一层既说不出「谁属于它」,又会让
 *       「一个域一个目录」的对应关系变成「一个域一个目录 + 一个杂物间」。
 *   R14 src/lib 子域目录名必须在 DOMAINS 里登记(新增域是一次设计决定,
 *       不是 mkdir 的副作用;漏登记会让 R13 的归属判据永远为绿)。
 *   R12 src/ 源码禁止内嵌控制字符(NUL 及其它 C0/C1 控制符,制表/换行除外)。
 *       源码里带一个真的 NUL 字节 = git / diff / grep / 多数编辑器一律当
 *       **二进制文件**处理:`git diff` 只回「Binary files differ」(评审看不到
 *       改动)、`git show --stat` 显示为 bin、`grep -rn` 静默跳过整个文件。
 *       曾经用来做「占位符」的 NUL 哨兵(规范 12.11)是它的来源,现已改为
 *       可打印形式;本条防回潮。
 * 违反 R1-R4、R7-R12、R14 以退出码 1 阻断提交。
 *
 * R13（import 别名只有一种前缀 `~`，ISSUE #640）由**独立脚本**
 * `scripts/check-import-alias.cjs` 承担，不在这里实现：判据是「模块说明符的前缀」，
 * 与文件命名/位置无关，混进本文件的 R1-R12 只会让两套口径互相干扰。
 */
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const problems = [];
const splitHints = [];
/** R5 棘轮用:超限文件 → 行数(路径为仓库相对路径,与基线同一口径)。 */
const oversizedFiles = {};

/** R5 的文件行数阈值:超过即进「拆分候选」清单。 */
const SPLIT_HINT_LINES = 900;

/* ── R5 棘轮(ISSUE #575):超限文件路径 → 行数 ──
 * 默认(非 strict)只提醒;`--strict`(CI)下「基线里没有的超限文件」即阻断,
 * 「基线里已有但变大了」一并阻断 —— 只许降不许升。 */
const FILE_SIZE_BASELINE = path.join(__dirname, ".file-size-baseline.json");
/** R5 棘轮的**判据版本**:只有「数行数的口径」本身变了(例如全库 prettier 治理
 *  拆行、整体抬高行长口径)才允许 `--update` 一次性重记,其余情况数字只许下降。
 *  理由与 check-function-length.cjs 的 RULE_VERSION 同源:基线是「该判据下的计数」,
 *  判据一变,旧数字与新计数就不是同一个量 —— 不做标记的重记会被读成「有人放宽棘轮」。
 *
 *  R5_RULE_VERSION 3 变更:行数比对改为按 `baselineRev` **同口径重数**(见下),
 *  不再拿不同「格式时代」的绝对行数直接相减。
 *
 *  R5_RULE_VERSION 4 变更:基线里被记的修订号不可达时,不再拿记录值顶替着比
 *  —— 那等于退回版本 3 要消灭的「跨格式时代相减」,且报错会把「基线过期」误报成
 *  「文件变大」。现在这一支直接指向「重记基线」;记录值也随之一次性重置为
 *  **当前内容**的同口径行数(版本 3 的重记没把这条陷阱一起堵上,存量数字仍
 *  停在另一个格式时代的源码上)。 */
const R5_RULE_VERSION = 4;

/* ── R5 的行数口径:不同「格式时代」的绝对行数不可直接比较 ──
 * 基线里的数字是在**记它的那个格式口径**的源码上数出来的。而「数行数」这件事
 * 不做归一化(逐行状态机,不重排、不合并行长),于是同一段逻辑的行数完全取决于
 * 它写得多紧凑 —— 一次全库 prettier 治理(把紧凑的单行参数表 / 对象字面量展开、
 * 按宽度拆行)就能让「一个字都没改」的文件凭空多出几十行。
 *
 * 实例(ISSUE #637):`LogPanel.tsx` 的基线 1102 记于 prettier 治理**之前**;
 * 治理后同一文件(内容未增)已是 1236 行。此后任何人**一行都不改它**,CI 也会报
 * 「R5 超限文件继续变大(1102 → 1236)」—— 棘轮把「格式口径变化」读成了「这次
 * 改动让文件变大」,而作者根本无从下手(要他为了过门禁把已格式化的文件再压缩回
 * 1102 行,等于让门禁否掉 §13 的 prettier 口径)。
 *
 * 修法:**基线自带记它那一刻的修订号**,比对前先把「基线数字」按那个修订号的
 * 源码重新数一遍 —— 即同口径重数,而不是拿两个时代的绝对行数相减。
 *   · 基线记录 `baselineRev`;
 *   · 比对时用 `git show <rev>:<file>` 取基线版本的文件内容,按**今天同一套
 *     逐行计数**重新数出 `baseLines`,再与当前行数比较;
 *   · 文件在基线版本里不存在(git 取不到)→ 退回基线上的记录值(不误报);
 *   · 基线缺 `baselineRev`(旧基线)→ 退回基线上的记录值(与历史行为一致),
 *     由下一次 `--update` 补上。
 * 判据是「这个文件在**同口径**下比基线那一刻多没多」——格式时代造成的系统性差异
 * 被自动吸收,而真实的膨胀(有人往文件里加代码)照旧阻断。
 *
 * 为什么不用「全仓整体行数比」换算:实测不行。prettier 是**逐文件**重排,各文件
 * 的展开倍率差异极大(同一批文件里既有 0.958 也有 1.130),全仓比例约等于 1.0,
 * 换算后对 `LogPanel.tsx` 仍判「变大 136 行」——即该口径解决不了它要解决的问题。
 *
 * 「取不到基线修订号」这一支有个陷阱:它同时覆盖「真新增的文件」与「基线修订号
 * 已经不可达的存量文件」——后者是**基线自身过期**,不是文件变大,而退回记录值会
 * 把它判成「继续变大」。故判据拆成两支,并把「修订号是否可用」直接写进报错,
 * 见 `BASELINE_REV_USABLE` 与下面的两条 problems。 */

/** 取当前 HEAD 的修订号,写进基线供日后「同口径重数」用。
 *  git 不可用 / 不在检出里时返回 null(退回记录值,不阻断)。 */
function headRev() {
  const res = spawnSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" });
  if (res.status !== 0 || typeof res.stdout !== "string") return null;
  return res.stdout.trim() || null;
}

/** 按**今天的行数口径**重数 `rev` 里该文件的行数;取不到返回 null。
 *  行数口径与主扫描(collectSplitHints)逐字一致:`split("\n").length`。 */
function linesAtRev(rev, rel) {
  if (!rev) return null;
  const res = spawnSync("git", ["show", rev + ":" + rel], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (res.status !== 0 || typeof res.stdout !== "string") return null;
  return res.stdout.split("\n").length;
}

/* ── 基线修订号必须仍可达 ──
 * 「按 baselineRev 同口径重数」有个前提:**那个提交还在当前检出里**。合并提交删掉
 * 被并入的分支后,基线记的修订号(通常是某个分支提交)会变成不可达对象,下一次
 * `git gc` 就把它清掉 —— 此后 `git show <rev>:<file>` 一律失败,同口径重数静默
 * 退化成「拿记录值直接比」,而记录值记在**另一个格式时代**的源码上(见上)。
 *
 * 现场:`LogPanel.tsx` 的基线 988 记于一个已被合并吸收、不再有 ref 指向的分支提交,
 * 而按今天的计数口径、今天的内容重数是 993 行 —— 这个文件**一个字都没改**却天天
 * 判红,且报错写作「R5 超限文件继续变大」,与真实原因(基线修订号不可达)毫无关系。
 *
 * 所以查基线前先确认**基线里那个**修订号真的能被重数:取不到就报出来、指向
 * 「重记基线」,而不是悄悄退回记录值把红判成「文件变大了」。 */
const BASELINE_REV = (function readBaselineRev() {
  if (!fs.existsSync(FILE_SIZE_BASELINE)) return null;
  try {
    return JSON.parse(fs.readFileSync(FILE_SIZE_BASELINE, "utf8")).baselineRev;
  } catch {
    /* 基线损坏由棘轮那一支报「基线文件缺失 / 不可解析」,这里不重复报。 */
    return null;
  }
})();

/** 基线修订号能不能真的拿去重数(在当前检出里可达)。 */
const BASELINE_REV_USABLE =
  typeof BASELINE_REV === "string" &&
  BASELINE_REV.length > 0 &&
  spawnSync("git", ["cat-file", "-e", BASELINE_REV + "^{commit}"], {
    encoding: "utf8",
  }).status === 0;

const ARGS = new Set(process.argv.slice(2));
const UPDATE = ARGS.has("--update");
const STRICT = ARGS.has("--strict");

// R7 禁用的 Windows 入口后缀(ISSUE #23 / launch-and-build.md §8)
const FORBIDDEN_SCRIPT_EXT = /\.(bat|cmd|vbs)$/i;
// R8 需 UTF-8 BOM 的目录:入口与逻辑脚本都在这里,含中文的是绝大多数
const BOM_REQUIRED_DIRS = ["scripts/", "tools/"];
// R8 只校验含非 ASCII 字符的 .ps1——纯 ASCII 脚本没有解码歧义,不强求 BOM
const NON_ASCII = /[^\x00-\x7F]/;
// R10 注释里的「历史流水」标记(ISSUE #46 / 规范 12.4.2)
const HISTORY_DATE = /\d{4}-\d{2}-\d{2}/;
const HISTORY_TAG =
  /\bR(?:[-_][A-Za-z][A-Za-z0-9]*(?:[-_][A-Za-z0-9]+)*|\d{1,4}(?:[-_][A-Za-z]?[A-Za-z0-9]*)?)(?:\s*\/\s*(?:\d{1,4}|[A-Za-z][A-Za-z0-9]*))*/;
const HISTORY_TASK = /\bT\d{1,3}(?:-\d{1,3})?\b/;

/* ── R13/R14:src/lib 的域归属纪律(ISSUE #565 / 规范 §12.5.3) ──────────
 *
 * 背景:根目录曾长期平铺 60+ 个模块 —— 其中「log-paths.ts」与「log-ansi.ts」
 * 相隔 20 个文件名,查找全靠 grep;更糟的是同一件事的模块散在两处
 * (尺寸预设的纯逻辑 size-presets.ts / 存 size-preset-store.ts / 消费它的
 *  DimensionControl 各在一层),读代码的人先得自己拼出「这几份是一伙的」。
 *
 * 判据只做两件可机器判断的事,不做「归属是否合理」这种评审判断:
 *   R13 根目录只许放 DOMAIN_EXEMPT 列出的顶层单例;其余模块必须有子域目录。
 *   R14 子域目录名必须在 DOMAINS 里登记 —— 与 §18.6 的覆盖率门槛同一条
 *       治理原则:「新增域」必须同时登记它的门禁,否则新目录默认零约束。
 *
 * 为什么不禁止子域再嵌套(leaf-only):`comfyui/**` 与 `workshop/**` 自有子结构
 * (执行链 / 通道)、`core/**` 的平铺是「一个仓储一个文件」的刻意形态。机器判
 * 「嵌套深度」只会逼出 admin/ 这种既说不出归属、又绕开判据的目录。
 */
const DOMAINS = [
  "agent",
  "app-settings",
  "comfy",
  "comfyui",
  "core",
  "drizzle-studio",
  "film",
  "llm",
  "log",
  "media",
  "process",
  "project-canvas",
  "shell",
  "workflow",
  "workshop",
];

/* 根目录的合法居民:必须是「唯一持有者 + 任何域消费」的顶层单例。
 * 新加一项 = 声明「这个模块不属于任何域」,与新增域同样是设计决定 ——
 * 因此这里只允许出现真正的单例,不接收「暂时没想好放哪」的模块。 */
const DOMAIN_EXEMPT = new Set([
  // 共享工具与常量:整个 src 都在用,放进某个域会让那个域变成所有人的上游
  "src/lib/utils.ts",
  "src/lib/endpoints.ts",
  "src/lib/format-bytes.ts",
  "src/lib/display-value.ts",
  "src/lib/error-message.ts",
  "src/lib/browser-io.ts",
  "src/lib/time-format.ts",
  /* 搜索关键字的归一化与分组过滤（ISSUE #672）：视图层（工坊多选、工作流库
   * 筛选、日志面板、画布 chip）、`src/server` 的物化路由与 `src/app/api` 的
   * REST 路由**都在用**，且逻辑层与视图层必须同一口径（命中判据折了小写而
   * 高亮没折，会出现「行被选中但字没高亮」）。进任何子域都会让另一个域反向
   * 依赖它 —— 与 `format-bytes` / `display-value` / `time-format` 同款：
   * 「唯一持有者 + 任何域消费」的顶层单例。 */
  "src/lib/list-filter.ts",
  /* 异步动作的进度的**数值口径**（ISSUE #672）：视图层（工坊镜头卡、训练页、
   * 影片台、历史卡、自定义节点设置）与 `src/lib` 的服务端 / 客户端执行链
   *（`comfyui/executor-ws` 落库、`project-canvas/canvas-api` 透传、
   *  `workshop/generation-client` 转发、`core/repository-lora` 写库）**都在用**，
   * 且两侧必须同一口径（视图按 120 摆宽度而落库已夹到 100，会出现「界面卡在
   *  100% 但数据库还在涨」）。进任何子域都会让另一侧反向依赖它 —— 与
   * `format-bytes` / `display-value` / `list-filter` 同款：顶层单例。 */
  "src/lib/progress.ts",
  /* 「读一个元素的几何」的算术（ISSUE #672）：`use-custom-nodes-settings` 的
   * 面板内偏移、`LogPanel` 的视口量测、`WorkflowLibraryCanvas` 的底图尺寸、
   * `ScriptMarkdownEditor` 的按行号定位、`WorkflowStores` 的浮层锚点矩形**都在用**，
   * 且它们分属自定义节点设置、日志、工作流库、工坊、工作流编辑器五个域 ——
   * 进任何一个域都会让其余四个反向依赖它。与 `progress` / `list-filter` 同款：
   * 「唯一持有者 + 任何域消费」的顶层单例。 */
  "src/lib/dom-rect.ts",
  /* 「`unknown` 是不是纯对象」的判据（ISSUE #672）：**客户端**
   *（`media/materials-client` 收窄 fetch 响应）、**服务端域模块**
   *（`llm/usage-test.server`、`workshop/api-channel-shared`）、
   * **REST 路由**（`server/lib/request-body`）与**视图逻辑层**
   *（`workshop/api-channel-client`、`agent/client`）都在读它 ——
   * 收口前有 9 份逐字相同的实现。进任何子域都会让其余四侧反向依赖它。
   * 与 `dom-rect` / `list-filter` / `progress` 同款：顶层单例。 */
  "src/lib/is-record.ts",
  /* 「等一帧再做事」的调度（ISSUE #672）：视图层（工作流编辑器 / 自定义节点
   * 设置 / 选单 / 确认弹窗 / json-viewer）与 `lib` 侧（`project-canvas` 的
   * fitView 调度器、流程表单的持久化）**都在用**，且两侧对「一帧还是两帧」
   * 必须同一口径。进任何子域都会让另一侧反向依赖它 —— 顶层单例。 */
  "src/lib/next-frame.ts",
  /* 「把一段文本按最大长度截断」的唯一出口（ISSUE #672）：视图层
   *（错误面板 / 用量测试结果 / 日志面板）、`src/lib` 的 runtime / 诊断 /
   * ComfyUI 执行链、`src/app/api` 的 REST 路由**都在用**，且两侧必须同一
   * 口径（一处截 600 另一处截 8000、一处标 `…` 另一处不标，用户会在同一块
   * 面板上看到两种质量并存的文本）。进任何子域都会让其余侧反向依赖它 ——
   * 与 `format-bytes` / `display-value` / `progress` 同款：顶层单例。 */
  "src/lib/text-clamp.ts",
  /* 「把一段文本变成安全的文件名片段」的唯一出口（ISSUE #672）：
   * `src/app/api`（三条上传路由）、`src/lib/comfyui`（Lora 训练产物名）、
   * `src/server/workshop`（产出目录与文件名）**都在用**，且三侧对「保留哪些
   * 字符」本来就该有各自的名字 —— 进任何子域都会让其余侧反向依赖它。
   * 与 `text-clamp` / `is-record` 同款：顶层单例。 */
  "src/lib/safe-name.ts",
  /* 「把一个数字按某档精度写成字符串」的唯一出口（ISSUE #672）：
   * 视图层（节点值单元格、画布设置滑块读数、影片时长、训练 loss 曲线、
   * 用量测试耗时、上传体积提示）与 `src/lib` / `src/server`
   *（`format-bytes` 的降档、ffmpeg 的 `-t` 与 fade 时刻、合成计划的时长）
   * **都在用**，且两侧必须同一口径（视图按两位小数去尾零、落盘按两位小数
   * 留尾零，同一个时长在两处长得不一样）。进任何子域都会让其余侧反向依赖它
   * —— 与 `format-bytes` / `display-value` / `progress` 同款：顶层单例。 */
  "src/lib/number-format.ts",
  /* 「把一组值去重 / 合并成有序集合」的唯一出口（ISSUE #672）：
   * `src/lib/core`（模型文件名清单）、`src/lib/comfyui`（COMBO 候选并集、
   * 本地工作流按绝对路径去重）、`src/lib/media`（素材排序）**都在用**，
   * 且「去重键是什么」「排不排序」是跨域的同一类判据。进任何子域都会让
   * 其余侧反向依赖它 —— 顶层单例。 */
  "src/lib/ordered-set.ts",
  /* 「一个异步动作重试几次、退避多久」的唯一出口（ISSUE #672）：
   * `src/lib/comfyui`（WS 重连 / history 轮询）、`src/lib/drizzle-studio`、
   * `src/app/api`（Ollama 启停）、`src/app/(main)/settings` 的 hook **都在用**，
   * 且「指数退避 vs 固定间隔」的分野是跨域的同一类判据。进任何子域都会让
   * 其余侧反向依赖它 —— 与 `progress` / `list-filter` 同款：顶层单例。 */
  "src/lib/retry-policy.ts",
  /* 「把一个数夹进一个区间」的唯一出口（ISSUE #672）：视图层（滑块填充比例、
   * 数值步进器、图片缩放倍数、画布缩放、镜头时长）与 `src/lib` / `src/server`
   *（日志字节切片、日志会话时间戳、序号夹取、VRAM 读数、影片镜头数、落库前
   *  夹取）**都在用**，且两侧必须同一口径（一处夹到 `[0,100]` 另一处夹到
   * `[0,size]`，同一个值在两个面板落进不同区间）。进任何子域都会让其余侧反向
   * 依赖它 —— 与 `progress` / `number-format` / `ordered-set` 同款：顶层单例。 */
  "src/lib/clamp.ts",
  /* 「把一个可能带空白 / 缺省的外来串归一成大写记号」的唯一出口
   *（ISSUE #672）：视图层（ComfyUI 类型判定、端口配色、模式筛选胶囊）与
   * `src/lib` / `src/server`（模式契约、尺寸场景、状态筛选、端口类型映射）
   * **都在用**，且两侧必须同一口径（`trim` 与否决定匹配成败 —— 收口前同一个
   * 文件里两种写法并存）。进任何子域都会让其余侧反向依赖它 —— 顶层单例。 */
  "src/lib/upper-token.ts",
  /* 「跨组件广播一条应用事件」的唯一出口（ISSUE #672）：`src/app`（工作区首页）、
   * `src/components`（画布产物串联、历史面板、作品墙、输出面板、工作流库）、
   * `src/lib/project-canvas`（画布仓库变更广播）与 `src/config/custom-nodes`
   *（节点注册表刷新）**都在用**，且事件名与载荷类型必须**同处定义**
   *（收口前分开两处，已经养出两条死监听）。进任何子域都会让其余侧反向依赖它
   * —— 与 `browser-storage` / `next-frame` 同款：顶层单例。 */
  "src/lib/app-events.ts",
  "src/lib/server-cache.ts",
  // 数据层:在 §18.3 里是 element `server`(与 lib/core 同层),不是域
  "src/lib/db.ts",
  "src/lib/db-schema-ready.ts",
  // 领域模型:model-types 是前端本地模型,models 是后端 ComfyUI 定义,分属两侧
  "src/lib/model-types.ts",
  "src/lib/models.ts",
  // 会话判决:被 server/auth 与视图层共用
  "src/lib/auth-server.ts",
  // 应用级特性:skill 种子(与 agent 无关)、更新提醒(与桌面壳无关)
  "src/lib/skills-seed.ts",
  "src/lib/update-check-client.ts",
  // 跨域 UI 与烘焙数据
  "src/lib/full-screen-layer.ts",
  "src/lib/history-detail-actions.ts",
  "src/lib/envfile.ts",
  // 服务端装配与运维
  "src/lib/session-banner.server.ts",
  "src/lib/task-cancel-client.ts",
  /* 任务状态的终态判据：执行器（server）、SSE 关流（app/api）、仓储 SQL
   * 条件（server）与**视图层**（日志面板决定终态帧怎么呈现）共用的纯逻辑。
   * 它不能进任何子域：进 `core/**` 会被划成 element `server`，视图层
   * import 即被 `boundaries` 拦下；进 `project-canvas/**` 又会让服务端
   * 数据层反向依赖视图域。判据收敛在根层是唯一同时满足两侧的落点。 */
  "src/lib/task-state.ts",
  /* 「触发一次系统文件对话框之外的外部动作」的**结果口径与目标类型**
   *（ISSUE #672）：设置页四个分区（ComfyUI / Drizzle Studio 两个「在浏览器
   * 打开」+ 远程资源外链 + 应用自更新）、历史详情弹窗的「打开目录」，以及
   * `~/components/ui/use-external-action` 这个跨域执行态出口**都在用它**。
   * 两侧必须同一口径（一端读 `ok`、另一端读 `triggered`，会把成功读成失败）。
   * 进任何子域都会让另一个域反向依赖它 —— 与 `browser-io` / `display-value`
   * 同款：「唯一持有者 + 任何域消费」的顶层单例。 */
  "src/lib/external-open.ts",
  /* 「把用户选的文件读进来」的唯一出口（ISSUE #672）：设置页用量测试的图片
   * 转码、工坊封装页的本地图上传、工作流库 / 影片工作室 / 工坊剧本 / 视频队列
   * 六处导入**都在用**，且两侧必须同一口径（读到空算失败还是算空文件）。
   * 进任何子域都会让另一个域反向依赖它 —— 与 `browser-io` / `display-value`
   * 同款：「唯一持有者 + 任何域消费」的顶层单例。 */
  "src/lib/file-io.ts",
  /* 「键盘上那个键叫什么」的唯一出口（ISSUE #672）：`ui/simple-key-handler`
   *（元素上的键动作）、`ui/use-enter-commit`（输入框的 Enter 判据）与
   * `ui/use-hotkey`（全局监听）**三处都在读它**，而它们分属页签 / 表单 /
   * 日志面板 / 富文本编辑器四个域 —— 进任何一个域都会让其余域反向依赖它。
   * 与 `external-open` / `file-io` 同款：「唯一持有者 + 任何域消费」的顶层单例。 */
  "src/lib/keyboard.ts",
  /* 「标识符的两种书写法之间怎么换算」的唯一出口（ISSUE #672）：目前由
   * `lib/shell/overlay-z` 的 `zClass` 消费，而它派生的 5 个工具类名要与
   * `globals.css` 的 `@theme` 逐字一致 ——「哪个域拥有它」这个问题没有答案
   *（浮层刻度表消费它，但换算本身与浮层无关），故按顶层单例收在根层。
   * 与 `keyboard` / `external-open` 同款。 */
  "src/lib/case-token.ts",
  /* 「在浏览器里持久一件小事」的唯一出口（ISSUE #672）：画布偏好、面板加宽档、
   * 工作流运行态、尺寸预设、工坊草稿、更新检测开关、工作流表单样式
   * —— **九个文件**都在用它，横跨 `project-canvas` / `workflow` / `media` /
   * `workshop` / 视图层，且逻辑层与视图层必须同一口径。与 `file-io` 同款：顶层单例。 */
  "src/lib/browser-storage.ts",
  /* 「把一次异步动作的结果接到反馈通道上」的唯一出口（ISSUE #672）：
   * 设置页（12 个动作）、工作流库（8 个）、历史列表与详情、模型标签、
   * 训练工作室、影片工作室、画布拖放、工坊对话、模型目录配置
   * —— 横跨 `app/**` 与六个视图域，且「失败文案怎么归一」必须同一口径。
   * 进任何子域都会让另一个域反向依赖它 —— 与 `browser-io` / `file-io` 同款。 */
  "src/lib/async-action.ts",
  /* 「一组值怎么写进查询串」的唯一出口（ISSUE #672）：`log` / `media` /
   * `llm` / `workflow` / `workshop` / `project-canvas` 的六个网络客户端、
   * 设置页与工作流编辑器的取数、以及登录页读回调目标**都在用它**。
   * 编码与省略口径必须全库一致（手拼漏一处 `encodeURIComponent` 就是静默
   * 打到另一个端点）—— 顶层单例。 */
  "src/lib/query-string.ts",
  /* 「这一轮取数还算不算数」的唯一出口（ISSUE #672）：模型库、任务图集、
   * 历史面板、素材库、影片台、抽出模型选择、代码块、画布节点对账
   * —— **八个** 取数 effect 都在用它，横跨 `model` / `project-canvas` /
   * `studio` / `workshop` 与 `ui/` 基元，且「卸载后到达的失败要不要写界面」
   * 必须同一口径。进任何子域都会让另一个域反向依赖它 —— 与
   * `async-action` / `browser-storage` 同款：顶层单例。 */
  "src/lib/stale-run.ts",
  /* 「服务端错误信封」的唯一口径（ISSUE #672）：`src/app/api/**` 的十二处
   * 带业务字段的失败响应与 `src/lib/**` 的六个网络客户端**两端共用** ——
   * 一侧怎么编码、另一侧就怎么读，两边必须同一份形状（收口前三个客户端
   * 各写一份**逐字相同**的读取函数）。它同时被服务端路由与浏览器客户端
   * import，进任何子域都会让另一侧反向依赖它 —— 与 `error-message` 同款：
   * 顶层单例。 */
  "src/lib/api-error.ts",
  /* 「给一条新记录分配 id」的唯一出口（ISSUE #672）：日志 store（`log/`）、
   * 消息中心、工坊对话与草稿索引（`workshop/`）、剧本解析（`workshop/`）、
   * 画布节点与连线（`project-canvas/`）、三条上传路由（`app/api/`）、
   * 提示条（视图层）**都在用它** —— 横跨五个域与两端的路由，且「同一时刻的
   * 两条会不会撞 id」必须全库同一口径。进任何子域都会让另一个域反向依赖它
   * —— 与 `browser-io` / `format-bytes` 同款：顶层单例。 */
  "src/lib/unique-id.ts",
  /* 「把一段路径拼成可展示的相对路径 / 超长时省略中段」的唯一出口
   * （ISSUE #672 / 规范 16 §16.2.4.60）：`src/app/api` 的三条路由
   * （日志列表 / 导出 / 源码查看）与 `src/components/studio` 的四个视图
   * （自定义节点设置、工作流编辑器顶栏、渲染链路弹窗、画布包脚注）**都在用**，
   * 且两侧必须同一口径（一处相对项目根、一处相对 log/、一处原样绝对路径，
   * 同一个文件在不同面板显示成三种样子）。进任何子域都会让其余侧反向依赖它
   * —— 与 `safe-name` / `text-clamp` 同款：顶层单例。 */
  "src/lib/path-display.ts",
  /* 「透传 props 给底层元素前先剔掉自己的私有字段」的唯一出口
   * （ISSUE #672 / 规范 16 §16.2.4.61）：`ui/` 的十几个基元都在用它，
   * 而它们分属输入 / 滑块 / 图标 / 媒体 / 文件选择五类 —— 没有哪个域
   * 拥有「props 怎么透传」这件事。与 `display-value` 同款：顶层单例。 */
  "src/lib/dom-props.ts",
  /* 「给一个异步结果加超时」的唯一出口（ISSUE #672 / 规范 16 §16.2.4.62）：
   * `components/studio/workflow-editor`（tRPC 取数）、`lib/comfyui`（首帧等待 /
   * 执行看门狗）、`lib/process`（中介进程退出）、`server/film`（ffmpeg 调用）
   * **四处都在用**，横跨视图逻辑层、ComfyUI 执行链与服务端编排 ——
   * 进任何子域都会让其余侧反向依赖它。与 `retry-policy` 同款：顶层单例。 */
  "src/lib/with-timeout.ts",
]);

/** R13/R14 的扫描:只看 `src/lib` 的顶层条目,不递归。 */
(function checkLibDomainDiscipline() {
  const LIB = "src/lib";
  if (!fs.existsSync(LIB)) return;
  for (const e of fs.readdirSync(LIB, { withFileTypes: true })) {
    const rel = LIB + "/" + e.name;
    if (e.isDirectory()) {
      if (!DOMAINS.includes(e.name))
        problems.push(
          "R14 src/lib 子域目录未登记:" +
            rel +
            "。新增域须同时登记到 scripts/check-file-structure.cjs 的 DOMAINS," +
            "并在 vitest.config.ts 按实测值设覆盖率门槛(规范 §18.6 / §12.5.3)",
        );
      continue;
    }
    if (!/\.ts$/.test(e.name) || e.name.endsWith(".d.ts")) continue;
    /* 测试伙伴文件跟着它的被测模块走:模块在豁免清单里,它的用例也在。 */
    const moduleRel = rel.replace(/(\.windows)?\.test\.ts$/, ".ts");
    if (DOMAIN_EXEMPT.has(moduleRel)) continue;
    problems.push(
      "R13 src/lib 根目录模块必须有子域目录:" +
        rel +
        "。根目录只放顶层单例(DOMAIN_EXEMPT);分类到对应子域,或" +
        "「新增域 + 登记 DOMAINS + 设覆盖率门槛」——后者是设计决定,见规范 §12.5.3",
    );
  }
})();

/* R2 豁免:src/ 根下的 Next 约定文件。proxy.ts(Next 16 起取代 middleware.ts)
 * 是**框架保留名**——名字由 Next 决定,改成 kebab-case 就不再被加载,只能豁免;
 * 但豁免必须配 R11(位置 + 载荷判据),否则「豁免」会变成「改名/挪走后静默失效」
 * 的缺口(文件不在 src/ 根,警告与代理一起消失,构建期不报任何错)。 */
const R2_EXEMPT = new Set(["src/proxy.ts"]);

// Next.js App Router 保留文件名(框架强制小写,不可改名)——src/app 下豁免
const NEXT_RESERVED = new Set([
  "page",
  "layout",
  "error",
  "global-error",
  "loading",
  "not-found",
  "template",
  "default",
  "route",
  "manifest",
  "robots",
  "sitemap",
  "icon",
]);
// 库官方惯例文件(目录约定)
const CONVENTION_EXEMPT = new Set(["src/trpc/react.tsx"]);

(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name).split(path.sep).join("/");
    if (e.isDirectory()) {
      walk(p);
      continue;
    }
    if (!/\.(tsx?|mjs|cjs|js)$/.test(e.name)) continue;
    const rel = p;
    // shadcn/ui 官方约定:组件文件 kebab-case(button.tsx/dialog.tsx),
    // 与本项目 R1(PascalCase)相反——本脚本对 src/components/ui/ 硬强制 kebab
    // (禁止大写开头,§12.6),不再豁免。
    const isUiDir = rel.startsWith("src/components/ui/");
    const base = e.name
      .replace(/\.(tsx?|mjs|cjs|js)$/, "")
      .replace(/\.test$/, "");
    if (/\d{8}_\d{6}/.test(e.name)) problems.push("R3 时间戳备份文件:" + rel);
    /* R11 的位置判据:Next 约定文件只允许出现在 src/ 根。放进 app/ 或更深
     * 的目录 Next 不会加载 —— 文件在、代理不在,构建期毫无提示。 */
    if (base === "proxy" || base === "middleware") {
      const canonical = "src/" + base + ".ts";
      if (rel !== canonical)
        problems.push(
          "R11 Next 约定文件位置错:" + rel + "(须在 " + canonical + ")",
        );
    }
    if (
      /^\/\* eslint-disable @typescript-eslint\/no-explicit-any/.test(
        fs.readFileSync(p, "utf8").split("\n")[0] || "",
      )
    )
      problems.push(
        "R6 文件级 no-explicit-any 禁用头(战役已清零,禁止回流):" + rel,
      );
    if (/\.(tsx|mjs|cjs|js)$/.test(e.name) && rel.startsWith("src/")) {
      if (e.name.endsWith(".tsx")) {
        /* §12.6:目录索引 index.tsx 是 barrel,不承载组件实现,不受 R1 约束。
         *  src/components/ui/ 采用 shadcn 官方 kebab-case 约定(§12.6),
         *  故 ui/ 下组件文件须 kebab-case(禁止 PascalCase)。 */
        const isDirectoryIndex = base === "index";
        const reserved =
          (rel.startsWith("src/app/") && NEXT_RESERVED.has(base)) ||
          CONVENTION_EXEMPT.has(rel) ||
          isDirectoryIndex;
        if (isUiDir) {
          // shadcn 约定:kebab-case,禁止大写开头
          if (/^[A-Z]/.test(base))
            problems.push("R1(ui) 组件文件须 kebab-case:" + rel);
        } else if (!reserved && !/^[A-Z]/.test(base)) {
          problems.push("R1 组件文件须 PascalCase:" + rel);
        }
        if (rel.startsWith("src/lib/"))
          problems.push("R4 lib 下禁止 .tsx:" + rel);
      } else if (e.name.endsWith(".ts") && !e.name.endsWith(".d.ts")) {
        // ui/ 下 .ts 模块同样须 kebab-case(shadcn 约定)
        if (/^[A-Z]/.test(base) && !R2_EXEMPT.has(rel))
          problems.push("R2 模块文件须 kebab-case:" + rel);
      }
    }
  }
})("src");

// ── R5:超大文件的拆分候选(提示级,不阻断) ──
// 扫描范围是**整个 src/**,不分层也不分文件类型:
//   · src/app/       页面的「纯展示视图」(settings/SettingsPageView.tsx 2499 行);
//   · src/lib/       逻辑层的大文件(comfyui/lifecycle.ts 1041 行);
//   · src/components/、src/server/  组件与服务端。
// 只扫 components(历史口径)会让「最大的那个文件」永远不被提醒;把范围缩到
// .tsx 会让逻辑层的大文件同样漏网。行数超了就该拆,与它是不是组件、落在哪一层
// 都无关。App Router 的保留文件(page/layout/route)一并计入。
// 与函数长度门禁(check-function-length.cjs §12.13)的分工:那个管**函数**,
// 这个管**文件**;两者都只提示,把存量交给排期,把增量交给棘轮。
(function collectSplitHints() {
  (function walkHints(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name).split(path.sep).join("/");
      if (e.isDirectory()) {
        walkHints(p);
        continue;
      }
      if (!/\.(ts|tsx|mjs|cjs|js)$/.test(e.name)) continue;
      if (/\.test\.[cm]?[jt]sx?$/.test(e.name) || /\.d\.ts$/.test(e.name))
        continue;
      const lines = fs.readFileSync(p, "utf8").split("\n").length;
      if (lines > SPLIT_HINT_LINES) {
        splitHints.push(p + " (" + lines + " 行,建议拆分)");
        oversizedFiles[p] = lines;
      }
    }
  })("src");
})();

// ── R7/R8:仓库内 Windows 脚本入口扫描 ──
// 只排除「不可能放仓库入口」的目录:依赖、构建产物、被 gitignore 的打包输出、
// 以及 target(可能包含第三方 Rust 产物)。用相对路径前缀判断,避免按目录名
// 误伤 tools/registry 这类同名但受规范的目录。
const SCAN_EXCLUDED = [
  "node_modules/",
  ".git/",
  ".next/",
  "coverage/",
  "generated/",
  "temp/",
  "python-venv/",
  "log/",
  "build-launcher/",
  "dist/",
  "docs/",
  "playwright-report/",
  ".workbuddy/",
  "src-tauri/target/",
  "src-tauri/static/",
  "start-tauri/",
  "start-tauri-dev/",
  "start-tauri-standalone/",
  "build-launcher-dev/",
  "build-launcher-standalone/",
];
(function walkScripts(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name).split(path.sep).join("/");
    const rel = p.startsWith("./") ? p.slice(2) : p;
    if (e.isDirectory()) {
      if (
        SCAN_EXCLUDED.some((d) => rel === d.slice(0, -1) || rel.startsWith(d))
      )
        continue;
      walkScripts(p);
      continue;
    }
    if (FORBIDDEN_SCRIPT_EXT.test(e.name)) {
      problems.push("R7 Windows 入口须 .ps1(禁用 .bat/.cmd/.vbs):" + rel);
      continue;
    }
    if (!e.name.toLowerCase().endsWith(".ps1")) continue;
    if (!BOM_REQUIRED_DIRS.some((d) => rel.startsWith(d))) continue;
    const buf = fs.readFileSync(p);
    if (
      buf.length >= 3 &&
      buf[0] === 0xef &&
      buf[1] === 0xbb &&
      buf[2] === 0xbf
    )
      continue;
    // 无 BOM:只有含非 ASCII 字符(中文提示)的脚本才会被 PS5.1 按 GBK 误解码
    if (NON_ASCII.test(buf.toString("utf8"))) {
      problems.push(
        "R8 含中文的 .ps1 须以 UTF-8 BOM 保存(否则 PS5.1 按 GBK 解码):" + rel,
      );
    }
  }
})(".");

// ── R9:根目录禁止散落 .ps1 双击入口(ISSUE #29) ──
// 背景:6 个根入口(start-web/run-local/verify-quality/start-tauri/
// start-desktop/register-comfyapp-protocol)曾平铺在仓库根,与 package.json /
// tsconfig.json 等工程配置混排,一眼看不出"哪些是入口、哪些是配置"。现统一归入
// tools/start/,与 tools/build/、tools/registry/、tools/studio/ 同构。
// 这里只拦 .ps1——其它后缀的根文件(配置/文档)不受约束,避免过度收紧。
(function checkRootEntries() {
  for (const e of fs.readdirSync(".", { withFileTypes: true })) {
    if (!e.isFile()) continue;
    if (!e.name.toLowerCase().endsWith(".ps1")) continue;
    problems.push(
      "R9 根目录禁止 .ps1 双击入口(请放进 tools/<分类>/,启动类放 tools/start/):" +
        e.name,
    );
  }
})();

// ── R10:注释里禁止「历史流水」(日期 / 改动编号 / 任务批次号) ──
// 规范 12.4.2:作者、日期、版本流水归 git log / commit message,写进注释会随
// 代码搬迁过期失真。本条只扫「整行都是注释」的行,不碰字符串字面量与代码。
(function checkHistoryComments() {
  const files = [];
  (function walkComments(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name).split(path.sep).join("/");
      if (e.isDirectory()) {
        walkComments(p);
        continue;
      }
      // `.css` 一并纳入:样式注释里的改动编号 / 日期同样是「历史流水」,
      // 且样式块常被整段搬运,过期的落点说明比代码里的更容易失真。
      if (/\.(ts|tsx|css)$/.test(e.name)) files.push(p);
    }
  })("src");
  for (const rel of files) {
    const lines = fs.readFileSync(rel, "utf8").split("\n");
    lines.forEach((l, i) => {
      const t = l.trim();
      const isComment =
        t.startsWith("//") ||
        t.startsWith("/*") ||
        t.startsWith("*") ||
        t.startsWith("{/*");
      if (!isComment) return;
      // 一行里可能同时有日期与编号,逐个报出来,便于一次改干净
      const found = new Set();
      for (const re of [HISTORY_DATE, HISTORY_TAG, HISTORY_TASK]) {
        for (const m of l.matchAll(new RegExp(re.source, "g"))) {
          if (m[0] !== "") found.add(m[0]);
        }
      }
      for (const hit of found) {
        problems.push(
          "R10 注释禁止历史流水(日期 / 编号 / 批次号归 git):" +
            rel +
            ":" +
            (i + 1) +
            " → " +
            hit,
        );
      }
    });
  }
})();

// ── R11:Next 16 起 middleware 必须叫 proxy,且不得静默丢失(ISSUE #489) ──
// 两条判据合起来才拦得住:
//   ① 存在性——约定文件被删 = 代理凭空消失,构建期不报错,要等到真拦请求时
//      才发现「根本没跑」;本仓库唯一用途是挂 config.matcher 给后来人留落点,
//      删掉它等于把落点一起删了;
//   ② 片段存在性——文件在、但改名回 middleware = 重新吃 Next 16 的 deprecation
//      警告(改名是「消警告」而不是「消掉需求」的典型误修)。
(function checkProxyConvention() {
  const proxyPath = "src/proxy.ts";
  const legacyPath = "src/middleware.ts";
  if (!fs.existsSync(proxyPath)) {
    problems.push(
      "R11 缺少 Next 16 代理约定文件:" +
        proxyPath +
        "(middleware 已废弃,勿删除本文件)",
    );
  }
  if (fs.existsSync(legacyPath)) {
    problems.push(
      "R11 middleware 约定名已废弃(Next 16):" +
        legacyPath +
        " → 改名为 src/proxy.ts",
    );
  }
})();

// ── R12:src/ 源码禁止内嵌控制字符(规范 12.11) ──
// 判据是「这个字节在源码里是不是一个字符」,而不是「文件里有没有某个字符串」:
// 带 NUL 的文件被 git / diff / grep / 多数编辑器一律当二进制处理,评审与检索
// 从此对它失效——这正是历史上 markdown.ts 用 NUL 做占位符哨兵留下的坑。
// 详情与替代写法见 docs/standards/12-代码组织与文件结构.md §12.11。
(function checkControlCharacters() {
  /** 允许的控制字符:制表符、换行、回车(源码里的正常排版)。 */
  const ALLOWED = new Set([0x09, 0x0a, 0x0d]);
  /** C0(0x00-0x1f,除上列)、DEL(0x7f)、C1(0x80-0x9f / U+0080-U+009F)。 */
  function isForbidden(code) {
    if (code <= 0x1f) return !ALLOWED.has(code);
    if (code === 0x7f) return true;
    return code >= 0x80 && code <= 0x9f;
  }
  function describe(code) {
    const hex = "U+00" + code.toString(16).toUpperCase().padStart(2, "0");
    return code === 0 ? hex + " (NUL)" : hex;
  }
  const files = [];
  (function walkControl(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name).split(path.sep).join("/");
      if (e.isDirectory()) {
        walkControl(p);
        continue;
      }
      if (/\.(ts|tsx)$/.test(e.name)) files.push(p);
    }
  })("src");
  for (const rel of files) {
    const text = fs.readFileSync(rel, "utf8");
    const lines = text.split("\n");
    lines.forEach((line, i) => {
      const hits = new Set();
      for (const char of line) {
        const code = char.codePointAt(0);
        if (isForbidden(code)) hits.add(describe(code));
      }
      for (const hit of hits) {
        problems.push(
          "R12 源码禁止内嵌控制字符(" +
            rel +
            ":" +
            (i + 1) +
            " → " +
            hit +
            ")。改可打印哨兵,见规范 §12.11;若确需 NUL 请显式写成转义 `\\u0000`",
        );
      }
    });
  }
})();

// ── R5 棘轮(ISSUE #575 第 8 项) ──
// 默认只提醒;`--strict`(CI)下按 `scripts/.file-size-baseline.json` 判定:
//   ① 基线里没有的超限文件 = 新增 → 阻断;
//   ② 基线里已有但配额(基线行数 × 行数口径换算比)被突破 → 阻断(文件还在长);
//   ③ 基线里已有但已降到阈值内/行数变小 → 提示收紧基线(不阻断,避免打断提交)。
// 反模式:只在输出里打一行「建议拆分」。提醒与阻断的区别就是「有没有人为它返工」——
// 900 行以上的文件在本仓库只增不减(11 个存量),正是「只提醒」的直接结果。
(function checkFileSizeRatchet() {
  const names = Object.keys(oversizedFiles).sort();
  const prev = fs.existsSync(FILE_SIZE_BASELINE)
    ? JSON.parse(fs.readFileSync(FILE_SIZE_BASELINE, "utf8"))
    : null;
  const prevFiles = prev?.files ?? null;
  /** 基线里这个文件的**同口径行数**:按 baselineRev 的内容、今天的计数口径重数。
   *  取不到(旧基线 / 文件当时不存在 / git 不可用)时退回基线上的记录值 ——
   *  退回是「按历史行为比」,只会更严,不会漏放。 */
  const baseLinesOf = (f, recorded) =>
    linesAtRev(BASELINE_REV_USABLE ? prev?.baselineRev : null, f) ?? recorded;
  /** 基线修订号存在却不可达 ⇒ 同口径重数做不了,只能退回记录值(见文件头)。 */
  const baseRevMissing = Boolean(prev?.baselineRev) && !BASELINE_REV_USABLE;

  if (UPDATE) {
    const prevTotal = prevFiles ? Object.keys(prevFiles).length : 0;
    /* 棘轮只许下降;唯一例外是判据版本抬升(旧数字与新计数不是同一个量)。 */
    const ruleChanged =
      Boolean(prevFiles) && prev.ruleVersion !== R5_RULE_VERSION;
    const grew = prevFiles
      ? names.filter((f) => f in prevFiles && oversizedFiles[f] > prevFiles[f])
      : [];
    const added = prevFiles ? names.filter((f) => !(f in prevFiles)) : [];
    if (
      prevFiles &&
      (grew.length || added.length || names.length > prevTotal) &&
      !ruleChanged
    ) {
      console.error(
        "[structure] 拒绝放宽 R5 基线(棘轮只许下降):" +
          (grew.length ? " 变大 " + grew.join(", ") : "") +
          (added.length ? " 新增 " + added.join(", ") : "") +
          "\n  新增的先拆分,不要用 --update 掩盖。" +
          "\n  若确属判据变更(现为 R5_RULE_VERSION=" +
          R5_RULE_VERSION +
          "),须先改脚本里的常数再 --update。",
      );
      process.exit(1);
    }
    fs.writeFileSync(
      FILE_SIZE_BASELINE,
      JSON.stringify(
        {
          generatedAt: new Date().toISOString().slice(0, 10),
          ruleVersion: R5_RULE_VERSION,
          note:
            "超 " +
            SPLIT_HINT_LINES +
            " 行的文件(规范 §12.6 R5 / ISSUE #575)。" +
            "棘轮只许下降:新增超限文件须先拆分,再收紧基线。" +
            "比对前按 `baselineRev` 的内容**同口径重数**基线行数(见脚本注释)。",
          threshold: SPLIT_HINT_LINES,
          baselineRev: headRev(),
          total: names.length,
          files: Object.fromEntries(names.map((f) => [f, oversizedFiles[f]])),
        },
        null,
        2,
      ) + "\n",
    );
    console.log(
      "[structure] R5 基线已更新:" +
        names.length +
        " 个超限文件(scripts/.file-size-baseline.json)" +
        (ruleChanged
          ? "【判据版本 " +
            (prev.ruleVersion ?? "?") +
            " → " +
            R5_RULE_VERSION +
            ",一次性重记】"
          : ""),
    );
    if (!BASELINE_REV_USABLE) {
      console.warn(
        "[structure] 警告:新记的基线修订号在本检出里取不到 —— 同口径重数会退化成\n" +
          "  拿记录值直接比。浅克隆 / 只取单分支的 CI 请先 git fetch --unshallow。",
      );
    }
    return;
  }

  if (!STRICT) return; // 非 strict:只提醒,不判失败(pre-commit 与本地快跑口径)

  if (!prevFiles) {
    problems.push(
      "R5 基线文件缺失:先执行 node scripts/check-file-structure.cjs --update",
    );
    return;
  }
  for (const f of names) {
    const base = prevFiles[f];
    if (base === undefined) {
      problems.push(
        "R5 新增超限文件(" +
          f +
          " → " +
          oversizedFiles[f] +
          " 行,阈值 " +
          SPLIT_HINT_LINES +
          ")。先拆分,再收紧基线(规范 §12.6 R5)",
      );
    } else if (oversizedFiles[f] > baseLinesOf(f, base)) {
      const baseline = baseLinesOf(f, base);
      /* 取不到基线修订号 ⇒ 比的是「两个格式时代的绝对行数」,差值不构成判据。
       * 把这支单独报出来:它的可行动作是**重记基线**,不是拆文件。 */
      if (baseRevMissing) {
        problems.push(
          "R5 基线修订号 " +
            prev.baselineRev +
            " 在本检出里取不到(" +
            f +
            " → 记录值 " +
            base +
            " → 当前 " +
            oversizedFiles[f] +
            " 行)。同口径重数无法进行,比的是两个格式时代的绝对行数 —— " +
            "先补历史(git fetch --unshallow),再执行 node scripts/check-file-structure.cjs --update 重记基线(规范 §12.13.3)",
        );
        continue;
      }
      problems.push(
        "R5 超限文件继续变大(" +
          f +
          " → " +
          base +
          " → " +
          oversizedFiles[f] +
          " 行" +
          (baseline === base ? "" : ";按同口径重数基线为 " + baseline + " 行") +
          ")。拆分或收紧基线(规范 §12.6 R5)",
      );
    }
  }
  const shrunk = names.filter(
    (f) =>
      prevFiles[f] !== undefined &&
      oversizedFiles[f] < baseLinesOf(f, prevFiles[f]),
  );
  const removed = Object.keys(prevFiles).filter((f) => !(f in oversizedFiles));
  if (shrunk.length || removed.length) {
    console.log(
      "[structure] R5 基线可收紧(执行 --update):" +
        [...shrunk, ...removed].map((f) => "\n  · " + f).join(""),
    );
  }
})();

if (splitHints.length) {
  console.log(
    "[structure] 拆分候选" +
      (STRICT ? "" : "(仅提醒)") +
      ":\n  " +
      splitHints.join("\n  "),
  );
}
if (problems.length) {
  console.error("[structure] 违规(阻断提交):\n  " + problems.join("\n  "));
  console.error(
    "规范见 docs/standards/12-代码组织与文件结构.md §12.6/§12.8/§12.11",
  );
  console.error(
    "      以及 docs/standards/launch-and-build.md §8(Windows 入口 .ps1 化)",
  );
  process.exit(1);
}
console.log("[structure] OK");
