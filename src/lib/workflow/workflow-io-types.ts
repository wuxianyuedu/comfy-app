/* ── 共享的工作流对外 IO 类型 ──
 *
 * 「这个自定义工作流接受 / 产出什么」的唯一事实源，
 * 客户端组件（src/components/studio/...）与服务端路由
 *（src/server/api/routers/workflow.ts）**都**导入它。
 * 放在 `src/lib/` 下是为了让服务端不必跨界去引 `components/`。
 */
import { z } from "zod";

/* 一个暴露出来的引脚，形状与 GET /api/workflows/[id] 返回的一致。 */
export interface WorkflowIOEntry {
  direction: "input" | "output";
  /** IO 编辑模式里选的**语义**分桶 —— 不是数据类型。
   *  取值为 "param" / "widget" / "output"（自定义种类可自由取值）。 */
  kind: string;
  nodeId: string;
  name: string;
  label?: string;
  /** ComfyUI 的数据类型：STRING / INT / FLOAT / BOOLEAN / IMAGE / VIDEO … */
  type?: string;
  defaultValue?: unknown;
  nodeTitle?: string;
  multiline?: boolean;
  /** 把某个由控件支撑的输入标为必填。 */
  required?: boolean;
  /** 由 ComfyUI /object_info 解析出的 COMBO 候选项列表。 */
  options?: string[];
  /** 用户自定义的展示顺序。 */
  displayOrder?: number;
  /** seed 类参数的「控件后行为」（fixed / increment / decrement / random），
   *  与 ComfyUI 的 control_after_generate 对应；仅 seed 类 widget 有意义。 */
  seedMode?: string;
  /** 多模式参数覆盖层。键为模式码，值为该模式下的默认值与可见性。
   *  存在 workflowIO 的 JSON 列内，因此新增模式无需改表结构。 */
  modes?: Record<string, WorkflowIOModeOverride>;
  /** 宿主（外层封装）节点 id，**仅在「下钻到子工作流内部」勾选时**写入。
   *
   *  `nodeId` 此时是子图内部节点 id（`1670`），它在顶层画布上不存在；而运行期
   *  comfy-cli 展开子图后的节点 id 是 `4:1670`（宿主 id + 内部 id 用 `:` 拼接）。
   *  两个 id 都存下来，运行期就能确定性地还原拼接形式，不必靠「拿裸 id 去所有
   *  子图定义里扫一遍」的巧合兜底 —— 后者在同名内部 id 或定义缺失时会静默失效
   *  （表现为「改了参数没生效」）。顶层勾选的条目没有本字段。 */
  hostNodeId?: string;
  /** 本层槽位上**作者写的**业务名（与槽位名不同才有值）。
   *
   *  富化链里它排在通用翻译（`localized`）之后，故不参与显示；但它是判定
   *  「本地存的那串是不是机器生成的槽位名」的第二判据：富化名恰好停在槽位名
   *  （`value_1`）时，只有它还能说明本层确实有作者命名。没有它，同名条目在
   *  写入时会被当成作者命名固化回库，显示名随即退回别名（ISSUE #349）。 */
  slotLabel?: string;
}

/** 单个参数在某一个模式下的覆盖项。 */
export interface WorkflowIOModeOverride {
  /** 覆盖该模式下的默认值；undefined = 不覆盖，回退到通用默认值。 */
  defaultValue?: unknown;
  /** 该模式下是否显示此参数；undefined = 显示（默认可见）。 */
  visible?: boolean;
  /** 该模式下是否标记为必填；undefined = 不覆盖，回退到条目级 required。 */
  required?: boolean;
  /** 该模式下 seed 类参数的「控件后行为」（fixed / increment / decrement /
   *  random）；undefined = 不覆盖，回退到条目级 seedMode。 */
  seedMode?: string;
}

/** 方向 × 种类判别联合：合法的 (direction, kind) 组合只有 `input+param`、
 *  `input+widget`、`output+output` 三种；`output+param` 这类非法组合在类型层面
 *  就被排除（`kind` 仍是开放字符串，自定义种类经 `WorkflowIOEntry` 透传，
 *  不进这条判别联合）。 */
export type IOParamSlot =
  | { direction: "input"; kind: "param" | "widget" }
  | { direction: "output"; kind: "output" };

export type WorkflowIOMap = Record<string, WorkflowIOEntry>;

/* ── 形状契约（外部输入边界，规范 §5.5）──────────────────────────────────
 * workflowIO **列的解析**。schema 放在类型旁边（同一处定义、同一处演进），
 * 消费方（tRPC 路由）只调用 `parseWorkflowIOMap`，不自己复制判据。 */
