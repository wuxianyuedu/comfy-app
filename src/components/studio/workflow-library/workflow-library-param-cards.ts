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
  manualTargetFor,
  parseParamMapping,
  resolveMapping,
  wireHandleIdForIoKey,
  wiredTargetsForEntry,
  type ParamEntry,
} from "~/lib/workflow-param-mapping";
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
} from "~/lib/workflow-output-binding";

export interface LibraryParamCards {
  /** 对外参数条目（稳定顺序）。 */
  entries: ParamEntry[];
  /** 派生用的 IO 表（卡片列渲染端口类型读它）。 */
  io: WorkflowIOMap | null;
  /** 该对外参数在当前模式下是否被作者改过（决定卡片头 ↺ 的可用性）。 */
  isManual: (entryId: string) => boolean;
  /** 当前模式下「条目 → 目标 ioKey」的生效落点（作者改过的优先于自动判定）。 */
  resolved: Record<string, string | null>;
  /** 每个被落到的一行（ioKey）→ 落到它的对外参数名，按条目顺序取第一个。
   *  宿主卡片的参数行据此在行尾标出「这一行属于哪个对外参数」。 */
  ownersByPin: Record<string, string>;
  /** 卡片圆点端点 → 宿主行 的只读连线（卡片列右侧的小圆点与宿主卡片上被落
   *  到的那一行之间）。自动判定画虚线、作者改过画实线，与编辑器画布同一套
   *  语义 —— 库里不画线的话，圆点就只是一颗装饰点，读者答不出它连到哪。 */
  wires: ParamCardWire[];
  /** **真的画出了线**的那些卡片圆点（`<条目 id>?<handle id>`）。
   *
   *  与 `wires` 同一份事实的另一面：视图据此判断「这颗圆点该不该画成已连接」
   *  —— 库内每个候选各画一条线，若还按「生效落点那一颗才实心、其余淡一档」
   *  上色，带线的圆点看着反而是断的（用户口径：「这里连线断开了是什么原因」，
   *  ISSUE #355）。 */
  wiredDotKeys: Set<string>;
  /** 宿主卡片此刻真的画得出来的端口（见 `deriveLibraryParamCards` 的入参
   *  `reachableKeys`；缺省 = 不收窄）。卡片上的候选圆点按它收窄，
   *  与连线用同一份事实。 */
  reachableKeys?: ReadonlySet<string>;
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
  manual: boolean;
}

/** 从 workflowIO + paramMap 派生库内画布所需的归属数据。
 *
 *  模式取工作流的 defaultMode —— 与编辑器同一份口径：只有归属某个模式的落点
 *  才成立（`source.mode:<模式>`）。没有模式时带出的 resolved 仍是自动判定结果
 *  （供卡片与行标呈现），但没有任何「作者改过的落点」。 */
