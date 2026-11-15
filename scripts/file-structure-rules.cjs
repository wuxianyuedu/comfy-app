#!/usr/bin/env node
// @ts-nocheck -- 结构判据的**声明层**常量表(供 check-file-structure.cjs 与用例 import)
/**
 * `check-file-structure.cjs` 的声明层 —— 判据引用的全部常量与清单表。
 *
 * 为什么拆出来(ISSUE #1811):那条脚本此前 1213 行,其中**过半是纯数据**
 * (DOMAINS / DOMAIN_EXEMPT / SCAN_EXCLUDED / 各豁免与保留名表)。数据与机制
 * 混在一份文件里,两边的读者都要在对方的体量里找自己要的那几行 —— 而这正是
 * R5「超 900 行须拆」要拦的形态。拆开后:声明层是「改了要有人签字」的那部分
 * (新增子域 / 新增豁免都在这),机制层是「读一遍就够」的那部分。
 *
 * 这里**只放常量**,不放任何函数:判据逻辑、扫描与退出码全留在主文件,
 * 保证 import 本模块不产生副作用(用例可以直接 import 这些表做断言)。
 */

/** R7 禁用的 Windows 入口后缀(ISSUE #23 / launch-and-build.md §8)。 */
const FORBIDDEN_SCRIPT_EXT = /\.(?:bat|cmd|vbs)$/i;
/** R8 需 UTF-8 BOM 的目录:入口与逻辑脚本都在这里,含中文的是绝大多数。 */
const BOM_REQUIRED_DIRS = ["scripts/", "tools/"];
/** R8 只校验含非 ASCII 字符的 .ps1 —— 纯 ASCII 脚本没有解码歧义,不强求 BOM。 */
const NON_ASCII = /[^\u0000-\u007F]/;

// R10 注释里的「历史流水」标记(ISSUE #46 / 规范 12.4.2)
const HISTORY_DATE = /\d{4}-\d{2}-\d{2}/;
const HISTORY_TAG =
  /\bR(?:[-_][A-Za-z][A-Za-z0-9]*(?:[-_][A-Za-z0-9]+)*|\d{1,4}(?:[-_][A-Za-z]?[A-Za-z0-9]*)?)(?:\s*\/\s*(?:\d{1,4}|[A-Za-z][A-Za-z0-9]*))*/;
// 任务批次号两档:`T12-3` 这种带连接号的形式,或裸 `T11`(样式块里整段搬运的
// 那批曾只写 `— T11`)。**但排除对反模式表 / 规范章节的交叉引用**(`反模式 T5`、
// `§14 的 T12`)—— 那是「当前代码违反哪一条」的有效指路,不是变更流水。放宽扫到
// 块注释续行之后这两者会撞形(globals.css 的 CodeBlock 说明里就有一处),因此对
// **裸** `Tn` 加一条行内上下文豁免:同一行出现 `反模式` 或 `§` 即跳过。带连接号的
// `T12-3` 不受影响(它没有第二种含义)。
const HISTORY_TASK_DASHED = /\bT\d{1,3}-\d{1,3}\b/;
const HISTORY_TASK_BARE = /\bT\d{1,3}\b/;
const HISTORY_TASK_REF_CONTEXT = /反模式|§/;

