/**
 * workflowIO 信息补全 —— 从 workflow-detail.ts 拆出。
 *
 * 存档里只记了「暴露的是哪一个引脚」（`direction` / `kind` / `nodeId` / `name`）。
 * `kind` 是一个**语义**分桶（"param" | "widget" | "output"），**不是** ComfyUI 的
 * 数据类型 —— 因此想渲染控件的消费方（文本域还是数字框、开关还是图片上传）
 * 无从判断该用哪个。
 *
 * 与其让每个消费方各自按 (nodeId, name) 去 join `nodes[].raw_inputs[]` 与
 * `rawNodes[].outputs[]`，不如在这里 join 一次，发出一条自描述记录：
 *
 *   类型（type）           ComfyUI 数据类型 —— "STRING" | "INT" | "FLOAT" |
 *                        "BOOLEAN" | "IMAGE" | "LATENT" …（未知时是 "*"）
 *   默认值（defaultValue） 当前控件值（或 API 图里的字面量），
 *                        动态表单据此预填，而不是显示空白
 *   标签（label）          最佳展示标签（优先级：label > localized > name）
 *   节点标题（nodeTitle）  所属节点的标题，用来区分不同节点上的同名引脚
 *                        （三个采样器上都有 "seed" 的情况）
 *   多行（multiline）      ComfyUI 标为「多行倾向」（提示词量级）的 STRING 输入
 *                        → 渲染文本域，而不是单行输入
 *
 * 消费方：DynamicWorkflowForm（创建面板 + 画布工作流节点），以及画布的自动
 * 派生逻辑（第一个输出的 `type` 决定下游节点是图片节点还是视频节点）。
 */
import { asRecord } from "~/lib/comfyui/raw";
import { inferIsMultiline } from "~/lib/comfyui/types";
import {
  type RawInputEntry,
  type RawNodeMeta,
} from "~/lib/comfyui/workflow-detail-raw";
import { type WorkflowIOModeOverride } from "~/lib/workflow/workflow-io-types";

export interface WorkflowIORawEntry {
  direction: "input" | "output";
  kind: string;
  nodeId: string;
  name: string;
  label?: string;
  displayOrder?: number;
  /** 宿主（外层封装）节点 id —— 勾选点在子工作流内部时写入，与 `nodeId`
   *  （内部节点 id）一起在运行期拼成 comfy-cli 展开后的 `host:inner` 形式。
   *  顶层勾选的条目没有本字段，PATCH / GET 原样往返。 */
  hostNodeId?: string;
  /** IO 编辑里切换的「运行时强校验」标记 —— GET 重建时必须透传，
   *  否则保存后重开编辑器会退回可选（历史 bug）。 */
  required?: boolean;
  /** seed 类参数的「控件后行为」（fixed/increment/decrement/random）。 */
  seedMode?: string;
  /** 多模式覆盖层（各模式的默认值与可见性），PATCH 原样落库。
   *  类型与客户端 WorkflowIOModeOverride 同源（workflow-io-types）——
   *  两端的 workflowIO 载荷经 tRPC 直传，必须逐字段兼容。键名 `modeOverrides`
   *  与 `WorkflowTemplate.modes`（工作流级模式清单）区分；旧数据仍是 `modes`
   *  键，读取处统一回退归一。 */
  modeOverrides?: Record<string, WorkflowIOModeOverride>;
  /** 富化后的 ComfyUI 类型（`INT` / `FLOAT` / `STRING` / `COMBO` …）。
   *  勾选时通常没有，由 GET 的 `enrichWorkflowIO` 现算；但若保存时已被富化
   *  （router 的 `persistEnrichedWorkflowIO` 或 client 持久化的富化 map 带真值），
   *  这里留底，`enrichWorkflowIO` 把它当兜底基线 —— 见 fix 4：类型固化，
   *  不再每次 GET 都依赖 object_info 重算，ComfyUI 离线重开也不退化成纯文本。 */
  type?: string;
  /** 富化出来的控件默认值（图内 widget 当前值）。同 type，可作兜底基线。 */
  defaultValue?: unknown;
  /** COMBO 候选列表（来自 object_info）。离线保存时可能缺失，留空由表单回落文本。 */
  options?: string[];
}

