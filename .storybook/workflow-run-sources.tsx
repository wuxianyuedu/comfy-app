/**
 * 「工作流运行（执行日志）→ story」注入层（ISSUE #1381 的第五批）。
 *
 * ## 它解决什么
 *
 * `studio/logs/TaskLogTimeline` 是**纯 props** 的（`logs` / `rowTestId` /
 * `topSlot` …），所以它看起来「给一数组就能摆」。而它吃的那个数组**不是随便
 * 一个数组**：真机上是 `workflow-run-store` 按 SSE 帧累积出来的
 * `TaskLogEntry[]`，`WorkflowRunLogModal` / `QueueTaskLogModal` 从
 * `useSyncExternalStore` 读到它再传下来。
 *
 * 于是 story 里手捏一份 `TaskLogEntry[]` 字面量就是手捏一份假形态：它绕过了
 * `appendWorkflowRunLog()` 的两条真实取舍 —— ① 按 `(t, msg)` 去重（SSE 重放
 * 与增量推送会发同一帧）；② `MAX_LOGS` 截尾（长任务几千条 progress 行）。
 * 面板上「计数 / 级别筛选 / 一页多少条」全都按这两条算，手抄的数组只是
 * 「看着像那么回事」。
 *
 * ## 为什么让 story 声明**哪一次运行**，而不是声明日志文案
 *
 * 与 `message-center-sources.tsx` 同一条口径：日志行的文案**不是被设计出来的**，
 * 是被生成链路按阶段打出来的。所以场景交出的是一条**真链路会打出来的步骤序列**
 * （ComfyUI 提交 → 队列等待 → 采样 → 落盘），由 store 的真 action
 * `appendWorkflowRunLog()` 逐条落板 —— 去重与截尾照常由生产代码算。
 *
 * ## 三条口径（与前面四层同源）
 *
 * 1. **场景是「命名的一种」**：`WORKFLOW_RUN_SCENES` 是唯一那份映射。
 * 2. **写 store 走真 action**：`registerWorkflowRun()`（登记一次就地运行，
 *    与 `use-generation-runner` 拿到 taskId 时走的是同一条）+ 逐条
 *    `appendWorkflowRunLog()`。不 `setState`、不直接改 `runs` Map（它是模块私有的，
 *    改它本来也做不到）。
 * 3. **失败那条横幅与 error 日志行一起给**：`failWorkflowRun()` 是唯二写
 *    `errorMessage` 的入口，它**同时**把原因补成一条 error 日志行（否则用户按
 *    级别筛选到「错误」时看不到原因 —— 见它自己的注释）。story 走真入口，于是
 *    「横幅 + 时间线里那行」这对关系在画布上就是真的。
 */

import type { Decorator } from "@storybook/nextjs";

import {
  appendWorkflowRunLog,
  clearAllWorkflowRuns,
  failWorkflowRun,
  patchWorkflowRun,
  registerWorkflowRun,
} from "~/lib/workflow/workflow-run-store";
import type { TaskLogEntry } from "~/lib/workshop/generation-client";

/**
 * 一条步骤日志的**半成品**：星级与来源之外，`t` 由生成器按序给。
 *
 * 刻意不叫 `TaskLogEntry`（它少一个 `t`）：让「时刻由生成器递增地算出来」
 * 这件事在类型上就写清楚 —— 手抄 `t: 1` / `t: 2` 会让「同一毫秒 vs 相邻毫秒」
 * 这一维（面板计数的次键）变成随手指定的。
 */
export interface LogStep {
  readonly level: TaskLogEntry["level"];
  readonly msg: string;
  readonly src?: string;
}

/**
 * 一个运行场景：给**这次运行是什么**，让 store 自己建出那批日志。
 *
 * `steps` 是链路会打的步骤；`failWith` 非空时结尾走 `failWorkflowRun()`
 * （横幅 + error 行一起落）。
 */
export interface WorkflowRunScene {
  /** 这个场景解决什么、真机上什么时候会出现。 */
  readonly about: string;
  /** 登记进 store 的运行名（弹窗头部按它标注这次运行）。 */
  readonly workflowName: string;
  /** 步骤序列（时刻由生成器按序算）。 */
  readonly steps: ReadonlyArray<LogStep>;
  /** 真机上这条链路里逐帧推进的进度（0–100）；不给则不 patch。 */
  readonly progress?: number;
  /** 非空则结尾调 `failWorkflowRun(reason)`（横幅 + error 日志行）。 */
  readonly failWith?: string;
}

/* ── 真链路的步骤序列 ──────────────────────────────────────────────────────
 *
 * 下面这几段抄自 `generation-client.ts` 与工坊各阶段的**真文案形态**
 *（`[阶段] 动作`、带 `src` 的客户端行、以 `✓` / `✗` 收尾的结果行）。抄错的表现
 * 不是报错 —— 是画布上少一行、或级别徽标串了档，而这正是「story 是假的」的现场。
 */