// 块注释的闭合标记用**正则字面量**表达,而不写字符串:源码里因此不出现连续的
// 块注释闭合标记 —— 否则 `tests/gate-hint-targets-exist.test.ts` 的简易
// `stripComments` 会把它当成真的闭合(它是非贪婪匹配),让后面的字符串字面量
// 整段错位、判据面莫名其妙多出一条本来就故意不存在的路径。
const BLOCK_COMMENT_CLOSE = /\*\//;

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
  /* 应用内控制台（ISSUE #1327）：命令目录/解析、执行面、回环闸门、运行槽单例。
   * 它是「本机命令执行」这一件事的域 —— 与 `comfyui`（ComfyUI 编排）、
   * `process`（进程树回收地基）都不同族：那两个是执行引擎的地基，本域是
   * **面向用户的入口**（谁点了什么、输出给谁看、什么时候回收）。 */
  "console",
  "core",
  /* 「数据存在哪儿」的登记（ISSUE #3625）：每种数据 × 它的存放位置 → 类别 /
     图标 / 落点 / 迁移办法。它**不属于 `core`** —— `core` 是仓储层（SQL 出口），
     本域是**跨域的元数据**（讲的是「谁存在哪」，不碰任何一张表）；也不属于
     `app-settings`（那是设置本身的值，不是它的落点说明）。纯数据模块，
     浏览器侧与服务端侧读同一份口径，界面上的徽标与「数据存放位置」清单都从这儿取。 */
  "data-location",
  /* 数据库备份 / 恢复（D6，ISSUE #1611）：命名与轮转、`VACUUM INTO` 备份、
   * `integrity_check` 验证、待恢复标记与换文件。它**不属于 `core`** ——
   * `core` 是仓储层（SQL 出口），本域是「库文件本身的生死」；也不属于
   * `drizzle-studio`（那是可视化工具的生命周期）。
   * 真正的实现在 `scripts/db-backup-core.mjs`（启动链的纯 Node 宿主必须能引它），
   * 本目录只放服务端取用面与设置页的接线。 */
  "db-backup",
  "drizzle-studio",
  /* 应用内运行反馈（ISSUE #3371）：问题描述 / 截图 / 诊断日志打包与预填
   * Issue 正文。它是「把一次现场收成可提交材料」这一件事的域，与 `log`
   * （日志读写）、`media`（媒体编解码）都不同族：那两个是地基，本域是
   * **面向用户的反馈入口**。契约 / 网络层在 `src/lib/feedback/`，落盘在
   * `src/app/api/feedback/export/`，界面在 `src/components/feedback/`。 */
  "feedback",
  "film",
  "llm",
  "log",
  "media",
  /* markdown 渲染域（ISSUE #1329）：`marked` + `DOMPurify` 的接线、消毒白名单与
   * 样式表。它**不属于 `comfyui`** —— 渲染的是「一段用户文本变成 DOM 片段」这件事，
   * 与 ComfyUI 编排无关；历史上因为第一个消费方是 ComfyUI 便签而落在
   * `comfyui/markdown.ts`，于是第二个、第三个消费方（剧本预览、工坊剧本区）
   * 每次取用它都要反向依赖 ComfyUI 域。 */
  "markdown",
  "process",
  "production",
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
  /* 壳层列宽与「左轨何时该自动收起」这笔账的唯一持有者:消费方横跨 `ui/`
   * (导航两条宽度、窄窗判据)、工坊视图(列宽对账)与 `tests/`(漂移判据)。
   * 放进任何一侧的子域都会让另一侧反向依赖那个域 —— 与 `endpoints.ts` /
   * `progress.ts` 同款:「唯一持有者 + 任何域消费」的顶层单例。 */
  "src/lib/layout-budget.ts",
  /* 两条轮询/去抖判据的本体:状态栏、首页、队列通道等多处都要用,而 lib 不能反向
   * import components/**(硬规则 22),所以本体在这层、hook 只做外壳。与
   * endpoints / progress 同款:「唯一持有者 + 任何域消费」的顶层单例。 */
  "src/lib/poll-timer.ts",
  "src/lib/offline-gate.ts",
  /* 搜索关键字的归一化与分组过滤（ISSUE #672）：视图层（工坊多选、工作流库
   * 筛选、日志面板、画布 chip）、`src/server` 的物化路由与 `src/app/api` 的
   * REST 路由**都在用**，且逻辑层与视图层必须同一口径（命中判据折了小写而
   * 高亮没折，会出现「行被选中但字没高亮」）。进任何子域都会让另一个域反向
   * 依赖它 —— 与 `format-bytes` / `display-value` / `time-format` 同款：
   * 「唯一持有者 + 任何域消费」的顶层单例。 */
  "src/lib/list-filter.ts",
  /* 异步动作的进度的**数值口径**（ISSUE #672）：视图层（工坊镜头卡、
   * 影片台、历史卡、自定义节点设置）与 `src/lib` 的服务端 / 客户端执行链
   *（`comfyui/executor-ws` 落库、`project-canvas/canvas-api` 透传、
   *  `workshop/generation-client` 转发）**都在用**，
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
   * `src/app/api`（上传路由）、`src/lib/path-display`、
   * `src/server/workshop`（产出目录与文件名）**都在用**，且两侧对「保留哪些
   * 字符」本来就该有各自的名字 —— 进任何子域都会让其余侧反向依赖它。
   * 与 `text-clamp` / `is-record` 同款：顶层单例。 */
  "src/lib/safe-name.ts",
  /* 「把一个数字按某档精度写成字符串」的唯一出口（ISSUE #672）：
   * 视图层（节点值单元格、画布设置滑块读数、影片时长、
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
  /* 「打开一份 SQLite 连接要跑哪几条 PRAGMA」的唯一清单（ISSUE #1250）：Next 主库
   *（`src/server/db.ts`）、工坊库（`src/server/workshop/db.ts`）与执行宿主自己的库
   *（`src/lib/comfyui/host-runtime.ts`）三侧连接都用它；启动器那侧是非 TS 宿主、
   * 引不到本模块，由 `tests/sqlite-pragma-sites.test.ts` 核两边同源。为什么必须在
   * 一处：`busy_timeout` 是**每条连接**的等待预算，漏在哪一侧就那一侧照旧撞锁报错
   * —— 与 `endpoints` / `retry-policy` 同款：顶层单例。 */
  "src/lib/sqlite-pragmas.ts",
  /* 「把一条 node:sqlite 连接包成 drizzle 的 async 回调」的唯一适配器（ISSUE #3171）：
   * 三处连接站点（`src/server/db.ts`、`src/server/workshop/db.ts`、
   * `src/lib/comfyui/host-runtime.ts`）都用它，且它是 `src/server` 与 `src/lib/comfyui`
   * 两侧共用的**驱动面**（不是某个业务域的形状）—— 放进任何一侧的子域都会让其余侧
   * 反向依赖那个域。与 `sqlite-pragmas` / `sqlite-error` 同款：顶层单例。 */
  "src/lib/sqlite-driver.ts",
  /* 「SQLite 写失败的原因怎么取出来、哪一族值得等一等再试」（ISSUE #1250）：
   * 收口写重试（`src/lib/comfyui/executor-write-retry.ts`）是现在的消费方，但判据是
   * **驱动的错误码族**、不是执行域的形状 —— 放进 `comfyui/` 会让「锁」这个 SQLite
   * 概念变成某个域的私有语义，下一个直连库的写路径就无法复用同款判断。同款顶层单例。 */
  "src/lib/sqlite-error.ts",
  /* 「撞锁了就按预算再试一次」那一段循环体的唯一实现（ISSUE #2586）：
   * 开机 PRAGMA（`sqlite-pragmas.ts`）、终态库写（`comfyui/executor-write-retry.ts`）、
   * 远端模型整份同步的事务（`core/repository-user.ts`）三处都要它，而三处各自的
   * 域逻辑不同（逐条 PRAGMA / 穷尽后摘掉本进程足迹 / 用户点的一次保存）——
   * 放进任何一侧都会让另两侧反向依赖那个域。与 `sqlite-error` / `retry-policy`
   * 同款：判据是** SQLite 的锁族错误 + 具名退避预算**这一对，不是某个域的形状。 */
  "src/lib/sqlite-busy-retry.ts",
  /* 「把一个数夹进一个区间」的唯一出口（ISSUE #672）：视图层（滑块填充比例、
   * 数值步进器、图片缩放倍数、画布缩放、镜头时长）与 `src/lib` / `src/server`
   *（日志字节切片、日志会话时间戳、序号夹取、VRAM 读数、影片镜头数、落库前
   *  夹取）**都在用**，且两侧必须同一口径（一处夹到 `[0,100]` 另一处夹到
   * `[0,size]`，同一个值在两个面板落进不同区间）。进任何子域都会让其余侧反向
   * 依赖它 —— 与 `progress` / `number-format` / `ordered-set` 同款：顶层单例。 */
  "src/lib/clamp.ts",
  /* 「取一个分组桶、没有就建」/「按构造必存在的键取值」的唯一出口：`media/materials`
   *（按文件夹）、`studio/history`（按日期）、`ui/segment-popover`（按子组）与
   * 任何需要分桶聚合的地方**都在用**，此前各自写 `map.get(k)!.push` 靠非空断言兜
   * 「刚初始化过」这条隐性契约。进任何子域都会让其余侧反向依赖它 —— 顶层单例。 */
  "src/lib/collections.ts",
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
  /* 「把一组 props 转成另一个键的 props」的唯一出口（ISSUE #672）：视图层
   *（设置页四个分区、工坊六处、工作流库、影片台、画布设置、三个
   *  `ui/` 基元）与 `src/app/login` **都在用**，且「控件收值、抛值」这件事
   * 必须全库同一口径（一处取 `target.value`、一处取 `target.checked`，
   * 传错不会报错，只会在运行时静默拿到 `undefined`）。进任何子域都会让其余
   * 域反向依赖它 —— 与 `display-value` / `file-io` 同款：顶层单例。 */
  "src/lib/form-props.ts",
  /* 「给一个列表做分页 / 窗口切片」的唯一出口（ISSUE #672）：`log/`（倒序
   * 分页与锚定窗口）、`ui/code-block`（平行分块）、两个日志弹窗与
   * `workflow` / `workshop` 的三处尾部窗口、`app/api/logs/sessions` 的会话
   * 清单**都在用**，且三族窗口的方向相反、边界处理各异（页码越界 /
   * `pageSize` 为 0 / 空列表），必须同一口径。进任何子域都会让其余侧反向
   * 依赖它 —— 与 `clamp` / `ordered-set` 同款：顶层单例。 */
  "src/lib/page-window.ts",
  /* 「这个地址能不能交给外部程序（协议只许 http/https）」的唯一判据（台账 A5 复算）：
   * `lib/comfy`（`isHttpOrigin` 转发到它）、`lib/shell`（`openUrlInBrowser` 在发起 IO
   * 之前拦）、`src/server/api/routers` 的 `setting`（comfyEmbeddable 的两个地址，
   * 以及已随炼丹废弃删除的 trainerUrl）与 `llm`（baseUrl）**都在吃**，
   * 而「服务端会去 fetch 的地址」和「交给 OS 打开的地址」
   * 必须同一口径 —— 分开放就会再次出现「补了 fetch 那两条、漏了 openExternal 那条」。
   * 放进 `comfy` / `shell` 任一侧都会让另一侧反向依赖那个域；收口前它是四份实现
   *（一份按 `new URL()` 解析、三份前缀正则，正则那三份实测两个方向都错）。
   * 与 `endpoints` / `sqlite-pragmas` 同款：安全判据的顶层单例。 */
  "src/lib/url-scheme.ts",
  "src/lib/server-cache.ts",
  // 数据层:在 §18.3 里是 element `server`(与 lib/core 同层),不是域
  "src/lib/db.ts",
  "src/lib/db-schema-ready.ts",
  // 领域模型:model-types 是前端本地模型,models 是后端 ComfyUI 定义,分属两侧
  "src/lib/model-types.ts",
  "src/lib/models.ts",
  // 会话判决:被 server/auth 与视图层共用
  "src/lib/auth-server.ts",
  /* 产品版本号的**运行时读取面**（ISSUE #1611 阶段三 D7）：权威源是
   * `package.json` 的 `version`，而另外两处（`src-tauri/tauri.conf.json` /
   * `src-tauri/Cargo.toml`）由 `scripts/check-app-version.cjs` 守着与它逐字相等。
   * 消费方是**服务端**（`src/server/mcp/workshop-mcp.ts` 的 MCP `serverInfo.version`）
   * 与将来任何要显示产品版本的视图 —— 两侧都得能读它，且**浏览器图里不许出现
   * `process.env.npm_package_version`**（那个变量只在 `pnpm run` 起的进程里有值，
   * standalone 与桌面壳起的 Node 都没有：本地能读、出厂读不到）。所以它必须是
   * 一份**两边都能静态 import 的常量**（JSON 静态导入被两个构建器都内联），
   * 进任何子域都会让另一侧反向依赖那个域 —— 与 `endpoints` / `task-state` 同款：
   * 「唯一持有者 + 任何域消费」的顶层单例。 */
  "src/lib/app-version.ts",
  // 应用级特性:skill 种子(与 agent 无关)、更新提醒(与桌面壳无关)
  "src/lib/skills-seed.ts",
  "src/lib/update-check-client.ts",
  // 跨域 UI 与烘焙数据
  "src/lib/full-screen-layer.ts",
  "src/lib/history-detail-actions.ts",
  "src/lib/envfile.ts",
  // 服务端装配与运维
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
  /* 外观偏好（圆角 / 标题字阶）：改的是全局 CSS 变量，必须跨路由成立，
     与 browser-storage 同款顶层单例。 */
  "src/lib/appearance.ts",
  /* 「把一次异步动作的结果接到反馈通道上」的唯一出口（ISSUE #672）：
   * 设置页（12 个动作）、工作流库（8 个）、历史列表与详情、模型标签、
   * 影片工作室、画布拖放、工坊对话、模型目录配置
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
  /* 「有界并发的任务池」唯一出口（规范 §12.18）：`components/workshop` 的三个
   * 批量生成循环（镜头生图 / 视频生成 / 分镜批量）共用 —— 本地 ComfyUI 按队列
   * 串行执行，串行提交会在「落定 → 再提交」之间空转。与 `with-timeout` 同款：
   * 异步编排原语，进任何子域都会让其余消费方反向依赖它。顶层单例。 */
  "src/lib/async-pool.ts",
  /* 进程内异步互斥（ISSUE #3832/#3833/#3836 审计地基）：「先读 → 判断 → 写」
   * 的多语句序列在并发下互相覆盖 / 重复落行，SQLite 单写者只保证单条语句原子。
   * 消费方横跨 `server/api/routers`（series-generation 批量入队）、`lib/core`
   * （repository-film 日志追加）、`lib/app-settings`（设置保存，即将接入）——
   * 进任何子域都会让其余消费方反向依赖它。与 `async-pool` / `with-timeout`
   * 同款：异步编排原语，顶层单例。 */
  "src/lib/async-mutex.ts",
]);

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

