// 工作流库「画布节点」的对外参数**归属派生**（纯配置 + 纯函数，规范 §17.2 第①层）。
//
// 库详情过去只渲染「一张宿主运行卡片」：对外参数在画布上完全看不到 —— 作者在
// 编辑器里勾出来的「提示词 = CLIPTextEncode 的这一行」这件事，库里无从判断。
// 本文件把这份归属关系派生成两层，供视图分别落在两处：
//
//   ① 卡片列：每个对外参数一张卡片（它由哪些端口组成）；
//   ② 行徽标：宿主卡片里「被落到的那一行参数」标出它属于哪个对外参数。
//
// 两处表达的是同一份事实的两端（卡片说「我由哪些端口组成」，徽标说「这一行属于
// 谁」），所以**同一句话只在一处出现**：哪个端口是落点在卡片上标名字（端口的
// 自有属性），而「这一行属于哪个对外参数」只在表单行尾标一次 —— 卡片与单行不
// 重复表达同一个落点。
//
// 数据源与编辑器同一份：`workflowIO` 聚类出条目，`paramMap.source.mode:<模式>`
// 给出当前模式生效的落点（输出侧对应 `paramMap.output.mode:<模式>`）。两处的
// 连线在库里都能改（ISSUE #355）：左列拖圆点改落点，右列拖圆点改输出从哪一行
// 取值 —— 手势由视图层上抛，本文件只做纯派生。

import {
  buildParamEntries,
  parseParamMapping,
  resolveMapping,
  wiredTargetsForEntry,
  type ParamEntry,
} from "~/lib/workflow/workflow-param-mapping";
import {
  splitWorkflowIO,
  type WorkflowIOEntry,
  type WorkflowIOMap,
} from "~/components/studio/shared/workflow-io";
import {
  defaultOutputSource,
  hasManualOutputBinding,
  manualOutputSource,
  resolveOutputSource,
} from "~/lib/workflow/workflow-output-binding";

export interface LibraryParamCards {
  /** 对外参数条目（稳定顺序）。 */
  entries: ParamEntry[];
  /** 派生用的 IO 表（卡片列渲染端口类型读它）。 */
  io: WorkflowIOMap | null;
  /** 该对外参数在当前模式下是否被作者改过（决定卡片头 ↺ 的可用性）。 */
  isManual: (entryId: string) => boolean;
  /** 当前模式下「条目 → 目标 ioKey」的生效落点（**只来自作者画的线**）。 */
  resolved: Record<string, string | null>;
  /** 每个被落到的一行（ioKey）→ 落到它的对外参数名，按条目顺序取第一个。
   *  宿主卡片的参数行据此在行尾标出「这一行属于哪个对外参数」。 */
  ownersByPin: Record<string, string>;
  /** 卡片圆点端点 → 宿主行 的只读连线（卡片列右侧的小圆点与宿主卡片上被落
   *  到的那一行之间）。连线一律是作者画的那条（库里不给「猜出来的」线），
   *  与编辑器画布同一套语义 —— 库里不画线的话，圆点就只是一颗装饰点，
   *  读者答不出它连到哪。 */
  wires: ParamCardWire[];
  /** **真的画出了线**的那些卡片圆点（`<条目 id>?<handle id>`）。
   *
   *  与 `wires` 同一份事实的另一面：视图据此判断「这颗圆点该不该画成已连接」
   *  —— 库内每个候选各画一条线，若还按「生效落点那一颗才实心、其余淡一档」
   *  上色，带线的圆点看着反而是断的（用户口径：「这里连线断开了是什么原因」，
   *  ISSUE #355）。 */
  wiredDotKeys: Set<string>;
  /** 对外**输出**参数在当前模式下的落点（输出口 ioKey → 取值的那一行 ioKey）。
   *  卡片与连线都要读这一份：与 `resolved` 对输入侧的作用对称。 */
  outputResolved?: Record<string, string | null>;
}

/** 库内一条只读映射连线。 */
export interface ParamCardWire {
  entryId: string;
  targetIoKey: string;
  /** 线的两端在哪一侧（见 `WorkflowParamWires` 的 `ParamWireKind`）：
   *  缺省 = 输入侧（卡片 → 宿主参数行），`"hostToParam"` = 输出侧
   *  （宿主输出行 → 对外输出参数卡片）。 */
  kind?: "paramToHost" | "hostToParam";
  /** 被连的**输出端口 handle id** —— 一个对外参数可能有多颗圆点（每个候选
   *  一颗），线必须从被落到的那一颗出发。 */
  handleId: string;
  /** 被连的端口落在**组合控件**上（宽/高、比例/像素这类没有独立行的端口），
   *  端点锚在整块控件上，线指向那一格。 */
  grouped: boolean;
}