/** 条目的**身份字段**是硬约束（写入侧一定带这四个）；`.loose()` 是关键 ——
 *  富化字段（label / type / defaultValue / modes / hostNodeId / slotLabel …）
 *  必须原样留下，剥键会让工作流库列表上的显示名与控件类型整片退化。
 *  形状不符的条目丢弃：换作盲转型（`as unknown as WorkflowIOMap`），坏条目会
 *  一路流到下游某个 `.name` 读取点才炸，报错位置离成因很远。 */
const WorkflowIOEntrySchema = z.looseObject({
  direction: z.union([z.literal("input"), z.literal("output")]),
  kind: z.string(),
  nodeId: z.string(),
  name: z.string(),
});
const WorkflowIOMapSchema = z.record(z.string(), WorkflowIOEntrySchema);

/** 解析 workflowIO 列（DB JSON 列）；非对象 / 形状不符 → 空表。 */
export function parseWorkflowIOMap(value: unknown): WorkflowIOMap {
  const parsed = WorkflowIOMapSchema.safeParse(value);
  return parsed.success ? parsed.data : {};
}

/** 该参数在指定模式下是否可见。未开启模式（mode 为空）时一律可见。
 *
 *  入参刻意只要求「带 modes 字段」这一结构子集，这样派生产物
 *  （WorkflowIOEntry & { ioKey, control } 等）也能直接传进来。 */
export function isVisibleInMode(
  entry: { modes?: Record<string, WorkflowIOModeOverride> } | undefined | null,
  mode?: string | null,
): boolean {
  if (!entry || typeof entry !== "object") return true;
  if (!mode) return true;
  return entry.modes?.[mode]?.visible ?? true;
}

/** 参数默认值的回退：模式覆盖值 → 工作流图内读出的 defaultValue。
 *
 *  `modes[mode].defaultValue` 是作者针对**该模式**填的值（模式页签写的覆盖层），
 *  压过图内默认值；未开启模式（mode 为空）时只读图内值 —— 与 `manualTargetFor`
 *  的「没有模式就没有手工线」同构。
 *
 *  历史中间档 `entry.value`（旧「通用页签」写的全局覆盖）**整档删除**：通用页签
 *  早已移除，那一档只剩历史落库数据，且它写的值在模式语境里永远不会被读到
 *  （模式覆盖永远压过它）。落库里的残留不再透传，下一次 PATCH 自然清掉。
 *
 *  `null` 不算覆盖：它表示不出一个「有意义的默认值」，放行只会把 `null` 下发给
 *  ComfyUI；一律回退图内默认值。 */
export function resolveEntryDefault(
  entry: WorkflowIOEntry,
  mode?: string | null,
): unknown {
  if (mode) {
    const modeDefault = entry.modes?.[mode]?.defaultValue;
    if (modeDefault !== undefined && modeDefault !== null) return modeDefault;
  }
  return entry.defaultValue;
}

/** 参数 required 的两级回退：模式覆盖值 → 条目级 required。
 *
 *  与 resolveEntryDefault 同语义——模式覆盖只写在 modes[mode].required，
 *  未设置该字段的模式回退到条目级（工作流库/画布等未传 mode 的消费方
 *  仍按旧行为读取 entry.required）。未开启模式（mode 为空）时只读条目级。 */
export function resolveEntryRequired(
  entry: WorkflowIOEntry | undefined | null,
  mode?: string | null,
): boolean | undefined {
  if (!entry || typeof entry !== "object") return undefined;
  if (mode) {
    const modeRequired = entry.modes?.[mode]?.required;
    if (modeRequired !== undefined) return modeRequired;
  }
  return entry.required;
}

/** 参数 seedMode 的两级回退：模式覆盖值 → 条目级 seedMode。
 *
 *  与 resolveEntryRequired 同语义，按模式解析「控件后行为」，
 *  undefined = 该参数不是 seed / 该模式无覆盖，回退条目级 seedMode。 */
export function resolveEntrySeedMode(
  entry: WorkflowIOEntry | undefined | null,
  mode?: string | null,
): string | undefined {
  if (!entry || typeof entry !== "object") return undefined;
  if (mode) {
    const modeSeed = entry.modes?.[mode]?.seedMode;
    if (modeSeed !== undefined) return modeSeed;
  }
  return entry.seedMode;
}

/** 收集整张 IO 表里出现过的全部模式码（去重、保持稳定顺序）。 */
export function collectModeCodes(
  io: WorkflowIOMap | null | undefined,
): string[] {
  const seen = new Set<string>();
  for (const entry of Object.values(io ?? {})) {
    if (!entry || typeof entry !== "object") continue;
    for (const code of Object.keys(entry.modes ?? {})) {
      if (code) seen.add(code);
    }
  }
  return [...seen];
}
