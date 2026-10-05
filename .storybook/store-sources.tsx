/**
 * 「store → story」注入层（ISSUE #1381 的第三批：三层注入之一）。
 *
 * ## 它解决什么
 *
 * `studio/logs/**` 里有一批组件**自己从 store 取状态**（`useLogPanel`）—— 它们
 * 不通过 props 拿数据，而是 import 那个 module-level 的单例。给它们写 story 一直
 * 卡在同一处：story 里得先「按真形状把状态写进 store 再摆」，而手捏一份 state
 * 就是手捏一份**假形态** —— 画布看着对、真机上不对（与 `data-sources.tsx` 的
 * 第一条口径同源）。
 *
 * 本模块把死结换成流程：**story 声明「我要哪种场景」，注入层负责把它变成真的
 * 那一份**。与值源（`json` / `media`）的区别只在于**写进哪里**：值源经 props，
 * 这里经 store 的**真 action**。
 *
 * ## 为什么走真 action 而不是 `setState`
 *
 * 场景是**原始日志文本**（`LogEntry` 之前的形态），由 store 自己的解析入口
 * `parseFileLogs()` 变成条目、再经真 action `appendFileLogs()` 落板。所以
 * 计数、来源分桶、时间线排序、去重全部由**生产代码**算出来 —— story 里不出现
 * 一个手写的 `LogLevelCounts`，改口径时画布跟着变。
 *
 * 这条是这一层唯一重要的取舍：`useLogStore.setState({ logs: […] })` 也能让画布
 * 出现内容，但它会把「解析 + 派生」两条链路整个跳过。那样 story 验的是
 * 「store 能不能存数组」，不是「面板长什么样」。
 */

import type { Decorator } from "@storybook/nextjs";

import {
  parseFileLogs,
  useLogStore,
  type LogEntry,
} from "~/components/studio/logs/log-store";

/**
 * 一路文件通道的原文。
 *
 * `origin` 是这条通道的名字（`LogEntry["origin"]`，真有这一列）；`text` 是这条
 * 通道**自己的格式**——启动链路写 `[HH:MM:SS]`、应用服务与运行期写 ISO 时刻带
 * 级别段。三个正则各不相同，所以一段原文**不能**同时冒充三条通道。
 */
export interface OriginBlock {
  readonly origin: NonNullable<LogEntry["origin"]>;
  readonly text: string;
}

/**
 * 一个 store 场景：给若干段**真格式的日志原文**，让 store 自己解析入库。
 *
 * 分「块」而不是一段大文本，是因为每块要按**自己那条通道的格式**解析
 *（`parseFileLogs(text, date, origin)` 的原样用法）—— 这一点正是这一层
 * 最容易糊弄过去的地方：把三通道的行抄成一种格式、全按一个 origin 入库，
 * 画布上「来源」那一列会整列同名，而来源分桶的计数也就没有被真的验过。
 */
export interface LogStoreScene {
  /** 这个场景解决什么、真数据长什么样（故事读者看这一段才知道自己在看什么）。 */
  readonly about: string;
  /** 按通道分块的原文（每块一个真实来源通道）。 */
  readonly blocks: readonly OriginBlock[];
}

/* ── 真格式的日志原文 ──────────────────────────────────────────────────────
 *
 * 三段的格式各不相同，因为它们**在真机上就是不同的**：启动链路（
 * `launcher`）是 `log/launcher/dev-launcher.log` 的记录头、应用服务输出
 * （`app`）带 `[INFO]` 级别段、运行期业务动作（`app-runtime`）多一个毫秒与
 * 命名空间段。格式抄自 `log-analysis.ts` 的三个正则 —— 抄错的表现是画布里
 * 一行都不出现（解析器不认），而那正好是「story 是假的」的现场。
 */
const LAUNCHER_TEXT = [
  "[08:14:02] [INFO] 定位项目根：/workspace",
  "[08:14:02] [INFO] 解析链端口：3311（来源：检出路径推导）",
  "[08:14:03] [STEP] 启动 Next dev server（turbopack）",
  "[08:14:21] [OK] Next dev server 已就绪：http://127.0.0.1:3311",
  "[08:14:21] [WARN] ComfyUI 未在 8188 上应答，进入等待",
  "[08:14:34] [OK] ComfyUI 已就绪（版本 0.3.62）",
].join("\n");

const APP_TEXT = [
  "[2026-10-05 08:14:21.104] [INFO] GET /workspace 200 in 412ms",
  "[2026-10-05 08:14:22.317] [INFO] [trpc] generate.generate 312ms",
  "[2026-10-05 08:14:26.882] [WARN] [trpc] workflow.list 1840ms（超过 1500ms 预算）",
  "[2026-10-05 08:14:31.055] [ERROR] [trpc] history.list 失败：SQLITE_BUSY: database is locked",
  "[2026-10-05 08:14:33.719] [INFO] 队列：2 运行中 / 5 等待",
].join("\n");

