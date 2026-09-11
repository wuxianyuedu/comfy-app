/**
 * workflowIO enrichment — extracted from workflow-detail.ts (batch 4).
 *
 * The stored selection only records WHICH pin was exposed
 * (`direction` / `kind` / `nodeId` / `name`).  `kind` is a *semantic*
 * bucket ("param" | "widget" | "output") — it is NOT the ComfyUI data
 * type, so a consumer that wants to render a control (textarea vs
 * number vs switch vs image-upload) had no way to decide.
 *
 * Rather than force every client to re-join `nodes[].raw_inputs[]` and
 * `rawNodes[].outputs[]` by (nodeId, name), we do the join once here and
 * ship a self-describing record:
 *   type          ComfyUI data type — "STRING" | "INT" | "FLOAT" |
 *                 "BOOLEAN" | "IMAGE" | "LATENT" | …  ("*" when unknown)
 *   defaultValue  current widget value (or the literal in the API graph),
 *                 so a dynamic form can pre-fill instead of showing blanks
 *   label         best display label (label > localized > name)
 *   nodeTitle     owning node's title, used to disambiguate same-named
 *                 pins across nodes ("seed" on 3 samplers)
 *   multiline     STRING inputs that ComfyUI marks as multiline-ish
 *                 (prompt-sized) → render a textarea, not a one-liner
 * Consumers: DynamicWorkflowForm (CreatePanel + canvas workflow node)
 * and the canvas auto-spawn logic (first output's `type` decides whether
 * the downstream node is an image or a video node).
 */
import { asRecord } from "@/lib/comfyui/raw";
import {
  type RawInputEntry,
  type RawNodeMeta,
} from "@/lib/comfyui/workflow-detail-raw";
import { type WorkflowIOModeOverride } from "~/lib/workflow-io-types";

const MULTILINE_HINT = /(prompt|text|caption|描述|提示)/i;

export interface WorkflowIORawEntry {
  direction: "input" | "output";
  kind: string;
  nodeId: string;
  name: string;
  label?: string;
  displayOrder?: number;
  value?: unknown;
  /** IO 编辑里切换的「运行时强校验」标记 —— GET 重建时必须透传，
   *  否则保存后重开编辑器会退回可选（历史 bug）。 */
  required?: boolean;
  /** seed 类参数的「控件后行为」（fixed/increment/decrement/random）。 */
  seedMode?: string;
  /** 多模式覆盖层（各模式的默认值与可见性），PATCH 原样落库。
   *  类型与客户端 WorkflowIOModeOverride 同源（workflow-io-types）——
   *  两端的 workflowIO 载荷经 tRPC 直传，必须逐字段兼容。 */
  modes?: Record<string, WorkflowIOModeOverride>;
}

export interface WorkflowIOEnrichParams {
  workflowIORaw: Record<string, WorkflowIORawEntry>;
  rawInputsById: Record<string, RawInputEntry[]>;
  rawNodeMeta: RawNodeMeta[];
  graph: Record<string, unknown>;
  nodeTitleById: Record<string, string>;
  nodeTypeById: Record<string, string>;
  comboOptionsForClassField: (
    classType: string | undefined,
    field: string
  ) => Promise<string[] | undefined>;
  comboOptionsForFieldName: (field: string) => Promise<string[] | undefined>;
}

/** 从 "16:9 (Widescreen)" / "16:9" 抽宽高比；抽不出返回 null。 */
function optionRatio(label: string): number | null {
  const m = /(\d+(?:\.\d+)?)\s*[:x×]\s*(\d+(?:\.\d+)?)/.exec(label);
  if (!m) return null;
  const w = Number(m[1]);
  const h = Number(m[2]);
  if (!Number.isFinite(w) || !Number.isFinite(h) || h === 0) return null;
  return w / h;
}

/**
 * 把存量作者值对齐到服务器候选表：值合法原样返回；非法则按宽高比数值
 * （"16:9" → "16:9 (Widescreen)"）→ 前缀包含就近纠正；仍匹配不上返回
 * undefined（调用方丢弃该覆盖，回退合法 defaultValue）。候选表缺失
 * （ComfyUI 离线）时不动——此时无从判定合法性，交由表单原样编辑。
 */
function reconcileOptionValue(value: unknown, options: string[] | undefined): unknown {
  if (!options || options.length === 0) return value;
  if (typeof value !== "string" || value === "" || options.includes(value)) return value;
  const ratio = optionRatio(value);
  if (ratio !== null) {
    const byRatio = options.find((option) => {
      const candidate = optionRatio(option);
      return candidate !== null && Math.abs(candidate - ratio) < 1e-6;
    });
    if (byRatio) return byRatio;
  }
  const norm = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();
  const target = norm(value);
  return options.find(
    (option) => norm(option).startsWith(target) || target.startsWith(norm(option))
  );
}

