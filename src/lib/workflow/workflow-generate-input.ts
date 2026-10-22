/* ── `generate.generate` 的入参形状：服务端判据与客户端构造共用同一份 ──
 *
 * 台账 E4 的第四格。这一条通路此前长这样：客户端把载荷拼成
 * `Record<string, unknown>`，在传输前塞一句 `payload as GenerateInput`；重试那一头
 * 更是把**任务行 `params` 列里存的旧载荷**原样送回同一个 cast。类型别名
 * （`RouterInputs["generate"]["generate"]`）是从 schema 反向派生的，字段改名会当场
 * 编译红 —— 所以它不是漂移面；真正的洞是那两条 cast 让**客户端这一侧没有任何东西
 * 知道线上要什么形状**：少写一个必填键、把数组写成对象、发一个服务端已经不收的旧字段，
 * 都是运行时才由服务端 zod 判掉，而界面上只剩一句「生成失败」。
 *
 * 所以这里把两件事收在一处：
 *   · `generateInputSchema` —— **唯一**的入参判据。`src/server/api/routers/generate.ts`
 *     用它做 `.input()`，客户端用它做重试前的预检（`parseStoredGenerateInput`）。
 *     与 `workflow-io-types.ts` 同一手法：形状住在 lib，服务端不必跨界引视图，
 *     客户端也不必复制第二份。
 *   · `GenerateInput` —— 调用点写的就是这个类型，`startGenerate` 不再吃
 *     `Record<string, unknown>`（那正是 cast 能存在的条件）。
 *
 * 判据的落点在 `tests/generate-input-wire-contract.test.ts`：它不造夹具载荷，而是
 * 把**画布构造出的那一份**接进**真 router** 走一次，再判「收下 / 拒掉 / 拒得能说清」。
 */
import { z } from "zod";

import { workflowParamMapInputSchema } from "~/lib/workflow/workflow-param-map";

/** 一个「对外参数 → 节点端口」的取值项（画布与工坊两条通路共用同一个落点）。 */
const workflowInputSchema = z.object({
  nodeId: z.string(),
  name: z.string(),
  value: z.unknown().optional(),
});

/**
 * `generate.generate` 的入参判据（原先定义在路由文件里，那里客户端读不到）。
 *
 * 逐字段口径与过去一字未改，只给 `workflow` 补了一条**用户真的会撞上**的中文文案
 * （重试一条记录不全的旧任务时，缺的就是这一条）。其余字段仍是 zod 的默认文案：
 * 它们经 `parseStoredGenerateInput` 汇成一句中文再交给界面，服务端那条错误信封走的是
 * `src/server/api/trpc.ts` 的 `error.cause.flatten()`。
 */
export const generateInputSchema = z.object({
  /** 工作流库工作流 id（内置模板已移除，这里是唯一的工作流来源）。 */
  workflow: z.string().min(1, "缺少要执行的工作流"),
  /** 提示词 / 反向提示词：供历史列表与任务标题（参数真值走 workflowInputs）。 */
  prompt: z.string().max(2000).optional(),
  negative: z.string().max(2000).optional(),
  /** 参考图 / 首末帧文件名（已在 ComfyUI input 目录）。 */
  inputImage: z.string().optional(),
  firstFrame: z.string().optional(),
  lastFrame: z.string().optional(),
  /** 视频时长：帧数（按秒表达的口由 workflowInputs 里的 duration 落下）。 */
  frames: z.number().int().min(1).max(1000).optional(),
  /* 走 `paramMap` 列的**权威入参 schema**（`~/lib/workflow/workflow-param-map`）：
   * 库里真实落的是按模式归拢的三层结构（`source.mode:<模式>`），别在这里退化成
   * `z.record(z.string(), z.string())` —— 那表达不了这层结构（见该模块文件头）。 */
  paramMap: workflowParamMapInputSchema,
  workflowInputs: z.array(workflowInputSchema).optional(),
  projectId: z.string().optional(),
  /** 工坊镜头号：只作归属，不参与执行（执行载荷与它无关）。 */
  shotId: z.string().optional(),
  referenceImages: z.array(z.string()).optional(),
});

/**
 * 调用点写的入参类型。
 *
 * 取 `z.input` 而不是 `z.infer`：`paramMap` 那一条带 `.transform()`，`z.infer` 是
 * **转换之后**的形状（`paramMap` 变成必写的键），而调用方传的恰恰是转换**之前**的
 * 数据 —— tRPC 的 `RouterInputs` 用的也是前者。拿后者当类型，每个不写 `paramMap`
 * 的构造点都会平白红一次。
 */
export type GenerateInput = z.input<typeof generateInputSchema>;

/** 重试通道的读边界结果：`ok: false` 时带着**能直接给用户看**的一句。 */
export type StoredGenerateInput =
  { ok: true; input: GenerateInput } | { ok: false; message: string };

/**
 * 把「上次那次请求的载荷」（错误面板里的 `errorContext.request`，或任务行 `params`
 * 列里翻出来的旧形状）解析回可发送的入参。
 *
 * 为什么要在客户端预检，而不是照发出去让服务端拒：这一份数据是**外部输入**
 * （库里的一列 JSON，跨过一次 schema 演进），而重试是一条用户点下去就有副作用的
 * 动作。让服务端判的代价不是「多一次往返」，而是那句错误 —— tRPC 的 zod 信封
 * 在界面上是 `Expected array, received object` 这类英文原文，用户分不清是
 * 「我配的参数不对」还是「这条记录本身老了」。判据仍然只有一份：这里用的就是
 * 服务端那一个 `generateInputSchema`，不是另写一份收窄。
 */
export function parseStoredGenerateInput(raw: unknown): StoredGenerateInput {
  const parsed = generateInputSchema.safeParse(raw);
  if (parsed.success) return { ok: true, input: parsed.data };
  const where = parsed.error.issues
    .map((issue) => `${issue.path.join(".") || "入参"}：${issue.message}`)
    .join("；");
  return {
    ok: false,
    message: `这条记录的入参与当前形状不符（${where}），无法原样重跑；请重新配置参数后再生成。`,
  };
}