export function deriveLibraryParamCards(args: {
  io: WorkflowIOMap | null | undefined;
  paramMap: Record<string, unknown> | null | undefined;
  mode: string | null | undefined;
  /** 宿主表单把哪些端口交给了组合控件（卡片不再重复列；连线仍指向那块控件）。 */
  groupedKeys?: ReadonlySet<string>;
  /** 宿主卡片此刻**真的画得出来、连得上**的那几行（ioKey 集合）。
   *
   *  给定时卡片上的候选圆点收窄到这些行：画不出端点的端口不给拖 —— 拖过去
   *  也只会落不上（用户看到的就是「点击端点拉线出现禁用标记」）。缺省 = 不
   *  收窄（老调用方行为不变）。 */
  reachableKeys?: ReadonlySet<string>;
}): LibraryParamCards {
  const { io, paramMap, mode, groupedKeys, reachableKeys } = args;
  /* 契约驱动：卡片列 = 该模式统一对外暴露的参数（提示词 / 尺寸 / 首帧…），
   * 与具体工作流无关；工作流只决定每张卡落到哪一行端口。 */
  const entries = buildParamEntries(io, undefined, { mode: mode ?? null });
  /* paramMap 里没有 `auto` 字段（它不是持久化字段）——现算一份自动判定，
   * 与编辑器 useParamMapping 里的 auto 同源（autoMapEntries）。 */
  const parsed = parseParamMapping(paramMap);
  const resolved = resolveMapping(entries, io, parsed, mode ?? null);

  const ownersByPin: Record<string, string> = {};
  const wires: LibraryParamCards["wires"] = [];
  for (const entry of entries) {
    const target = resolved[entry.id];
    /* 未连线 / 作者显式断开（`null`）→ 不画线：圆点悬空本身就在说「没连上」，
     *  画一条通向某处的线反而误导。 */
    if (!target) continue;
    /* 「作者改过」的口径与编辑器同一份（manualTargetFor）：该模式下这一条目
     *  确实有一条手工线 —— 显式断开也算改过，只是那时不画线。 */
    const manual =
      manualTargetFor(parsed, entry.id, mode ?? null) !== undefined;
    /* 线要从**对应的那一颗圆点**出发：卡片上一个候选一颗点，取该端口的
     *  handle id（与编辑器画布同口径）。
     *
     *  默认状态下「尺寸」这类口是**一对多**的（宽高比 / 像素量 / 倍数由同一块
     *  组合控件录入），每个端口各一条线 —— 只画自动判定挑中的那一条，会让
     *  「尺寸」看着只有一个出口（ISSUE #355：「尺寸现在有三个参数，就应该可以
     *  连三条线出来」）。作者手工指定落点后只画他指定的那一条。 */
    for (const wired of wiredTargetsForEntry({
      entry,
      io,
      target,
      manual,
      groupedKeys,
      /** 库内**每一个能连的候选端口各画一条线**（与编辑器画布同口径）。
       *
       *  不给这个开关时这里只画「当前生效落点」那一条：「尺寸」这类口子落到
       *  某个端口后，卡片上看着就只有一个出口 —— 用户要的是「宽高比 + 百万像素
       *  这两项都需要能导入到工作流中，所以 2 条线都要能连出去」（ISSUE #355）。
       *
       *  库内卡片给每个候选都画了圆点（每个候选都能拖线改落点），线就该同样
       *  逐条画出来：点有、线没有，读作「这几项没接上」。 */
      allCandidates: true,
    })) {
      /* 宿主卡片上画不出来的行连不出线（端点画在一颗落不上去的句柄上只会误导）。
       *  **当前生效落点永远画**：它就是这条映射本身，画不出来会让卡片看着像「没连上」。
       *  收窄只作用于「一对外参数摊开来的其余端口」（组合控件里那几个兄弟口）。 */
      if (
        reachableKeys &&
        reachableKeys.size > 0 &&
        wired.ioKey !== target &&
        !reachableKeys.has(wired.ioKey)
      )
        continue;
      wires.push({
        entryId: entry.id,
        targetIoKey: wired.ioKey,
        /* 库内这层按**端口名**找卡片上的圆点锚点（`paramOutputPorts` 的
         *  `handleId` 就是端口名）；ioKey 是运行期/落库的键空间，两者不能混。
         *  同一口子摊成多条线时，每条必须对到自己那一颗圆点（都退到 ioKey 就会
         *  让第二、三条线落回第一颗点上）。 */
        handleId: wireHandleIdForIoKey(io, entry, wired.ioKey),
        grouped: groupedKeys?.has(wired.ioKey) ?? false,
        manual,
      });
      if (ownersByPin[wired.ioKey]) continue;
      ownersByPin[wired.ioKey] = entry.label;
    }
  }

  /* 「画了线的圆点」= 上面逐条产出的线本身（`handleId` 与卡片锚点同口径）。 */
  const wiredDotKeys = new Set(
    wires.map((item) => `${item.entryId}?${item.handleId}`),
  );

  return {
    entries,
    io: io ?? null,
    isManual: (entryId: string) =>
      manualTargetFor(parsed, entryId, mode ?? null) !== undefined,
    resolved,
    ownersByPin,
    wires,
    wiredDotKeys,
    reachableKeys,
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
 *      断开的口不画线（悬空即「没接」）。
 *
 *  线恒为**自动**口径（`manual` 恒 false）之外的区分靠实线/虚线表达「这一行是
 *  不是作者改过的取值来源」。 */
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
    wires.push({
      entryId: output.ioKey,
      targetIoKey: target,
      /* handle id 与卡片圆点上的锚点**同一份算式**（见 `outputWireDotId`）：
       *  两处各算一遍时，端口名为空 / 带空白就会一边锚 `输出`、一边找空串 ——
       *  线量不到锚点，整条不画，用户看到的正是「images 和对外输出参数之间
       *  无法连线」（ISSUE #355）。 */
      handleId: outputWireDotId(output),
      grouped: false,
      manual: manualOutputSource(paramMap, output.ioKey, mode) !== undefined,
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

/** 对外输出卡片上那颗圆点的 **handle id**（= 连线锚点里 `?` 后面的那一段）。
 *
 *  输入卡片用「端口名」当 handle（见 `ParamOutputPort.handleId`），输出卡片对称
 *  沿用同一口径。输出端口名可能是空串 / 带空白（作者没给 name 的旧数据），这时
 *  退回卡片标题「输出」—— 与 `WorkflowOutputParamCardColumn` 里 `portName` 的
 *  算式**必须逐字一致**：锚点值与导线两端各算一遍，任何一处漏了 trim / 兜底，
 *  线就量不到锚点、整条不画。 */
export function outputWireDotId(
  output: WorkflowIOEntry & { ioKey: string },
): string {
  const name = (output.name ?? "").trim();
  return name || "输出";
}