export interface WorkflowIOEnrichParams {
  workflowIORaw: Record<string, WorkflowIORawEntry>;
  rawInputsById: Record<string, RawInputEntry[]>;
  /** 子工作流内部节点的输入元数据（`buildInnerNodeInputs`）。
   *  勾选点落在子图内层视图时，落库 `nodeId` 指向内部节点，顶层 `rawInputsById`
   *  里没有它 —— 没有这份兜底表，类型退化成 `*`、显示名退化成 pin 名
   *  （ISSUE #349）。缺省（API-only / 无子图）时行为与旧版逐值等价。 */
  innerInputsById?: Record<string, RawInputEntry[]>;
  rawNodeMeta: RawNodeMeta[];
  graph: Record<string, unknown>;
  nodeTitleById: Record<string, string>;
  nodeTypeById: Record<string, string>;
  comboOptionsForClassField: (
    classType: string | undefined,
    field: string,
  ) => Promise<string[] | undefined>;
  comboOptionsForFieldName: (field: string) => Promise<string[] | undefined>;
  /** 某 class 某字段是否声明了 `{"multiline": true}`（object_info 的类型事实）。
   *  查不到返回 `undefined` —— 判定退到「值很长」这条数据判据，不猜名字。 */
  multilineForClassField: (
    classType: string | undefined,
    field: string,
  ) => Promise<boolean | undefined>;
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
 * 把存量模式默认值对齐到服务器候选表：值合法原样返回；非法则按宽高比数值
 * （"16:9" → "16:9 (Widescreen)"）→ 前缀包含就近纠正；仍匹配不上返回
 * undefined（调用方摘掉该覆盖，回退合法 defaultValue）。候选表缺失
 * （ComfyUI 离线）时不动——此时无从判定合法性，交由表单原样编辑。
 */
function reconcileOptionValue(
  value: unknown,
  options: string[] | undefined,
): unknown {
  if (!options || options.length === 0) return value;
  if (typeof value !== "string" || value === "" || options.includes(value))
    return value;
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
    (option) =>
      norm(option).startsWith(target) || target.startsWith(norm(option)),
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
  /** COMBO 候选项列表（unet_name / clip_name …），由 /api/object_info 解析得到。
   *  非 COMBO 引脚、或 ComfyUI 连不上时为空 —— 消费方回落到纯文本控件。 */
  options?: string[];
  displayOrder?: number;
  /** IO 编辑里切换的「运行时强校验」标记 —— PATCH 原样落库，GET 透传。 */
  required?: boolean;
  /** seed 类参数的「控件后行为」（fixed/increment/decrement/random）。 */
  seedMode?: string;
  /** 多模式覆盖层（各模式的默认值与可见性）。GET 重建时经存量清洗：
   *  非法 defaultValue 对齐服务器候选表或被丢弃。类型与客户端
   *  WorkflowIOModeOverride 同源（workflow-io-types），两端的
   *  workflowIO 载荷经 tRPC 直传，必须逐字段兼容。键名 `modeOverrides`
   *  与 `WorkflowTemplate.modes`（工作流级模式清单）区分。 */
  modeOverrides?: Record<string, WorkflowIOModeOverride>;
  /** 宿主（外层封装）节点 id —— 勾选点在子工作流内部时写入，运行期据它把
   *  `nodeId`（内部节点）还原成 comfy-cli 展开后的 `host:inner` 拼接 id。 */
  hostNodeId?: string;
  /** 本层槽位上**作者写的**业务名（`label`，且与槽位名不同才有值）。
   *
   *  随条目下发的**事实字段**：富化链把它排在 `localized` 之后（通用翻译会
   *  盖住它），所以显示名算不到它；但消费方想要「作者在本层槽位上写的名字」
   *  时，只有这里有。 */
  slotLabel?: string;
}
/** 保存 IO 映射时把类型 / 默认值**固化**进库（fix 4 的根治）。
 *
 *  离线可用：只用 API graph 的字面量，不查 object_info。图里某个 widget 的当前
 *  值（number / boolean / 字符串）足以推断它的数值类型；字符串值无法区分 STRING 与
 *  COMBO，留给 GET 富化的候选查询 / 名字启发式，这里不替它下结论。已带
 *  type / defaultValue 的条目（client 持久化的富化 map）原样保留，绝不覆盖。
 *  COMBO 候选只能来自 object_info，离线时填不了 —— 留空由表单回落文本控件
 *  （无害：空串会被运行 payload 过滤掉）。
 *
 *  这一步让「ComfyUI 离线保存 IO」的条目下次打开时仍带真类型，不再退化成纯文本、
 *  也不再由名字猜测（猜测只在真·无元数据时兜底）。 */
export function persistEnrichedWorkflowIO(
  graph: Record<string, unknown> | undefined | null,
  workflowIO: Record<string, WorkflowIORawEntry>,
): Record<string, WorkflowIORawEntry> {
  const out: Record<string, WorkflowIORawEntry> = {};
  for (const [ioKey, v] of Object.entries(workflowIO)) {
    if (!v || typeof v !== "object") continue;
    const next: WorkflowIORawEntry = { ...v };
    const node = asRecord(graph?.[String(v.nodeId)]);
    const gv = node ? asRecord(node.inputs)?.[v.name] : undefined;
    const isScalar =
      typeof gv === "number" ||
      typeof gv === "boolean" ||
      (typeof gv === "string" && gv.length > 0);
    if (isScalar) {
      if (next.defaultValue === undefined) next.defaultValue = gv;
      /* 数值 / 布尔类型无歧义，直接定；字符串可能是 STRING 也可能是 COMBO，
       * 不在这里猜，交给 GET 富化。 */
      const declared = (v.type ?? "").trim().toUpperCase();
      if (declared === "" || declared === "*") {
        if (typeof gv === "number")
          next.type = Number.isInteger(gv) ? "INT" : "FLOAT";
        else if (typeof gv === "boolean") next.type = "BOOLEAN";
      }
    }
    out[ioKey] = next;
  }
  return out;
}

/** 把存档里的 IO 选择补全成自描述记录（字段语义见模块头注）。
 *  纯函数 —— 只依赖入参。 */
export async function enrichWorkflowIO(
  params: WorkflowIOEnrichParams,
): Promise<Record<string, WorkflowIOEntry>> {
  const {
    workflowIORaw,
    rawInputsById,
    innerInputsById,
    rawNodeMeta,
    graph,
    nodeTitleById,
    nodeTypeById,
    comboOptionsForClassField,
    comboOptionsForFieldName,
    multilineForClassField,
  } = params;

  const workflowIO: Record<string, WorkflowIOEntry> = {};

  for (const [ioKey, v] of Object.entries(workflowIORaw)) {
    if (!v || typeof v !== "object") continue;
    // 以存档里的**事实字段**为起点：之前保存时定下来的 type / options，离线
    // 重开时仍能保住正确控件 —— 这是「保存 IO 映射时 ComfyUI 离线」那条回归的根治
    // 方向（把类型 / 候选也随富化后的 map 一起固化下来，而非每次 GET 都依赖
    // object_info 重算）。rawJson 能解析出来时下面会覆盖这里的起点；都失败才回落到
    // 存档值（client 持久化了富化后的 map，所以在线保存过的条目带真值）。
    // defaultValue 不走「存档起点」：graph 里的当前字面量比存档值更新，故优先用
    // graph，仅当 graph 也取不到时才用存档默认值（见下方）。
    const storedType = (v.type ?? "").trim().toUpperCase();
    let type: string = storedType === "" ? "*" : storedType;
    let defaultValue: unknown = undefined;
    let label = v.label;
    /* 本层槽位上的作者业务名（判定机器别名的第二判据），见 WorkflowIOEntry。 */
    let slotLabel: string | undefined;
    /* kind 与 key 直接透传存储值。存储自新格式起即正确区分
     *  widget(可编辑控件) / param(wire 端口) / output,不再做旧数据迁移。 */
    /* COMBO 候选项列表 —— 下面确定了最终的 `type` 之后再解析。 */
    let options: string[] | undefined;

    // 助手：把存档里的 `v.nodeId` 与「两套 id 家族」中任一种形态的键对上 ——
    //   • React Flow 的短 id（例如 "9b9009e4"）—— 这是 toggleIO 写入的形态；
    //   • ComfyUI 的 UUID（例如 "9b9009e4-2d3d-445f-9be5-6063f465757e"）——
    //     这是 rawJson / graph 的键形态。
    // 没有这份宽容，查询会落到 type="*" 与 undefined 的默认值上，
    // 于是每个动态表单都被悄悄降级成单行文本输入（提示词没有文本域、
    // 也没有开关 / 数字 / 文件控件）—— 因为补全逻辑从没走到「声明的多行」查询
    // 与「长字符串」兜底。相关判据见 src/components/studio/shared/workflow-io.ts
    // 里的 controlForEntry()。
    // 返回值是**规范键**：数据以哪种形态存在，就返回哪种形态的键。
    const full = String(v.nodeId);
    const canonicalNodeId = (() => {
      const metaById: Record<string, boolean> = Object.fromEntries(
        rawNodeMeta.map((meta) => [meta.id, true]),
      );
      const dicts: Record<string, unknown>[] = [rawInputsById, metaById, graph];
      for (const dict of dicts) {
        if (!dict) continue;
        if (Object.prototype.hasOwnProperty.call(dict, full)) return full;
      }
      /* 兜底：把 `9b9009e4` 与 `9b9009e4-2d3d-…` 对上。要求前缀之后紧跟
       * 一个词边界字符（`-`），这样 `9b9009e4` 永远不会
       * 因此不会与 `9b9009e44` 相撞。 */
      for (const dict of dicts) {
        if (!dict) continue;
        const hit = Object.keys(dict).find(
          (key) =>
            key.length > full.length &&
            key.startsWith(full) &&
            key.charAt(full.length) === "-",
        );
        if (hit) return hit;
      }
      return full;
    })();

    if (v.direction === "output") {
      const meta = rawNodeMeta.find(
        (rawNodeMeta) => rawNodeMeta.id === canonicalNodeId,
      );
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
        /* 键漂移：修复前某些路径把**画布上的显示名**写进了 `name`，于是存下来的
         *  条目变成 `4::widget::1` / `4::widget::Seed` —— 它既不是 ComfyUI 的槽位
         *  名，也不在包装层槽位表里，按名字回查必然落空，类型退化成 `*`、显示名
         *  退化成那串脏值（ISSUE #349 的「名字变成 1」）。
         *
         *  判据收敛成「同一节点上恰好只有一个暴露槽位与这个脏名字同名」才认：
         *  多插槽节点（KSampler 的 seed / steps / cfg…）绝不会被误认，宁可这一条
         *  少一个名字，也不把别的槽位的 label 安到它头上。
         *
         *  比对时把作者业务名也纳入（`proxyField.label` / 本层 `label`）——
         *  漂移进去的常常正是勾选那一刻的画布显示名（= 作者业务名）。 */
        inputEntries.find((raw) => {
          if (!raw.widget) return false;
          /* 候选名字集合：真实槽位名 + 内部字段名 + 本层作者名 + 内部作者名。
           *  「恰好只有一个暴露槽位认领这个名字」才认 —— 多插槽节点上同名者
           *  不止一行时宁可放过，也不把别的槽位的 label 安到这一行。 */
          const names = [
            raw.name,
            raw.proxyField?.field,
            raw.label,
            raw.proxyField?.label,
          ];
          if (!names.includes(v.name)) return false;
          return (
            inputEntries.filter((other) => {
              if (!other.widget) return false;
              return [
                other.name,
                other.proxyField?.field,
                other.label,
                other.proxyField?.label,
              ].includes(v.name);
            }).length === 1
          );
        }) ??
        inputEntries.find((raw) => raw.proxyField?.field === v.name) ??
        /* 勾选点落在子图内层视图（下钻后的画布）时，落库 nodeId 是内部节点，
         *  顶层 rawInputsById 里没有它 —— 退回子图内部节点的索引，否则类型
         *  退化成 `*`、显示名退化成 pin 名（ISSUE #349）。 */
        innerInputsById?.[canonicalNodeId]?.find((raw) => raw.name === v.name);
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
        /* 本层作者名（随条目下发的**事实字段**，见 WorkflowIOEntry.slotLabel）：
         *  只在真能解析到**非别名**的业务名时才算数 —— 内部字段名（proxyField）
         *  也足以说明业务语义，故按 f.label → f.localized → ri.label → f.field
         *  取第一个不同于槽位名的值。刻意不用 `localized`：那是 ComfyUI 的通用
         *  翻译（`seed` → "随机种"），拿它去压作者手写的名字会误伤。 */
        const authorSlotLabel =
          ri.label !== undefined && ri.label !== ri.name ? ri.label : undefined;
        const candidateSlotLabel =
          f?.label ??
          (f?.localized !== ri.name ? f?.localized : undefined) ??
          authorSlotLabel ??
          (f?.field !== ri.name ? f?.field : undefined);
        if (
          candidateSlotLabel !== undefined &&
          candidateSlotLabel !== ri.name
        ) {
          slotLabel = candidateSlotLabel;
        }

        /* 库里存着的 label 就是作者的显式重命名（勾选不再抄画布的名字进库，
         *  唯一写入点是面板的改名框）—— 直读，不做任何「像不像机器名」的让位
         *  判断。作者想在面板里覆盖本层 raw label，写进去的就是它。 */
        label =
          label ??
          f?.label ??
          f?.localized ??
          ri.label ??
          ri.localized ??
          f?.field ??
          ri.name;
        if (ri.widgetValue !== undefined) defaultValue = ri.widgetValue;
      }
      /* 只导 API 格式时没有 rawJson → rawInputsById 是空的。
       * 此时回落到 API 图里那个字面量，并按它的 JS 运行时类型推断类型
       * （足够用来挑一个控件）。 */
      if (defaultValue === undefined) {
        const gv = asRecord(asRecord(graph[canonicalNodeId])?.inputs)?.[v.name];
        if (gv !== undefined && !Array.isArray(gv)) defaultValue = gv;
      }
      /* 连 graph 也取不到（纯 API 格式导入且图里没有该字面量）时，回落到存档里
       * 上一次在线保存过的默认值 —— 让「ComfyUI 离线时保存」的条目重新打开时仍
       * 能带值，而不是退化成空串 / 未填（fix 4：默认值也固化下来）。 */
      if (defaultValue === undefined && v.defaultValue !== undefined)
        defaultValue = v.defaultValue;
      if (type === "*" && defaultValue !== undefined) {
        if (typeof defaultValue === "boolean") type = "BOOLEAN";
        else if (typeof defaultValue === "number")
          type = Number.isInteger(defaultValue) ? "INT" : "FLOAT";
        else if (typeof defaultValue === "string") type = "STRING";
      }
      /* COMBO 候选项列表：wrapper 形态的 COMBO 已经在这一趟里带上了 `comboOptions`；
       *  非 wrapper 的直连 COMBO 节点则按它的类型解析。
       *  ComfyUI 连不上 → options 保持 undefined →
       *  表单回落到纯文本控件。 */
      if (type === "COMBO") {
        if (ri?.comboOptions) {
          options = ri.comboOptions;
        } else {
          const byClass = await comboOptionsForClassField(
            nodeTypeById[canonicalNodeId],
            v.name,
          );
          /* wrapper 节点（尤其是那些 `properties.proxyWidgets` 缺失或被隔离的
           *  `comfy-core` 子图）解析不出内部类型，导致上面的按类型查表什么也拿不到。
           *  此时回落到跨 object_info 的字段名扫描，
           *  为「名字唯一」的 COMBO 找回候选项
           *  （例如 `resolution_preset`）。 */
          options = byClass ?? (await comboOptionsForFieldName(v.name));
        }
        /* ComfyUI 不可达时 object_info 查不到候选；若存档里上一次在线时存过
         * options（client 持久化了富化后的 map），直接复用，避免 COMBO 退化成
         * 纯文本（fix 4：候选也固化下来）。 */
        if (!options && Array.isArray(v.options)) options = v.options;
      }
    }

    /* 存量清洗：模式默认值可能是在候选表缺失或过期时写入的（如简写 "16:9"），
     *  不在服务器候选表里——照原样展示，用户再怎么选提交的仍是脏值。这里在 GET
     *  重建时就地对齐（见 reconcileOptionValue），保证 UI 显示与提交的候选值与
     *  服务器一致。不回写入参（可能被共享），清洗只作用于本次响应；用户保存后
     *  PATCH 自然落库清洗结果。
     *  源键优先读 `modeOverrides`，旧数据仍是 `modes` 键时回退归一（避免旧工作流
     *  的模式覆盖层在改名后整片丢失）。 */
    const legacyModes = (v as unknown as Record<string, unknown>).modes;
    const modeOverridesSource =
      v.modeOverrides ??
      (legacyModes as Record<string, WorkflowIOModeOverride> | undefined);
    let cleanedModes: Record<string, WorkflowIOModeOverride> | undefined;
    if (
      modeOverridesSource != null &&
      typeof modeOverridesSource === "object" &&
      options &&
      options.length > 0
    ) {
      let touched = false;
      const next: Record<string, WorkflowIOModeOverride> = {};
      for (const [mode, override] of Object.entries(modeOverridesSource)) {
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

    /* 节点类名（**只在本层内部用**：它是查 `multiline` 声明的键 —— 随条目下发的
     *  那份已随工坊封装的名字启发式一起删除）：raw 导出优先（它才是 ComfyUI 里
     *  真实的 class），API-only 导入退到存库 graph 的 class_type。 */
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
      nodeTitle:
        nodeTitleById[canonicalNodeId] ?? nodeTitleById[String(v.nodeId)],
      /* 多行 = 节点自己声明的 `("STRING", {"multiline": true})`（查 object_info），
       *  查不到时只剩「值很长」这条数据判据 —— 不再按字段名/显示名猜：
       *  `prompt_width_of_thing` 这类单行输入不会被升级成 textarea，作者改过名的
       *  提示词框也不会因为名字里没「prompt」而掉回单行。 */
      ...(type === "STRING" &&
      inferIsMultiline(
        await multilineForClassField(classType, v.name),
        defaultValue,
      )
        ? { multiline: true }
        : {}),
      /* 把用户自定义的 displayOrder 透传出去。它是用户在之前的会话里通过
       *  IO 编辑预览的「拖拽排序」手势写下的、经 PATCH 落库，现在在这里读回来，
       *  让消费方能按它排序。这里强转成数字
       *  （PATCH 有可能出于各种原因序列化成字符串），
       *  且只向下游传有限整数，
       *  避免一个损坏的值毒害下游的排序比较器。
       *  见 rawInputsById 的消费方。 */
      ...(typeof v.displayOrder === "number" && Number.isFinite(v.displayOrder)
        ? { displayOrder: v.displayOrder }
        : {}),
      /* 历史 `value`（旧「通用页签」写的全局覆盖）**读到即丢**：该概念已随通用
       *  页签删除，这里不再透传 —— 下一次 PATCH 把残留一并清掉（整个 workflowIO
       *  对象原样落库）。 */
      /* required / seedMode / modeOverrides 同 value 一样是作者编辑态（PATCH 原样
       *  落库），GET 重建必须原样透传 —— 此前 required 被丢掉，导致
       *  「改成必填 → 保存 → 重开又变回可选」。modeOverrides 走存量清洗，且旧
       *  数据 `modes` 键已在上文归一进 `modeOverridesSource`。 */
      ...(v.required !== undefined ? { required: v.required } : {}),
      ...(v.seedMode !== undefined ? { seedMode: v.seedMode } : {}),
      ...(modeOverridesSource !== undefined
        ? { modeOverrides: cleanedModes ?? modeOverridesSource }
        : {}),
      /* 宿主（外层封装）节点 id 纯透传 —— 它只在「下钻到子图内部」勾选时写入，
       *  运行期靠它把内部节点 id 还原成 comfy-cli 展开后的 `host:inner`。 */
      ...(v.hostNodeId !== undefined ? { hostNodeId: v.hostNodeId } : {}),
      /* 本层作者名：只在真的与槽位名不同时下发，避免给「label 就是 pin 名」
       *  的普通节点塞一份无信息量的副本。 */
      ...(slotLabel !== undefined ? { slotLabel } : {}),
    };
  }

  return workflowIO;
}
