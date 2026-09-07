/* ── Shared workflow-IO types ──
 *
 * Single source of truth for "what does this custom workflow accept / produce",
 * imported by BOTH client components (src/components/studio/...) and the server
 * router (src/server/api/routers/workflow.ts). Living in `src/lib/` keeps the
 * server from crossing the boundary into `components/`.
 */

/** One exposed pin, as returned by GET /api/workflows/[id]. */
export interface WorkflowIOEntry {
  direction: "input" | "output";
  /** Semantic bucket chosen in IO-edit mode — NOT the data type.
   *  Values: "param" | "widget" | "output" | (free-form for custom kinds). */
  kind: string;
  nodeId: string;
  name: string;
  label?: string;
  /** ComfyUI data type: STRING / INT / FLOAT / BOOLEAN / IMAGE / VIDEO / … */
  type?: string;
  defaultValue?: unknown;
  nodeTitle?: string;
  multiline?: boolean;
  /** mark a widget-backed input as REQUIRED. */
  required?: boolean;
  /** COMBO candidate list resolved from ComfyUI /object_info. */
  options?: string[];
  /** user-defined display order. */
  displayOrder?: number;
  /** author override of `defaultValue`. */
  value?: unknown;
  /** seed 类参数的「控件后行为」（fixed / increment / decrement / random），
   *  与 ComfyUI 的 control_after_generate 对应；仅 seed 类 widget 有意义。 */
  seedMode?: string;
  /** 多模式参数覆盖层。键为模式码，值为该模式下的默认值与可见性。
   *  存在 workflowIO 的 JSON 列内，因此新增模式无需改表结构。 */
  modes?: Record<string, WorkflowIOModeOverride>;
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

export type WorkflowIOMap = Record<string, WorkflowIOEntry>;

/** 该参数在指定模式下是否可见。未开启模式（mode 为空）时一律可见。
 *
 *  入参刻意只要求「带 modes 字段」这一结构子集，这样派生产物
 *  （WorkflowIOEntry & { ioKey, control } 等）也能直接传进来。 */
export function isVisibleInMode(
  entry: { modes?: Record<string, WorkflowIOModeOverride> } | undefined | null,
  mode?: string | null
): boolean {
  if (!entry || typeof entry !== "object") return true;
  if (!mode) return true;
  return entry.modes?.[mode]?.visible ?? true;
}

/** 参数默认值的两级回退：模式默认值 → 作者覆盖值(value) → 通用默认值。
 *
 *  注意顺序：模式默认值优先级最高（它就是"该模式下应该用这个"的显式声明），
 *  其次才是作者在 IO 编辑里写的通用覆盖 value，最后才是工作流图里读出的 defaultValue。 */
export function resolveEntryDefault(
  entry: WorkflowIOEntry,
  mode?: string | null
): unknown {
  if (mode) {
    const modeDefault = entry.modes?.[mode]?.defaultValue;
    if (modeDefault !== undefined) return modeDefault;
  }
  if (entry.value !== undefined) return entry.value;
  return entry.defaultValue;
}

/** 参数 required 的两级回退：模式覆盖值 → 条目级 required。
 *
 *  与 resolveEntryDefault 同语义——模式覆盖只写在 modes[mode].required，
 *  未设置该字段的模式回退到条目级（工作流库/画布等未传 mode 的消费方
 *  仍按旧行为读取 entry.required）。未开启模式（mode 为空）时只读条目级。 */
export function resolveEntryRequired(
  entry: WorkflowIOEntry | undefined | null,
  mode?: string | null
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
  mode?: string | null
): string | undefined {
  if (!entry || typeof entry !== "object") return undefined;
  if (mode) {
    const modeSeed = entry.modes?.[mode]?.seedMode;
    if (modeSeed !== undefined) return modeSeed;
  }
  return entry.seedMode;
}

/** 收集整张 IO 表里出现过的全部模式码（去重、保持稳定顺序）。 */
export function collectModeCodes(io: WorkflowIOMap | null | undefined): string[] {
  const seen = new Set<string>();
  for (const entry of Object.values(io ?? {})) {
    if (!entry || typeof entry !== "object") continue;
    for (const code of Object.keys(entry.modes ?? {})) {
      if (code) seen.add(code);
    }
  }
  return [...seen];
}