/** 从 workflowIO + paramMap 派生库内画布所需的归属数据。
 *
 *  模式取工作流的 defaultMode —— 与编辑器同一份口径：只有归属某个模式的落点
 *  才成立（`source.mode:<模式>`）。没有模式时不承认任何线 —— 落点全空，
 *  卡片如实显示成「未配置」。 */
export function deriveLibraryParamCards(args: {
  io: WorkflowIOMap | null | undefined;
  paramMap: Record<string, unknown> | null | undefined;
  mode: string | null | undefined;
  /** 宿主表单把哪些端口交给了组合控件（卡片不再重复列；连线仍指向那块控件）。 */
  groupedKeys?: ReadonlySet<string>;
}): LibraryParamCards {
  const { io, paramMap, mode, groupedKeys } = args;
  /* 卡片列 = 该模式统一对外暴露的参数（提示词 / 负向提示词 / 尺寸 / 首帧…），
   * **契约口一律常驻**：显示与否只由契约决定，与工作流内部长什么样无关；工作流
   * 只决定每张卡落到哪一行端口，落不到就如实显示成「未配置」。 */
  const entries = buildParamEntries(io, undefined, { mode: mode ?? null });
  /* 落点只由作者画的线决定（`resolveMapping` 只认 `manualByMode`）：没有线就是
   * 未配置。这里不做任何「猜一个落点」的兜底 —— 猜错了比不显示更难被发现。 */
  const parsed = parseParamMapping(paramMap);
  const resolved = resolveMapping(entries, io, parsed, mode ?? null);

  const ownersByPin: Record<string, string> = {};
  const wires: LibraryParamCards["wires"] = [];
  for (const entry of entries) {
    const target = resolved[entry.id];
    /* 未连线 / 作者显式断开（`null`）→ 不画线：圆点悬空本身就在说「没连上」，
     *  画一条通向某处的线反而误导。 */
    if (!target) continue;
    /* 能走到这里说明 `resolveMapping` 给了落点，而落点**只可能来自作者画的线**
     *  —— 所以这条线一定是「作者连的」。用 `resolved` 而不是直接查键：解析时已把
     *  作者画的线归到契约 id 上（含 `<节点 id>|<分类>` 历史键），按裸键查会把作者
     *  画过的线读成「没连过」。 */
    /* 线只画作者连上的那一条 —— 候选是**按类型**收的（同族几个口子互相重叠），
     *  逐条画出来会把兄弟口子的落点也画到本口名下。候选圆点照给（每个都能拖），
     *  见 `paramOutputPorts`；线从对应的那一颗圆点出发（`handleId` 取端口名，
     *  与卡片锚点同口径）。 */
    for (const wired of wiredTargetsForEntry({ target })) {
      wires.push({
        entryId: entry.id,
        targetIoKey: wired.ioKey,
        /* 卡片圆点的 handle id = **条目 id**（与 `paramOutputPorts` 同口径）：
         *  一个口一颗点，条目 id 在同一画布节点内天然唯一 —— 尺寸卡的六行各是子口
         *  id，普通卡就是契约口 id，两边都由它表达「线从哪张卡出发」。 */
        handleId: entry.id,
        grouped: groupedKeys?.has(wired.ioKey) ?? false,
      });
      if (ownersByPin[wired.ioKey]) continue;
      ownersByPin[wired.ioKey] = entry.label;
    }
  }

  /* 「画了线的圆点」= 上面逐条产出的线本身。handle id 就是卡片锚点标识
   *  （普通卡含条目 id，尺寸卡是子口 id），不再另拼一份前缀。 */
  const wiredDotKeys = new Set(wires.map((item) => item.handleId));

  return {
    entries,
    io: io ?? null,
    /* 有落点 = 作者画过线（以 `resolveMapping` 的解析结果为准）。 */
    isManual: (entryId: string) => !!resolved[entryId],
    resolved,
    ownersByPin,
    wires,
    wiredDotKeys,
  };
}