export interface WorkflowIOEntry {
  direction: "input" | "output";
  kind: string;
  nodeId: string;
  name: string;
  label?: string;
  type: string;
  defaultValue?: unknown;
  nodeTitle?: string;
  multiline?: boolean;
  /** COMBO candidate list (unet_name / clip_name / …) resolved from
   *  /api/object_info.  Absent for non-COMBO pins or when ComfyUI is
   *  unreachable — consumers fall back to a plain text control. */
  options?: string[];
  /** author override of the default value, round-tripped
   *  from the stored `workflowIORaw` so a custom default survives reload.
   *  COMBO 条目上会先经存量清洗（对齐服务器候选表）。 */
  value?: unknown;
  displayOrder?: number;
  /** IO 编辑里切换的「运行时强校验」标记 —— PATCH 原样落库，GET 透传。 */
  required?: boolean;
  /** seed 类参数的「控件后行为」（fixed/increment/decrement/random）。 */
  seedMode?: string;
  /** 多模式覆盖层（各模式的默认值与可见性）。GET 重建时经存量清洗：
   *  非法 defaultValue 对齐服务器候选表或被丢弃。类型与客户端
   *  WorkflowIOModeOverride 同源（workflow-io-types），两端的
   *  workflowIO 载荷经 tRPC 直传，必须逐字段兼容。 */
  modes?: Record<string, WorkflowIOModeOverride>;
  /** 拥有该 pin 的节点类名（如 "LoadImage" / "KSampler"）。
   *
   *  只有 pin 名（"image" / "text"）不足以判定语义：多张参考图时哪张是首帧、
   *  哪张是尾帧，靠的是产出节点型别。工坊封装（workflow-encapsulation）据它
   *  把参考图槽位区分成「首帧 / 尾帧 / 普通参考图」。rawJson + graph 都拿不到
   *  类名时（畸形导出）返回 undefined，消费方按「普通参考图」降级。 */
  classType?: string;
}

/** Enrich the stored IO selection into a self-describing record (see the
 *  module doc for field semantics).  Pure — only depends on its params. */