// 只排除「不可能放仓库入口」的目录:依赖、构建产物、被 gitignore 的打包输出、
// 以及 target(可能包含第三方 Rust 产物)。用相对路径前缀判断,避免按目录名
// 误伤 tools/shadcn-registry 这类同名但受规范的目录。
/**
 * R1–R14 的**触发面**：这一刀扫的目录与文件 —— `ifModify` globs 的唯一出处。
 *
 * 干什么用：平台侧 `.cnb.yml` 的 `文件结构硬规则` 带一组 `ifModify` —— 本次改动
 * 一处都不落在这些 glob 里时，这一步不执行（与本地钩子
 * `skipUnlessStagedTouches()` 同义）。而这组 glob 与**这里的扫描根**必须是同一件事，
 * 否则「收窄了」与「扫描面变了」会各自漂、且谁都不会响。
 *
 * 于是它由两段拼成，两段都是**从判据自己的读取点机械导出的**：
 *
 *   ① `SCAN_ROOTS` —— 脚本真的遍历的那几个根；另加根目录本身（R9 的两形态与
 *      R7/R8 的第一层就扫在 `"."`）。按目录写成 `<dir>/**`，根目录写成
 *      `ROOT_SCRIPT_GLOBS`（**点名的扩展名**，不是 `*`：根目录里还有 README、
 *      配置、`.gitignore` 那些，它们一个都不参与 R7/R8 的判据）；
 *   ② 导出给 `scripts/ci-incremental-gates.mjs`，由那边的登记表原样用在
 *      `ifModify` 上 —— **别在 YAML 里手抄第二份**。
 *
 * ⚠️ 新增一条以别的目录为扫描根的规则时，同批回来加一行（这是 R 系列唯一会让
 * 「改了那个目录却不触发本步」的失效面）。
 */