/** 对外**输出**参数卡片与它们的连线（纯派生）。
 *
 *  与输入侧对称：左列说「这个工作流对外要什么、落到节点哪一行」，右列说
 *  「它对外给什么」。输出不参与运行期映射（没有 `source` 键空间），但**它从哪
 *  一行取值**是作者要能改的（ISSUE #355：「右列的对外输出参数目前是只读…需要
 *  可拖」，用于临时把 `images` 指到别处）—— 落点覆盖写在
 *  `paramMap.output.mode:<模式>`（见 `~/lib/workflow-output-binding`）。
 *
 *  因此返回值比输入侧多两样：
 *    · `resolved`：输出口 → 取值那一行（作者连过的优先，否则它自己那一行）；
 *    · `wires`：宿主**取值行**的圆点 → 卡片自己的圆点（方向仍是从左往右画），
 *      且**只有作者真改过取值行的口才画** —— 未连过的不画、作者断开的口也不画
 *      （用户口径：这是**编辑对外参数**的界面，「未连过就不要连」）。
 *
 *  默认取值来源（`resolved` 里的那个回落值）仍然保留：卡片与运行期要读它；只是
 *  画布上不再拿一条虚线表示「这是默认线」—— 未连过就是没有线。 */
/** 对外**输出**参数卡片列与它的连线（`deriveLibraryOutputCards` 的产物）。 */
export interface LibraryOutputCards {
  outputs: (WorkflowIOEntry & { ioKey: string })[];
  wires: ParamCardWire[];
  /** 输出口 ioKey → 当前取值的那一行 ioKey（`null` = 悬空 / 断开）。 */
  resolved: Record<string, string | null>;
  /** 某个输出口在当前模式下是否被作者改过（决定「恢复默认」可用性）。 */
  isManual: (ioKey: string) => boolean;
  /** 某个输出口是否存在任何取值来源（宿主那一行真的画得出来）。 */
  wired: boolean;
}

export function deriveLibraryOutputCards(args: {
  io: WorkflowIOMap | null | undefined;
  paramMap?: Record<string, unknown> | null;
  mode?: string | null;
}): LibraryOutputCards {
  const { io, paramMap, mode } = args;
  /* 顺序与宿主卡片上的输出行**同一份**（`splitWorkflowIO` 里按作者拖出的
   *  `displayOrder` 排过）：右列卡的先后与节点上那几行一一对应，读者不必自己
   *  配对谁是谁。 */
  const outputs = splitWorkflowIO(io).outputs;
  const resolved: Record<string, string | null> = {};
  const wires: ParamCardWire[] = [];
  /* 「取值行」必须是一叠真实存在的**输出**行：作者连到一个已经不存在的端口
   *  （工作流改版）或连成输入口（非法）时，按悬空处理 —— 画不出线也不谎报来源。 */
  const outputKeys = new Set(outputs.map((item) => item.ioKey));
  for (const output of outputs) {
    const target = resolveOutputSource(paramMap, output, outputs, mode, io);
    resolved[output.ioKey] = target && outputKeys.has(target) ? target : null;
  }
  for (const output of outputs) {
    const target = resolved[output.ioKey];
    if (!target) continue;
    /* 未连过（作者没改过这个输出口的取值行）→ **不画线**。
     *
     * 用户口径：这是**编辑对外参数**的界面，未连过就不要连 —— 默认取值来源仍算在
     * `resolved` 里（卡片与运行期读它），但画布上不再画一条虚线占位。库里因此
     * 只剩作者真连过的实线（见 `LIBRARY_EDGE_STYLE`）。 */
    if (manualOutputSource(paramMap, output.ioKey, mode) === undefined)
      continue;
    wires.push({
      entryId: output.ioKey,
      targetIoKey: target,
      /* handle id = 输出的 **ioKey**：卡片锚点与线两端同一份取值。它全图唯一，
       *  也就是落库键（`onConnect` 直接取用）—— 用端口名当锚点会在两个输出口
       *  同名 / 名字为空时撞车，线量不到锚点整条不画（ISSUE #355）。 */
      handleId: output.ioKey,
      grouped: false,
      kind: "hostToParam",
    });
  }
  return {
    outputs,
    wires,
    resolved,
    isManual: (ioKey: string) =>
      manualOutputSource(paramMap, ioKey, mode) !== undefined,
    wired: outputs.length > 0,
  };
}

/** 输出侧的「恢复默认」是否可用（该模式下有任何输出口被改过）。 */
export function hasManualLibraryOutput(args: {
  paramMap?: Record<string, unknown> | null;
  mode?: string | null;
}): boolean {
  return hasManualOutputBinding(args.paramMap, args.mode);
}

export { defaultOutputSource };

/** 对外输出卡片端口行的**显示名**（端口自己的名字；空 / 空白 → 「输出」）。
 *
 *  它与锚点（handle id）是**两件事**：锚点用 `output.ioKey`（全图唯一、也是落库
 *  键）；显示名只是给作者看的，旧数据里作者可能没给 name。 */
export function outputPortLabel(output: { name?: string | null }): string {
  const name = (output.name ?? "").trim();
  return name || "输出";
}