export async function enrichWorkflowIO(
  params: WorkflowIOEnrichParams
): Promise<Record<string, WorkflowIOEntry>> {
  const {
    workflowIORaw,
    rawInputsById,
    rawNodeMeta,
    graph,
    nodeTitleById,
    nodeTypeById,
    comboOptionsForClassField,
    comboOptionsForFieldName,
  } = params;

  const workflowIO: Record<string, WorkflowIOEntry> = {};
  for (const [ioKey, v] of Object.entries(workflowIORaw)) {
    if (!v || typeof v !== "object") continue;
    let type = "*";
    let defaultValue: unknown = undefined;
    let label = v.label;
    /* kind 与 key 直接透传存储值。存储自新格式起即正确区分
     *  widget(可编辑控件) / param(wire 端口) / output,不再做旧数据迁移。 */

    /* COMBO candidate list — resolved below once we know the final `type`. */
    let options: string[] | undefined;

    // Helper: resolve a stored `v.nodeId` against keys that may
    // be stored in EITHER of two ID families —
    //   • React Flow short ids (e.g. "9b9009e4") — what toggleIO writes
    //   • ComfyUI UUIDs (e.g. "9b9009e4-2d3d-445f-9be5-6063f465757e") — the
    //     rawJson / graph key shape
    // Without this leniency the lookup falls through to type="*" + undefined
    // defaultValue, which silently degrades every dynamic form to single-line
    // text inputs (no textarea for prompts, no switch / number / file widget),
    // because the enrichment never reaches MULTILINE_HINT or the long-string
    // fallback.  See controlForEntry() in src/components/studio/shared/workflow-io.ts.
    // Returns the CANONICAL key in whatever shape the data lives in.
    const full = String(v.nodeId);
    const canonicalNodeId = (() => {
      const metaById: Record<string, boolean> = Object.fromEntries(
        rawNodeMeta.map((meta) => [meta.id, true])
      );
      const dicts: Record<string, unknown>[] = [rawInputsById, metaById, graph];
      for (const dict of dicts) {
        if (!dict) continue;
        if (Object.prototype.hasOwnProperty.call(dict, full)) return full;
      }
      /* Fallback: match `9b9009e4` against `9b9009e4-2d3d-…`.  Requires a
       * word-boundary char (`-`) right after the prefix so `9b9009e4` never
       * collides with `9b9009e44`. */
      for (const dict of dicts) {
        if (!dict) continue;
        const hit = Object.keys(dict).find((key) => key.length > full.length && key.startsWith(full) && key.charAt(full.length) === "-");
        if (hit) return hit;
      }
      return full;
    })();

    if (v.direction === "output") {
      const meta = rawNodeMeta.find((rawNodeMeta) => rawNodeMeta.id === canonicalNodeId);
      const out = meta?.outputs.find((output) => output.name === v.name);
      if (out) {
        type = out.type || "*";
        label = label ?? out.label ?? out.localized ?? out.name;
      }
    } else {
      /* 先按槽位名精确匹配；封装节点上匹配不到时（勾选点在子图内层视图
       *  按下的是内部字段名，而 wrapper 这一层只有别名槽位），退回按
       *  proxyField.field 匹配同一个暴露口。顺序不能反：一个 wrapper 上
       *  可能有多个别名槽位指向同一内部字段名，精确匹配才是第一语义。 */
      const inputEntries = rawInputsById[canonicalNodeId] ?? [];
      const ri =
        inputEntries.find((raw) => raw.name === v.name) ??
        inputEntries.find((raw) => raw.proxyField?.field === v.name);
      if (ri) {
        type = ri.type || "*";
        /* 子工作流封装节点（class_type 是 UUID）的暴露口要特殊处理：
         *  wrapper 本层槽位名是 ComfyUI 为 proxyWidgets 自动编号的别名
         *  （`value_1`），业务语义在内部节点上。按 `name` 回查只会拿到别名，
         *  标签于是退化成 `value_1`——与画布上作者认得的业务名（`seed`）
         *  对不上（ISSUE #349）。内部真实字段（proxyField，由 proxyWidgets
         *  解析）在该别名之前取值，别名只在内部信息全无时兜底。
         *
         *  非封装节点没有 proxyField，行为与旧版逐值等价：作者 label →
         *  localized → pin 名。 */
        const f = ri.proxyField;
        /* 存量数据：勾选那一刻会把「画布显示名」写进 label。修复前封装节点
         *  的显示名就是别名（value_1），库存 label 里于是躺着一串机器生成的
         *  名字，它并不是作者的命名，不该把内部字段的业务名压掉。只在封装
         *  节点（有 proxyField）且 label 恰好等于别名槽位名时视为未命名——
         *  作者手写的名字几乎不可能与机器别名逐字相同，因此不会误伤；普通
         *  节点没有这一分支，行为与旧版逐值等价。 */
        const staleAlias = f !== undefined && label !== undefined && label === ri.name;
        label =
          (staleAlias ? undefined : label) ??
          f?.label ??
          f?.localized ??
          ri.label ??
          ri.localized ??
          f?.field ??
          ri.name;
        if (ri.widgetValue !== undefined) defaultValue = ri.widgetValue;
      }
      /* API-only imports carry no rawJson → rawInputsById is empty.  Fall
       * back to the literal sitting in the API graph and infer the type
       * from its JS runtime type (good enough to pick a control). */
      if (defaultValue === undefined) {
        const gv = asRecord(asRecord(graph[canonicalNodeId])?.inputs)?.[v.name];
        if (gv !== undefined && !Array.isArray(gv)) defaultValue = gv;
      }
      if (type === "*" && defaultValue !== undefined) {
        if (typeof defaultValue === "boolean") type = "BOOLEAN";
        else if (typeof defaultValue === "number")
          type = Number.isInteger(defaultValue) ? "INT" : "FLOAT";
        else if (typeof defaultValue === "string") type = "STRING";
      }
      /* COMBO candidate list: a wrapper COMBO already carries `comboOptions`
       *  from the pass; a direct (non-wrapper) COMBO node resolves via
       *  its class type.  ComfyUI unreachable → options stays undefined → the
       *  form falls back to a plain text control. */
      if (type === "COMBO") {
        if (ri?.comboOptions) {
          options = ri.comboOptions;
        } else {
          const byClass = await comboOptionsForClassField(nodeTypeById[canonicalNodeId], v.name);
          /* wrapper nodes (esp. `comfy-core` subgraphs whose
           *  `properties.proxyWidgets` is absent/quarantined) can't resolve the
           *  internal class, so the class lookup above returns nothing.  Fall
           *  back to a field-name scan across object_info to recover the option
           *  list for uniquely-named COMBOs (e.g. `resolution_preset`). */
          options = byClass ?? (await comboOptionsForFieldName(v.name));
        }
      }
    }



    /* 存量清洗：作者覆盖值 / 模式默认值可能是在候选表缺失或过期时写入的
     *  （如简写 "16:9"），不在服务器候选表里——照原样展示，用户再怎么选
     *  提交的仍是脏值。这里在 GET 重建时就地对齐（见 reconcileOptionValue），
     *  保证 UI 显示与提交的候选值与服务器一致。不回写入参（可能被共享），
     *  清洗只作用于本次响应；用户保存后 PATCH 自然落库清洗结果。 */
    const cleanedValue = reconcileOptionValue(v.value, options);
    let cleanedModes: Record<string, WorkflowIOModeOverride> | undefined;
    if (v.modes != null && typeof v.modes === "object" && options && options.length > 0) {
      let touched = false;
      const next: Record<string, WorkflowIOModeOverride> = {};
      for (const [mode, override] of Object.entries(v.modes)) {
        if (override == null || typeof override !== "object") {
          /* 畸形覆盖（PATCH 原样落库可能带 null/标量）：原样透传不清洗。 */
          next[mode] = override ?? {};
          continue;
        }
        const ov: WorkflowIOModeOverride = { ...override };
        if (ov.defaultValue === undefined) {
          next[mode] = ov;
          continue;
        }
        const fixed = reconcileOptionValue(ov.defaultValue, options);
        if (fixed === ov.defaultValue) {
          next[mode] = ov;
          continue;
        }
        touched = true;
        if (fixed === undefined) {
          delete ov.defaultValue;
          if (Object.keys(ov).length > 0) next[mode] = ov;
          continue;
        }
        next[mode] = { ...ov, defaultValue: fixed };
      }
      if (touched) cleanedModes = next;
    }

    /* 节点类名：raw 导出优先（它才是 ComfyUI 里真实的 class），
     *  API-only 导入退到存库 graph 的 class_type。两者都没有就不下发。 */
    const graphClassType = asRecord(graph[canonicalNodeId])?.class_type;
    /* raw 导出的类名是空串时也算「没有」—— 不能让它把 graph 里的真类名吃掉。 */
    const rawClassType = nodeTypeById[canonicalNodeId];
    const classType =
      rawClassType !== undefined && rawClassType !== ""
        ? rawClassType
        : typeof graphClassType === "string" && graphClassType !== ""
          ? graphClassType
          : undefined;

    workflowIO[ioKey] = {
      direction: v.direction,
      kind: v.kind,
      nodeId: String(v.nodeId),
      name: v.name,
      label: label ?? v.name,
      type,
      ...(defaultValue !== undefined ? { defaultValue } : {}),
      ...(options ? { options } : {}),
      ...(classType !== undefined ? { classType } : {}),
      nodeTitle: nodeTitleById[canonicalNodeId] ?? nodeTitleById[String(v.nodeId)],
      ...(type === "STRING" &&
      (MULTILINE_HINT.test(v.name) ||
        MULTILINE_HINT.test(String(label ?? "")) ||
        (typeof defaultValue === "string" && defaultValue.length > 40))
        ? { multiline: true }
        : {}),
      /* pass the user-defined displayOrder
       *  through.  It was authored on a previous session via the IO-edit
       *  preview's drag-to-reorder gesture, persisted via PATCH, and now
       *  read back here so consumers can sort by it.  Coerce to number
       *  (PATCH might serialize a string for whatever reason) and only
       *  forward finite integers so a corrupted value can't poison the
       *  sort comparator downstream. */
      ...(typeof v.displayOrder === "number" && Number.isFinite(v.displayOrder)
        ? { displayOrder: v.displayOrder }
        : {}),
      /* preserve any author override of the default value.
       *  `value` is stored verbatim via PATCH (the whole workflowIO object is
       *  persisted as-is) and must survive this GET rebuild so a custom
       *  default isn't silently dropped on reload.  清洗结果见上方存量清洗：
       *  非法值被就地纠正；匹配不上时 cleanedValue 为 undefined → 不输出
       *  value，条目回退到图内合法 defaultValue。 */
      ...(v.value !== undefined ? { value: cleanedValue } : {}),
      /* required / seedMode / modes 同 value 一样是作者编辑态（PATCH 原样
       *  落库），GET 重建必须原样透传 —— 此前 required 被丢掉，导致
       *  「改成必填 → 保存 → 重开又变回可选」。modes 走存量清洗。 */
      ...(v.required !== undefined ? { required: v.required } : {}),
      ...(v.seedMode !== undefined ? { seedMode: v.seedMode } : {}),
      ...(v.modes !== undefined ? { modes: cleanedModes ?? v.modes } : {}),
    };
  }

  return workflowIO;
}