const SCAN_ROOTS = ["src", "scripts", "tools"];

/** 根目录里的判据按**扩展名**触发（见上面 ①）。 */
const ROOT_SCRIPT_GLOBS = ["*.ps1", "*.bat", "*.cmd", "*.vbs", "*.ts", "*.tsx"];

/** `ifModify` 形态的触发面（`ci-incremental-gates.mjs` 直接用它）。 */
const TRIGGER_GLOBS = [...ROOT_SCRIPT_GLOBS, ...SCAN_ROOTS.map((dir) => `${dir}/**`)];
const SCAN_EXCLUDED = [
  "node_modules/",
  ".git/",
  ".next/",
  "coverage/",
  "generated/",
  "temp/",
  "python-venv/",
  "log/",
  "dist/",
  "docs/",
  "playwright-report/",
  ".workbuddy/",
  "src-tauri/target/",
  "src-tauri/static/",
];

//   ① .ps1 双击入口(ISSUE #29):6 个根入口(start-web/run-local/verify-quality/
//      start-tauri/start-desktop/register-comfyapp-protocol)曾平铺在仓库根,
//      与 package.json / tsconfig.json 混排。现统一归入 tools/start/,与
//      tools/build/、tools/shadcn-registry/、tools/database-studio/ 同构。
//   ② git 自身的临时状态文件(ISSUE #1586):MERGE_MSG / COMMIT_EDITMSG /
//      SQUASH_MSG 这一族归 `.git/`,它们的**唯一**用途是给一次提交当 message
//      来源。落进工作区只可能是"用 -F 指了个工作区文件、提交完忘了删",而那个
//      文件此后没有任何读者 —— 实测仓库里真的有过一份(`.merge_msg`,27 行合并
//      说明随一次 squash 合并进了 master),它不会报错、不会过期、也没有任何
//      地方会再读它,只能靠人偶然翻到。判据认"名"不认"内容":内容无法自证是
//      垃圾(一份合法的设计说明也可以长这样),而名字是这一族唯一的稳定特征。
// 仍然只拦这两类 —— 其它后缀的根文件(配置/文档/各工具的点文件)不受约束,
// 避免把一个"根目录该长什么样"的工程习惯变成需要维护的完整白名单。
/* git 临时状态文件名(不区分大小写;带不带前导点都认)。 */
const GIT_TRANSIENT_ROOT_FILES = new Set([
  ".merge_msg",
  "merge_msg",
  "mergemsg",
  "commit_editmsg",
  "squash_msg",
  "tag_editmsg",
  "merge_head",
]);

module.exports = {
  FORBIDDEN_SCRIPT_EXT,
  BOM_REQUIRED_DIRS,
  NON_ASCII,
  HISTORY_DATE,
  HISTORY_TAG,
  HISTORY_TASK_DASHED,
  HISTORY_TASK_BARE,
  HISTORY_TASK_REF_CONTEXT,
  BLOCK_COMMENT_CLOSE,
  DOMAINS,
  DOMAIN_EXEMPT,
  R2_EXEMPT,
  NEXT_RESERVED,
  CONVENTION_EXEMPT,
  SCAN_EXCLUDED,
  GIT_TRANSIENT_ROOT_FILES,
  SCAN_ROOTS,
  ROOT_SCRIPT_GLOBS,
  TRIGGER_GLOBS,
};