const APP_RUNTIME_TEXT = [
  "[2026-10-05 08:14:35.221] [INFO] [film] 开始成片：project=p_8f2a1c 镜头 8 个",
  "[2026-10-05 08:14:36.904] [INFO] [comfyui] 提交 prompt 3f2a…（27 个节点）",
  "[2026-10-05 08:14:41.118] [WARN] [comfyui] 队列等待 4.2s，超过本机均值",
  "[2026-10-05 08:14:58.660] [ERROR] [film] 第 5 镜失败：OOM（显存不足）",
  "[2026-10-05 08:15:00.002] [INFO] [film] 已按建议降分辨率重试第 5 镜",
].join("\n");

/**
 * 场景注册表 —— **唯一**一份「名字 → 真日志原文」的映射。
 *
 * 加一个场景之前先回答：它的原文是不是**真机上会出现的那种**？随手编几条好看
 * 的行等于把假形态请回来。
 */
export const LOG_STORE_SCENES = {
  /** 默认：三段来源混在一起 —— 计数、来源分桶、时间线的真实负载。 */
  mixed: {
    about: "启动链路 + 应用服务 + 运行期三段混在一起（来源分桶与计数并发）",
    blocks: [
      { origin: "launcher", text: LAUNCHER_TEXT },
      { origin: "app", text: APP_TEXT },
      { origin: "app-runtime", text: APP_RUNTIME_TEXT },
    ],
  },
  /** 只有高噪音级别：验证筛选与计数在「全是警告/错误」时的样子。 */
  errorsOnly: {
    about: "只有警告与错误（设置里的日志分类开关关掉低级别时的现场）",
    blocks: [
      {
        origin: "launcher",
        text: [
          "[08:16:01] [WARN] ComfyUI 未在 8188 上应答，进入等待",
          "[08:16:14] [ERROR] trpc history.list 失败：SQLITE_BUSY: database is locked",
          "[08:16:20] [ERROR] film 第 5 镜失败：OOM（显存不足）",
          "[08:16:44] [WARN] comfyui 队列等待 4.2s，超过本机均值",
        ].join("\n"),
      },
    ],
  },
  /**
   * comfy-cli 原文行 + 本机路径 + 调用位置：`LogRow` 那三条视觉分叉的现场。
   *
   * 这一段刻意用**真格式**的四行，形态都抄自生产代码、不是捏的字符串：
   *
   *  · `[comfy-cli 原始] {…}` —— 可展开那一条。**命名空间段就是那个前缀**：
   *    `parseFileLogs` 把 `[<ns>]` 拼在正文最前面（见 `log-analysis.ts` 的
   *    `msgText`），而 `splitCliLogLine()` 要求正文**以它开头** —— 写成
   *    `[comfyui] [comfy-cli 原始] {}` 时判据不认，那一行会静默退化成不可展开
   *    的普通行（画布上看不出来，只是「怎么没折叠」）；
   *  · 含 `log/exports/…` 的一行 —— 路径识别（`findLogPathTokens`）；
   *  · 带 `[<ns>]` 命名空间的一行 —— 常见的业务行形态；
   *  · 一条 error 级别的 tRPC 失败行。
   */
  rowShapes: {
    about:
      "comfy-cli 原文行（可展开的 JSON 容器）+ 本机路径 + 调用位置，一次看全 LogRow 的分叉",
    blocks: [
      {
        origin: "app-runtime",
        text: [
          '[2026-10-05 08:20:01.104] [INFO] [comfy-cli 原始] {"kind":"envelope","node_id":"3","class_type":"KSampler","output":{"images":[{"filename":"ComfyUI_00042_.png","subfolder":"","type":"output"}]}}',
          "[2026-10-05 08:20:02.207] [INFO] [log] 导出已写入 log/exports/2026-10-05T08-20-02-launcher.txt",
          "[2026-10-05 08:20:03.318] [WARN] [config] 读取配置失败：ENOENT: no such file or directory",
          "[2026-10-05 08:20:04.429] [ERROR] [trpc] history.list 失败：SQLITE_BUSY: database is locked",
        ].join("\n"),
      },
    ],
  },
  /** 一行都不给：空态与「更早 N 条已折叠」之外的零条现场。 */
  empty: {
    about: "空时间线（面板刚启用、还没轮到任何一路日志）",
    blocks: [],
  },
  /**
   * 上面的键就是**全部**合法的场景名：写成字面量对象（不加 `Record<string, …>`
   * 注解）是为了让 `SceneName` 收成联合，拼错名字在 tsc 就红 —— 注解成
   * `Record<string, …>` 会把 `keyof` 退成 `string`，那时「场景名打错」只会在
   * 运行期以一句抛错出现。
   */
} satisfies Record<string, LogStoreScene>;

/** 场景名清单（story 的 Args 下拉取自它，不手抄）。 */
export const LOG_STORE_SCENE_NAMES = Object.keys(LOG_STORE_SCENES);