const SUBMIT_STEPS: ReadonlyArray<LogStep> = [
  { level: "info", msg: "[client] 已提交任务 task_7f21c8", src: "client" },
  { level: "info", msg: "[comfyui] 上传 3 个输入文件完成" },
  { level: "progress", msg: "[comfyui] prompt 3f2a… 入队（前面 2 个任务）" },
  { level: "progress", msg: "[comfyui] 队列等待 4.2s，超过本机均值" },
  { level: "progress", msg: "[comfyui] 采样 1/3" },
  { level: "progress", msg: "[comfyui] 采样 2/3" },
  { level: "progress", msg: "[comfyui] 采样 3/3" },
  { level: "info", msg: "[comfyui] 落盘 ComfyUI_00042_.png" },
  { level: "success", msg: "✓ 生成完成（用时 38.6s）" },
];

const FAILING_STEPS: ReadonlyArray<LogStep> = [
  { level: "info", msg: "[client] 已提交任务 task_91ab03", src: "client" },
  { level: "progress", msg: "[comfyui] prompt 91ab… 入队（前面 0 个任务）" },
  { level: "warn", msg: "[comfyui] 显存占用 11.8/12.0 GB，接近上限" },
  { level: "error", msg: "[comfyui] 执行失败：OOM（显存不足）" },
];

const LONG_STEPS: ReadonlyArray<LogStep> = Array.from({ length: 340 }, (_, i) => {
  const n = i + 1;
  if (n % 40 === 0) {
    return { level: "info", msg: `[comfyui] 分段完成 ${n}/340`, src: "client" };
  }
  return { level: "progress", msg: `[comfyui] 采样步 ${n}/340 完成` };
});

/**
 * 场景注册表 —— **唯一**一份「名字 → 真步骤序列」的映射。
 *
 * 加一个场景之前先回答：这条序列是不是**真链路会打出来的**？随手编几行好看
 * 的文案等于把假形态请回来（`store-sources.tsx` 的一份同款口径）。
 */
export const WORKFLOW_RUN_SCENES = {
  /** 默认：一次成功的就地运行 —— 各档级别齐全，进度条走到 100。 */
  completed: {
    about: "一次成功的就地运行（提交 → 排队 → 三段采样 → 落盘 → ✓ 完成）",
    workflowName: "角色三视图 · 就地运行",
    progress: 100,
    steps: SUBMIT_STEPS,
  },
  /** 失败：横幅（`errorMessage`）+ 时间线里那条 error 行**成对**出现。 */
  failed: {
    about: "一次失败的运行（顶部横幅与时间线里的 error 行成对）",
    workflowName: "角色三视图 · 就地运行",
    progress: 62,
    failWith: "OOM（显存不足）：请在设置里降低分辨率后重试",
    steps: FAILING_STEPS,
  },
  /**
   * 340 条：`MAX_LOGS`（300）**之下**的「一页装不完」现场
   *（`LOG_MODAL_MAX_ROWS` 截尾时才看得出底栏那行计数）。
   */
  longTask: {
    about: "340 条步骤日志（一页装不完，底栏与截尾口真正被走到）",
    workflowName: "批量出图 · 12 张",
    progress: 88,
    steps: LONG_STEPS,
  },
  /** 只有警告与错误：级别筛选页签上其余几档计数为 0 的那一档。 */
  warnings: {
    about: "只有警告与错误（级别筛选页签上其余几档计数为 0）",
    workflowName: "角色三视图 · 就地运行",
    steps: [
      { level: "warn", msg: "[comfyui] 队列等待 9.8s，远超本机均值" },
      { level: "warn", msg: "[comfyui] 显存占用 11.8/12.0 GB，接近上限" },
      { level: "error", msg: "[comfyui] 执行失败：OOM（显存不足）" },
    ],
  },
  /** 登记了运行但一条日志都还没来：`emptySlot` 那一档（不是「没画出来」）。 */
  empty: {
    about: "登记了运行但还没收到任何日志（空态占位的那一档）",
    workflowName: "角色三视图 · 就地运行",
    steps: [],
  },
  /**
   * 上面的键就是**全部**合法的场景名：写成字面量对象（不加 `Record<string, …>`
   * 注解）是为了让 `RunSceneName` 收成联合，拼错名字在 tsc 就红。
   */
} satisfies Record<string, WorkflowRunScene>;

/** 场景名清单（story 的 Args 下拉取自它，不手抄）。 */
export const WORKFLOW_RUN_SCENE_NAMES = Object.keys(WORKFLOW_RUN_SCENES);

/** 场景名的类型（`runSceneLogs()` 的参数宽度 —— 拼错名字在 tsc 就红）。 */
export type RunSceneName = keyof typeof WORKFLOW_RUN_SCENES;

/** 场景里那次运行的 taskId（`runSceneLogs()` 与装饰器共用同一份推导）。 */
const SCENE_TASK_ID = "task_story_0001";

/** 相邻两步之间的间隔（真链路的采样步大致就是这个量级）。 */
const STEP_MS = 1400;

/**
 * 场景的**条目**：给一个场景名与这次运行的起点，算出一串 `TaskLogEntry`。
 *
 * ## 时刻为什么锚在「现在」，而不是一个写死的固定日期
 *
 * 写死一个 `2026-10-05T09:30` 会让这份时间线**与失败行对不上**：`failWorkflowRun()`
 * 补的那条 error 行用的是它自己的 `Date.now()`（生产代码的真口径），于是画布上
 * 出现「最后一步 09:30、失败行 18:32」——**同一次运行里差九个多小时**。那不是真
 * 机上的形态，读故事的人会以为哪里算错了。
 *
 * 锚在 `baseMs` 就没有这个窗口：整条链路（含失败行）都落在同一分钟里。
 *
 * ## 它不妨碍幂等
 *
 * 时刻是渲染输入、每次 seed 都可能不同，而 `appendWorkflowRunLog()` 按 `(t, msg)`
 * 去重 —— 看似会让 StrictMode 的第二次跑重复落板。实际不会：`seedScene()` **先
 * `clearAllWorkflowRuns()`**，第二次是在空 store 上重建（store 是同一个单例，但
 * 内容被清干净了），末态与第一次逐字相同。全局重放也由那一句 `clear()` 兜住。
 */
export function runSceneLogs(name: string, baseMs: number): Array<TaskLogEntry> {
  const scene = requireScene(name);
  return scene.steps.map((step, index) => ({
    t: baseMs + index * STEP_MS,
    level: step.level,
    msg: step.msg,
    ...(step.src === undefined ? {} : { src: step.src }),
  }));
}

/** 场景里那次运行的显示名（story 头部按它标注）。 */
export function runSceneName(name: string): string {
  return requireScene(name).workflowName;
}

/** 场景里那次运行的终态（失败场景给 `errorMessage`，其余为 undefined）。 */
export function runSceneError(name: string): string | undefined {
  return requireScene(name).failWith;
}

/** 按名字取场景；写错就抛（`parameters` 里那个名字是不可信输入）。 */
function requireScene(name: string): WorkflowRunScene {
  /* SAFETY: 类型断言已复核 */
  const scene: WorkflowRunScene | undefined = WORKFLOW_RUN_SCENES[name as RunSceneName];
  if (scene === undefined) {
    throw new Error(
      `运行场景里没有叫「${name}」的那种。现有的：${WORKFLOW_RUN_SCENE_NAMES.join(" / ")}`,
    );
  }
  return scene;
}

/**
 * 把场景写进真 store：登记运行 → 逐条 append → patch 终态。
 *
 * 全部走生产 action（`registerWorkflowRun` / `appendWorkflowRunLog` /
 * `patchWorkflowRun` / `failWorkflowRun`），去重与 `MAX_LOGS` 截尾照常生效。
 * 先 `clearAllWorkflowRuns()` 是必要的：故事之间共用一个 module-level store，
 * 不清的话上一份故事的时间线会串进这一份（而画布上「多出来的那几行」看不出
 * 是哪来的）。
 */
function seedScene(name: string): void {
  const scene = requireScene(name);
  clearAllWorkflowRuns();
  /* 起点 = 此刻回推 `steps.length × STEP_MS`：于是最后一步落在「刚刚」，而
     `failWorkflowRun()` 补的失败行紧接其后 —— 同一次运行里的时间差是分钟级，
     与真机一致（见 `runSceneLogs()` 的说明）。 */
  const baseMs = Date.now() - scene.steps.length * STEP_MS;
  registerWorkflowRun({
    taskId: SCENE_TASK_ID,
    workflowId: "wf_story_0001",
    workflowName: scene.workflowName,
    taskType: "generate",
    startedAt: baseMs,
    source: "canvas-node",
    status: "running",
  });
  for (const entry of runSceneLogs(name, baseMs)) {
    appendWorkflowRunLog(SCENE_TASK_ID, entry);
  }
  if (scene.progress !== undefined) {
    patchWorkflowRun(SCENE_TASK_ID, { progress: scene.progress });
  }
  if (scene.failWith !== undefined) {
    failWorkflowRun(SCENE_TASK_ID, scene.failWith);
  } else {
    patchWorkflowRun(SCENE_TASK_ID, { status: "done" });
  }
}

/**
 * 场景装饰器：story 的 `parameters.runScene` 声明名字，这里负责落板。
 *
 * 与 `withStoreScene` 同款：在**渲染期**写（组件首帧就读 store），且 `seedScene()`
 * 幂等（先 clear 再按同一批固定时刻 append）—— StrictMode 的双调用不产生差异。
 * 缺席时什么都不做，别的 story 不被搅。
 */
export const withWorkflowRunScene: Decorator = (Story, context) => {
  /* SAFETY: 类型断言已复核 */
  const name = (context.parameters as { runScene?: unknown }).runScene;
  if (typeof name === "string") {
    seedScene(name);
  }
  return <Story />;
};