/** 场景名的类型（`sceneEntries()` 的参数宽度 —— 拼错名字在 tsc 就红）。 */
export type SceneName = keyof typeof LOG_STORE_SCENES;

/** Args 面板里那条「store 场景」旋钮（选项取自注册表）。 */
export function logSceneArgType() {
  return {
    description: "写进真 store 的日志场景（原文由 store 自己解析入库）",
    control: { type: "select" as const },
    options: LOG_STORE_SCENE_NAMES,
  };
}

/**
 * 把场景的**真原文**解析成条目并写进真 store。
 *
 * 三步都是生产代码的入口：`parseFileLogs()`（解析）→ `appendFileLogs()`（落板
 * + 派生计数）。`sessionStart` 置空是必要的 —— 它非空时 `appendFileLogs` 会把
 * 「时刻早于会话起点」的行整批裁掉（`dropStaleEntries`），而场景里的时刻是
 * 今天早上的固定值。
 */
function seedScene(name: string): void {
  useLogStore.getState().clear();
  useLogStore.setState({ sessionStart: null });
  const entries = sceneEntries(name);
  if (entries.length === 0) return;
  /* 一次 `appendFileLogs` 收全部块：合并、去重、分桶、计数都由 store 自己算
     （分多次写会让计数经过几个中间态，story 看到的末态相同、没意义）。 */
  useLogStore.getState().appendFileLogs(entries);
}

/**
 * 场景的**条目**：给一个场景名，拿 store 自己解析出来的那批 `LogEntry`。
 *
 * 为什么要有这条出口：有一批组件（`LogRow` / `TaskLogTimeline`）是**纯 props**
 * 的 —— 它们要的不是 store，而是一条真日志。story 里手捏一个 `LogEntry`
 * 字面量（`{ id: "x", time: 1, level: "warn", message: "…", source: "system" }`）
 * 就是手捏一份假形态：`seq` / `origin` 与解析链路的取舍全被跳过，而行内的
 * JSON 折叠、路径识别、关键词高亮**都按那几个字段分叉**。
 *
 * 所以取值这一侧也只留一条路：原文进 `parseFileLogs()`，输出既给 store
 * （`withStoreScene`）也给纯 props 的 story（这里）。
 */
export function sceneEntries(name: string): LogEntry[] {
  /* `parameters` 里那个名字是不可信输入（story 里手写的字符串），所以按
     `string` 查、查不到就抛 —— 与值源的 `load()` 同一条口径。 */
  const scene: LogStoreScene | undefined = LOG_STORE_SCENES[name as SceneName];
  if (scene === undefined) {
    throw new Error(
      `store 场景里没有叫「${name}」的那种。现有的：${LOG_STORE_SCENE_NAMES.join(" / ")}`,
    );
  }
  /* 每块按**自己那条通道的格式**解析（三个正则各不相同），再按时刻合并 ——
     合并归 store 的 `appendFileLogs`（`mergeTimeline`）。 */
  return scene.blocks.flatMap((block) =>
    parseFileLogs(block.text, undefined, block.origin),
  );
}

/**
 * 场景装饰器：story 的 `parameters.storeScene` 声明名字，这里负责落板。
 *
 * ## 为什么在**渲染期**写 store，而不是 `useEffect`
 *
 * store 是 module-level 单例，而组件在**首次渲染**就去读它 —— `useEffect` 是
 * 提交之后才跑的，于是第一帧读到的仍是空 store（表现是「story 里 store 空着」，
 * 而这正是这一层最容易静默失效的形态）。在渲染期（装饰器函数体里）写就没有
 * 这个窗口：装饰器是**包在组件外面的**，它的函数体先于子树渲染执行。
 *
 * 渲染期写副作用平时是禁忌，这里可以是因为两点：① 写的是**外部单例**、不参与
 * React 的渲染树 diff；② `seedScene()` 是**幂等**的（先 `clear()` 再 append
 * 同一批原文，跑两次得到同一个末态）—— StrictMode 的双调用因此不产生差异。
 *
 * 不用 hook 的另一个直接原因（不是风格）：装饰器的名字不以大写字母开头，而
 * `react-hooks/rules-of-hooks` 判的就是这个 —— 里面调 `useEffect` 会被当场拦下。
 *
 * ## 为什么读 `parameters` 而不是 `args`
 *
 * store 里的东西**不经过 props**（这正是这一层存在的理由），而 `parameters` 是
 * 「story 对环境的要求」该待的地方 —— 与 `parameters.appOrigin` 同一口径
 * （`preview.tsx`）。`args` 那一档留给**组件自己的**入参（如 `counts`，那是 props）。
 *
 * 缺席时**什么都不做**：别的 story（用真实 store 的那些）不该被搅。
 */
export const withStoreScene: Decorator = (Story, context) => {
  const name = (context.parameters as { storeScene?: unknown }).storeScene;
  if (typeof name === "string") seedScene(name);
  return <Story />;
};
