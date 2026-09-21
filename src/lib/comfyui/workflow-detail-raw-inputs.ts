/**
 * RAW 详情构建器的「逐节点输入元数据」路径（`workflow-detail-raw` 的拆分件）。
 *
 * 从 `workflow-detail-raw.ts` 抽出：`buildRawInputs`（约 470 行）与它私有依赖的
 * `LOAD_IMAGE_NODE_TYPES` 常量 + 5 个 helper（`proxyKey` /
 * `collectProxyWidgetPairs` / `isUuidLikeClassType` / `isWrapperAliasSlot` /
 * `subgraphAuthorLabelsByUid`）。原文件保留另三个 build* 出口
 * （`buildRawNodeMeta` / `buildNodeTypeMap` / `buildInnerNodeInputs` /
 * `buildRawView`），并从本模块 re-export `buildRawInputs`；消费者 import
 * 路径不变。
 *
 * 拆分动机：主文件超过 §12.6 文件长度棘轮的阈值（900 行），且 `buildRawInputs`
 * 是全库最大的函数（约 470 行，`check-function-length` 的拆分候选之首），
 * 把它单拎出来同时缓解两个棘轮。共享 interface 下沉到
 * `./workflow-detail-raw-types.ts` 叶子模块，本模块只从那里 `import type`——
 * §12.7 的 `check-circular-deps` **不看 `import type` 是不是类型层**、只要
 * AST 上有 import 关系就算边，因此只有让类型走独立的叶子模块才能真正
 * 断开循环，不是靠 `import type` 的擦除语义。
 */
import {
  fetchWidgetOrderTable,
  mapWidgetValuesByOrder,
  type RawNode,
  type RawSubgraphDef,
  type RawWorkflow,
} from "~/lib/comfyui/raw";
import { inferInputType, inferIsMultiline } from "~/lib/comfyui/types";
import type { RawInputEntry } from "./workflow-detail-raw-types";

/* IMAGE 输入的缩略图预览。ComfyUI 的 LoadImage 节点把上传的文件名存在
 * `widgets_values[0]` 里；我们在 LoadImage 节点**自身**上盖一条合成的
 * `preview` 标记条目，把它变成内联预览。**不**把 `imageRef` 传播到下游的
 * IMAGE 输入（ImageScale / CLIPVisionEncode 等）—— 那里渲染出来的永远只是
 * 未缩放 / 未编码的上游图（等于 LoadImage 预览的副本），用户反馈说没有意义；
 * 缩略图只该由源头那个 LoadImage 节点画。
 * LoadImage 没上传图（widgets_values[0] 缺失或为空）时**仍**推这条合成条目
 * （不带 `imageRef`），让渲染器……
 * show a 「需要上传图片」 placeholder in the body, matching ComfyUI's empty
 * state. */
const LOAD_IMAGE_NODE_TYPES = new Set([
  "LoadImage",
  "LoadImageMasked",
  "ComfyUI LoadImage",
  "ComfyUI-LoadImage",
  "Load Image",
  "ImageLoader",
  "ComfyUI-ImageLoader",
]);

/**
 * 从 RAW（UI 格式）json 里构建逐节点的输入元数据（`rawInputsById`）与
 * ComfyUI 的精确外框尺寸（`sizeById`）。
 *
 * 基础解析器走每个原始节点的 `inputs[]` 数组，并盖上：
 *   - `isConnection`，取自 `inp.link`
 *   - `widget: { name }`，给暴露了内部 widget 值的输入
 *   - `widgetValue`，从 `widgets_values[k]` 取值，配一个递进的 widget 计数器
 *     （seed / noise_seed 会捆两个槽：本身的值 + 隐含的
 *     `control_after_generate` 伙伴）
 *   - `multiline`，给 `inferIsMultiline` 标出的 STRING 输入
 *   - LoadImage 一族节点上的一条合成 `preview` 条目
 *
 * 随后，子图封装节点暴露出来的 widget 值会从 `properties.proxyWidgets`
 * 富化得到 —— 封装节点自己的 `widgets_values[]` 是空的，真正的值存在内部节点
 * 的数组里。COMBO 候选值经 /api/object_info 解析（每个解析器只取一次，带缓存），
 * 盖上 `comboOptions`。
 */
/** 唯一定位一个代理目标 —— 空白槽位与跳过的目标不会互相顶掉。 */
function proxyKey(target: [string, string]): string {
  return `${target[0]}\u0000${target[1]}`;
}

/** 解析 wrapper 节点的 `properties.proxyWidgets`（暴露槽位 → 内部字段映射）。
 *
 *  两种导出形态都要认，它们出现在不同 ComfyUI 版本的工作流里：
 *    · 数组：`[[内部节点id, 字段名], …]`，下标即第 N 个暴露的 widget 槽位
 *      （纯端口不占位）；
 *    · 对象：`{ "槽位名": [内部节点id, 字段名], … }`（部分导出把键一并写下来）。
 *  对象形态的键就是槽位名，可以直接当第一判据用；数组形态只有位置。
 *
 *  一个都解析不出来时返回空数组 —— 调用方据此跳过该 wrapper（保持旧行为：
 *  没有映射就不猜，宁可只显示别名，也不把别的槽位的字段名安到这一行）。 */
function collectProxyWidgetPairs(
  raw: unknown,
): { slot?: string; target: [string, string] }[] {
  const pairs: { slot?: string; target: [string, string] }[] = [];
  const asTarget = (pair: unknown): [string, string] | null => {
    if (!Array.isArray(pair) || pair.length < 2) return null;
    if (
      pair[0] === undefined ||
      pair[0] === null ||
      pair[1] === undefined ||
      pair[1] === null
    ) {
      return null;
    }
    return [String(pair[0]), String(pair[1])];
  };
  if (Array.isArray(raw)) {
    for (const pair of raw) {
      const target = asTarget(pair);
      if (target) pairs.push({ target });
    }
    return pairs;
  }
  if (raw && typeof raw === "object") {
    for (const [slot, value] of Object.entries(
      raw as Record<string, unknown>,
    )) {
      const target = asTarget(value);
      if (target) pairs.push({ slot, target });
    }
  }
  return pairs;
}

/** 节点类名是不是子图封装节点（`class_type` 是子图 UUID）。
 *
 *  封装节点在画布上渲染成紫色整卡，`class_type` 就是子图定义的 UUID ——
 *  ComfyUI 不在这一层放插件类名。用来区分「槽位名是平台自动编号的别名」
 *  与「槽位名是插件作者定义的 pin 名」。 */
function isUuidLikeClassType(classType: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    classType.trim(),
  );
}

/** ComfyUI 为子图 wrapper 槽位自动编号出的名字（`value_1` / 裸序号 `1`）。
 *
 *  这不是「语法糖」，而是平台的编号产物：作者不会手写它，因此看到这个形状
 *  就可以判定该槽位的业务名要另找来源（子图边界 pin 的作者 label）。 */
function isWrapperAliasSlot(name: string): boolean {
  const slot = name.trim();
  return /^value_\d+$/.test(slot) || /^\d+$/.test(slot);
}

/** 子图边界 pin 的作者名表：`槽位名 → 作者 label`（按子图 UUID 分组）。
 *
 *  ComfyUI 把子工作流封装节点（wrapper）的暴露槽位逐槽自动编号成 `value_1` /
 *  `value_2`（部分导出是裸序号 `1` / `2`），作者写的业务名（`Seed`）只留在子图
 *  定义的边界 pin（`definitions.subgraphs[uid].inputs[].label`）上。wrapper 自身
 *  的 `inputs[]` 常常只有别名，甚至 `properties.proxyWidgets` 被整体隔离
 *  （`proxyWidgetErrorQuarantine`）—— 两条常规来源都拿不到作者名时，富化链
 *  只能停在别名上，名字随即被当成「作者命名」固化回库（ISSUE #349）。
 *
 *  这里把边界 pin 的作者名按「槽位名」预先索引好，供下面的 wrapper 分支回填；
 *  槽位名与边界 pin 的 `name` 同名是 ComfyUI 的约定（wrapper 本层槽位即边界
 *  pin）。子图定义缺失 / pin 没写 label 时整表为空，行为与旧版逐值一致。 */
function subgraphAuthorLabelsByUid(
  raw: RawWorkflow | null,
): Record<string, Record<string, string>> {
  const byUid: Record<string, Record<string, string>> = {};
  const subgraphs = raw?.definitions?.subgraphs;
  if (!subgraphs || typeof subgraphs !== "object") return byUid;
  /* `subgraphs` 有两种形态：以 UUID 为键的对象，或按顺序排列的数组（旧导出）。
   * 键也可能是数字序号，真 UUID 藏在定义自身的 `id` 上 —— 两种都登记，让
   * 上层按 wrapper 的 `class_type` 查得到。 */
  const subgraphEntries: [string, RawSubgraphDef][] = Array.isArray(subgraphs)
    ? (subgraphs as RawSubgraphDef[]).map(
        (subDef, index): [string, RawSubgraphDef] => [String(index), subDef],
      )
    : Object.entries(subgraphs);
  for (const [key, subDef] of subgraphEntries) {
    if (!subDef || !Array.isArray(subDef.inputs)) continue;
    const table: Record<string, string> = {};
    for (const pinRaw of subDef.inputs) {
      if (!pinRaw || typeof pinRaw !== "object") continue;
      const pin = pinRaw as Record<string, unknown>;
      const slot = typeof pin.name === "string" ? pin.name.trim() : "";
      const label = typeof pin.label === "string" ? pin.label.trim() : "";
      if (!slot || !label || slot === label) continue;
      table[slot] = label;
    }
    if (Object.keys(table).length === 0) continue;
    const uid = typeof subDef.id === "string" ? subDef.id : "";
    if (uid) byUid[uid] = table;
    byUid[key] = table;
  }
  return byUid;
}

export async function buildRawInputs(
  raw: RawWorkflow | null,
  comboOptionsForClassField: (
    classType: string | undefined,
    field: string,
  ) => Promise<string[] | undefined>,
  /** 某 class 某字段是否声明了 `{"multiline": true}`（object_info 的事实）。
   *  查不到返回 `undefined` —— 多行判定退到「值很长」那条数据判据，不猜名字。 */
  multilineForClassField: (
    classType: string | undefined,
    field: string,
  ) => Promise<boolean | undefined>,
): Promise<{
  rawInputsById: Record<string, RawInputEntry[]>;
  sizeById: Record<string, [number, number]>;
}> {
  /* 给每个图节点建 `rawInputs` 查找表。原始 UI 格式里，每个节点在磁盘记录上
   * 带一个 `inputs` 数组，每项形如
   *   { name, localized_name, label?, type, link }（字段名照旧）
   * `localized_name` 是简体中文显示标签（ComfyUI 逐节点保存的），
   * `type` 是 ComfyUI 的数据类型字符串，连线与 widget 值都用它。
   * 工作流只以 API JSON 导入时，这张表是空的。 */
  const rawInputsById: Record<string, RawInputEntry[]> = {};
  /* ComfyUI / litegraph 节点的 `size`（[w, h]）—— 透传出去，画布便能按
   *  ComfyUI 的精确尺寸画出每个节点框（用户期望卡片与导入的配置一致，
   * 包括那些内部留白很大的超尺寸框）。API 格式的 `tpl.graph` 把 `size` 丢了，
   * 因此这里按 id 从 `raw.nodes`（它还带着）里捞回来。 */
  const sizeById: Record<string, [number, number]> = {};
  /* 控件顺序表（classType → 控件名数组，含 control_after_generate
   * 哨兵槽）。惰性拉取 —— 只有真的遇到「inputs[] 没覆盖到的控件值」时才请求
   * object_info，避免每个工作流都白跑一次；ComfyUI 未启动时 30s 负缓存生效，
   * 拿不到表也只是退回旧逻辑，不会拖慢。 */
  let widgetOrderTable: Record<string, string[]> | null = null;
  const ensureWidgetOrderTable = async (): Promise<
    Record<string, string[]>
  > => {
    widgetOrderTable ??= await fetchWidgetOrderTable();
    return widgetOrderTable;
  };
  /* 子图边界 pin 的作者名（wrapper 槽位别名 → 作者业务名），供 wrapper 分支
   *  回填 —— 见 subgraphAuthorLabelsByUid 的说明。 */
  const subgraphAuthorLabels = subgraphAuthorLabelsByUid(raw);
  if (raw && Array.isArray(raw.nodes)) {
    for (const rn of raw.nodes) {
      if (!rn) continue;
      /* 给**每个**原始节点都记 `size`，与该节点有没有 `inputs` 数组无关。
       * 有些 litegraph 导出（以及部分测试夹具）会在仍有 `size` 的节点上省略
       * `inputs`；把 size 挂在 `inputs` 上判，会把这些尺寸误丢。
       * （下面那一趟 rawInputsById 仍然需要 `inputs`，
       * 所以这里单独走一遍。）
       *  guard below.) */
      const rnSize =
        Array.isArray(rn.size) && rn.size.length >= 2 ? rn.size : undefined;
      if (rnSize) {
        sizeById[String(rn.id)] = [
          Number(rnSize[0]) || 0,
          Number(rnSize[1]) || 0,
        ];
      }
      if (!Array.isArray(rn.inputs)) continue;
      const list: RawInputEntry[] = [];
      const rnWidgets = Array.isArray(rn.widgets_values)
        ? rn.widgets_values
        : [];
      const rnClassType = typeof rn.type === "string" ? rn.type : "";

      /* ── 旧配对（兜底）：按 inputs[] 中控件出现的顺序，用游标依次取
       *  widgets_values。只在拿不到该类的控件顺序表时使用 —— 见下方 byOrder。 */
      const legacyByName = new Map<string, unknown>();
      let widgetCounter = 0;
      for (const inp of rn.inputs) {
        if (!inp || typeof inp.name !== "string") continue;
        const widgetName =
          inp.widget && typeof inp.widget.name === "string"
            ? inp.widget.name
            : undefined;
        if (!widgetName || widgetCounter >= rnWidgets.length) continue;
        legacyByName.set(widgetName, rnWidgets[widgetCounter]);
        /* seed / noise_seed widget 的值后面紧跟着一个隐含的
         * `control_after_generate` 伙伴槽。 */
        const isSeedBundle =
          widgetName === "seed" ||
          widgetName === "noise_seed" ||
          inp.name === "seed" ||
          inp.name === "noise_seed";
        widgetCounter += isSeedBundle ? 2 : 1;
      }

      /* ── 顺序表配对：把整个 widgets_values 反查成「控件名 → 值」。
       *  ComfyUI 默认只把「转成输入」的控件写进 raw 节点的 inputs[]，其余控件的
       *  值仅存在于 widgets_values[]。仅靠 inputs[] 配对会整段漏掉它们
       *  （CLIPTextEncode 的提示词、SenseNovaU15Loader 的模型名…），节点上看
       *  不到任何参数。这里改用与 convertRawToApi 同源的控件顺序表反查下标。 */
      let byOrder: { name: string; value: unknown }[] | null = null;
      if (
        rnWidgets.length > 0 &&
        (widgetCounter < rnWidgets.length || legacyByName.size === 0)
      ) {
        const table = await ensureWidgetOrderTable();
        byOrder = mapWidgetValuesByOrder(table[rnClassType], rnWidgets);
      }
      const valueByName = new Map<string, unknown>();
      if (byOrder) for (const w of byOrder) valueByName.set(w.name, w.value);
      else
        for (const [name, value] of legacyByName) valueByName.set(name, value);

      /* 已被 inputs[] 占据的控件名 —— 下面补齐时不再重复生成。 */
      const usedWidgetNames = new Set<string>();

      for (const inp of rn.inputs) {
        if (!inp || typeof inp.name !== "string") continue;
        const isConn = inp.link != null;
        /* ComfyUI 在「被暴露的 widget 代理」输入上，把 widget 把手烤成
         *  `{ widget: { name: "…" } }` —— 值存在 `widgets_values` 里，
         * 下标是「按 inputs[] 顺序数到该行时已见到的 widget 个数」。
         * 没有这个计数器，API 只会暴露扁平的 widgets_values 数组，
         * 逼每个消费方自己去重新配对下标 ——
         * 那正是此前「<输入名仍然显示没有值>」这类回归的来源。 */
        const widgetName =
          inp.widget && typeof inp.widget.name === "string"
            ? inp.widget.name
            : undefined;
        let widgetValue: unknown = undefined;
        if (widgetName) {
          usedWidgetNames.add(widgetName);
          if (valueByName.has(widgetName))
            widgetValue = valueByName.get(widgetName);
          else if (legacyByName.has(widgetName))
            widgetValue = legacyByName.get(widgetName);
        }
        /* 作者名回填（仅封装节点）：wrapper 本层只写了自动编号的槽位名
         *  （`value_1`）时，从子图边界 pin 取作者业务名（`Seed`）—— 顺序不能
         *  反，作者真在本层写了别的名字时一律以本层为准，不被边界 pin 覆盖
         *  （ISSUE #349）。 */
        const ownLabel = typeof inp.label === "string" ? inp.label.trim() : "";
        const ownLabelIsAuthorFacing =
          ownLabel.length > 0 && ownLabel !== inp.name;
        const wrapperAuthorLabel =
          isUuidLikeClassType(rnClassType) &&
          !ownLabelIsAuthorFacing &&
          isWrapperAliasSlot(inp.name)
            ? subgraphAuthorLabels[rnClassType]?.[inp.name]
            : undefined;
        const entry: RawInputEntry = {
          name: inp.name,
          label:
            wrapperAuthorLabel ??
            (typeof inp.label === "string" ? inp.label : undefined),
          localized:
            typeof inp.localized_name === "string"
              ? inp.localized_name
              : undefined,
          type:
            typeof inp.type === "string" ? inp.type : isConn ? "*" : "STRING",
          isConnection: isConn,
        };
        if (widgetName) entry.widget = { name: widgetName };
        if (widgetValue !== undefined) entry.widgetValue = widgetValue;
        /* 给上游 `inferIsMultiline` 助手标出的每个 STRING 输入盖
         *  `multiline`。该助手**刻意**不盖 `multiline: false` ——
         *  这是一个只做「开启」的标记；渲染器把「没有」当成「没有意见」，
         *  回落到自己的启发式。
         *
         *  判据来自节点自己的类型声明（`("STRING", {"multiline": true})`
         *  → object_info），不按字段名猜：「叫 prompt 的就是多行」会把
         *  `prompt_width_of_thing` 这类单行输入升级成 textarea。 */
        if (typeof inp.type === "string" && inp.type === "STRING") {
          if (
            inferIsMultiline(
              await multilineForClassField(
                typeof rn.type === "string" ? rn.type : undefined,
                inp.name,
              ),
              widgetValue,
            )
          ) {
            entry.multiline = true;
          }
        }
        list.push(entry);
      }

      /* 补齐「没有出现在 inputs[] 里的控件」—— 它们的值只存在于 widgets_values[]，
       * 之前整段丢失，画布上这类节点（各类 Loader / CLIPTextEncode …）看起来
       * 一个参数都没有。LoadImage 家族例外：它的 image 控件由下方合成的
       * preview 条目以缩略图呈现，不需要再重复一行文本。 */
      if (byOrder && !LOAD_IMAGE_NODE_TYPES.has(rnClassType)) {
        for (const w of byOrder) {
          if (usedWidgetNames.has(w.name) || w.value === undefined) continue;
          /* 数组值是连线元组（[nodeId, slot]），不是控件值 —— 跳过。 */
          if (Array.isArray(w.value)) continue;
          const type = inferInputType(rnClassType, w.name, w.value);
          list.push({
            name: w.name,
            type,
            isConnection: false,
            widget: { name: w.name },
            widgetValue: w.value,
            ...(type === "STRING" &&
            inferIsMultiline(
              await multilineForClassField(rnClassType, w.name),
              w.value,
            )
              ? { multiline: true as const }
              : {}),
          });
        }
      }

      rawInputsById[String(rn.id)] = list;
      /* LoadImage 一族节点把上传的文件名放在 widgets_values[0]，
       * 但它们**没有** IMAGE 输入（它们是 IMAGE 的**产出方**）。
       * 我们合成一条预览条目（`preview: true` 标记），画布便能画出它 ——
       * uploaded thumbnail (or a 「需要上传图片」 placeholder when empty) on
       *         * 缩略图，且正好画在 ComfyUI 自己画的位置。
       *        * LoadImage 一族**一律**推这条条目，与是否已加载图片无关。
       *        * 没图的分支（widgets_values[0] 缺失 / 为空）返回
       *        * `imageRef: undefined`，前端渲染成占位。这样节点主体上永远有它的预览区
       *        * —— 折叠主体两者一起消失，正是与 ComfyUI 一致的形态。
       *        * 专属的 `preview: true` 标记会被渲染器的 connEntries / widgetEntries
       *        * 过滤器检查，因此这条条目永远不会落进端口行或 widget 控件清单。 */
      if (
        LOAD_IMAGE_NODE_TYPES.has(typeof rn.type === "string" ? rn.type : "")
      ) {
        if (!list.some((list) => list.preview)) {
          const wv0 = rn.widgets_values?.[0];
          const fname = typeof wv0 === "string" ? wv0.trim() : "";
          list.push({
            name: "__loadimage_preview__",
            label: "image",
            localized: "图像",
            type: "IMAGE",
            isConnection: false,
            preview: true,
            ...(fname
              ? {
                  imageRef: {
                    filename: fname,
                    subfolder: "",
                    type: "input" as const,
                  },
                }
              : {}),
          });
        }
      }
    }
  }
  /* 子图封装节点的 widget 值查找。
   *
   * ComfyUI 导出的子图工作流会在每个封装节点上带一个
   * `properties.proxyWidgets` 数组，把 wrapper.inputs[i] 映射到「内部节点 +
   * widget 字段」：`proxyWidgets[i] = [内部节点id, 字段名]`。
   * 封装节点自己的 `widgets_values[]` 是空的 —— 真正的值存在对应内部节点的
   * `widgets_values[]` 里，下标为下面那个槽位计数器。
   * 具体做法：走内部节点的 `inputs[]` 数组，找到 `fieldName` 对应的槽位
   * （边数边累计已见到的 widget 槽数 —— ComfyUI / LiteGraph 把 widget 值
   * 按输入顺序存成一个扁平数组）。
   * 特例：KSampler / KSamplerAdvanced 把 `seed` 与 `control_after_generate`
   * 捆成**连续的两个** widget 槽 —— `seed` 占 0 号槽，
   * `control_after_generate` 落在 1 号槽；因此槽位计数器一旦碰到 seed widget
   * 就要一次前进 2。
   * 上面的基础解析器已经给带 widget 标记的输入盖上了 `widget: { name }`
   * （ComfyUI 导出的封装节点总是有），并从 `inp.link` 盖 `isConnection`，
   * 还尝试从 `rn.widgets_values[widgetCounter]` 取 `widgetValue` ——
   * 但对封装节点来说后者是空的，因此在这趟富化跑之前，
   * 每一行 widget 都是空白。 */
  if (raw?.definitions?.subgraphs) {
    const subs = raw.definitions.subgraphs;
    /* 按 id 给每个子图定义里的内部节点建索引，查找降到 O(1)。 */
    const internalByIdByKey = new Map<string, Map<string, RawNode>>();
    for (const subKey of Object.keys(subs)) {
      const subDef = subs[subKey];

      const map = new Map<string, RawNode>();

      if (Array.isArray(subDef?.nodes)) {
        for (const inN of subDef.nodes) {
          if (inN?.id != null) map.set(String(inN.id), inN);
        }
      }

      internalByIdByKey.set(subKey, map);
    }
    /* 找出封装节点 UUID classType 对应的那个子图定义。 */
    const resolveSubDef = (
      classType: string,
    ): { key: string; def: RawSubgraphDef } | null => {
      const direct = subs[classType];
      if (direct) return { key: classType, def: direct };
      for (const k of Object.keys(subs)) {
        const cand = subs[k];
        if (cand?.id === classType) return { key: k, def: cand };
      }
      return null;
    };
    /* 取内部节点上某个 widget 字段的当前值：走 inputs[] 找到对应槽位，
     * 再按它索引 widgets_values[]。seed + control_after_generate 的双槽捆绑
     * 也要处理 —— 碰到 seed / noise_seed widget 时槽位计数器前进两次
     * （这些输入总是带一个隐含的 `control_after_generate` 伙伴槽）。 */
    const lookupFieldValue = (
      internalNode: RawNode | undefined,
      fieldName: string,
    ): unknown => {
      if (!internalNode || !Array.isArray(internalNode.inputs))
        return undefined;
      const inputs = internalNode.inputs;
      const wv: unknown[] = Array.isArray(internalNode.widgets_values)
        ? internalNode.widgets_values
        : [];
      /* control_after_generate 永远紧跟在 seed 的**下一个**槽位。 */
      if (fieldName === "control_after_generate") {
        const seedIdx = inputs.findIndex(
          (i) => !!i && (i.name === "seed" || i.name === "noise_seed"),
        );
        if (seedIdx < 0) return undefined;
        let slot = 0;
        for (let k = 0; k <= seedIdx; k++) {
          if (inputs[k]?.widget) slot++;
        }
        return slot < wv.length ? wv[slot] : undefined;
      }
      /* 通用路径：数出目标输入之前有多少个 widget 槽。 */
      const inputIdx = inputs.findIndex((i) => i?.name === fieldName);
      if (inputIdx < 0) return undefined;
      let slot = 0;
      for (let k = 0; k < inputIdx; k++) {
        const inp = inputs[k];
        if (inp?.widget) {
          slot++;
          /* seed 捆绑要额外占掉一个 control_after_generate 的槽 */
          if (inp.name === "seed" || inp.name === "noise_seed") slot++;
        }
      }
      return slot < wv.length ? wv[slot] : undefined;
    };
    /* 给每个封装节点预先算好 (subDefKey, proxyWidgets, internalById)，
     * 工作流里封装节点很多时，内层映射的代价仍然很低。 */
    const wrapperNodeIds: string[] = [];
    for (const nodeId of Object.keys(rawInputsById)) {
      const rn = raw.nodes.find((n) => String(n?.id) === nodeId);
      if (!rn) continue;
      const classType = typeof rn.type === "string" ? rn.type : "";
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}/i.test(classType)) continue;
      wrapperNodeIds.push(nodeId);
    }

    for (const nodeId of wrapperNodeIds) {
      const rn = raw.nodes.find((n) => String(n?.id) === nodeId);
      if (!rn) continue;
      const classType = typeof rn.type === "string" ? rn.type : "";
      const resolved = resolveSubDef(classType);
      if (!resolved) continue;
      const internalById = internalByIdByKey.get(resolved.key);
      if (!internalById) continue;
      /* proxyWidgets 的键形态有两种：官方是 `[[内部节点id, 字段名]]`，也有导出
       *  写成 `{ 槽位名: [内部节点id, 字段名] }`。两种都读，否则这类工作流会被
       *  整段跳过 —— 别名清不掉、内部字段名也取不到（ISSUE #349）。 */
      const proxyPairs = collectProxyWidgetPairs(rn.properties?.proxyWidgets);
      const byName = new Map<string, [string, string]>();
      const ordered: Array<[string, string]> = [];
      for (const pair of proxyPairs) {
        if (pair.slot !== undefined && !byName.has(pair.slot))
          byName.set(pair.slot, pair.target);
        ordered.push(pair.target);
      }
      if (ordered.length === 0) continue;

      const subNodeType =
        typeof resolved.def?.name === "string" && resolved.def.name.trim()
          ? resolved.def.name
          : classType;

      const existingList = rawInputsById[nodeId] ?? [];
      /* `proxyWidgets` 是按**widget 输入的次序**（第 i 个暴露的 widget 槽）
       *  索引的，**不是**原始输入数组的下标 —— ComfyUI 构建这个数组时会跳过
       *  纯连线端口。因此必须用**专门的** `widgetSlot` 计数器走 widget 槽，
       *  不能复用映射里的 `idx`（它把每个输入都数进去，端口也在内）。
       *  复用 `idx` 的后果：封装节点只要在首尾有非 widget 端口，
       *  映射就整体错位 —— 每个被封装的值都落到错误的行上，
       *  末尾的 widget 输入则掉出数组尾部，渲染成空占位格。 */
      let widgetSlot = 0;
      /* 已被位置序消费过的 (内部节点, 字段) 对 —— 防重复匹配串台。 */
      const usedProxyTargets = new Set<string>();
      const updatedList = existingList.map((entry) => {
        /* 只富化**已经**带 widget 标记的输入（即被暴露的 widget 槽，
         *  而不是纯连线端口）。纯端口在客户端正确地留在 connInputs 里。 */
        if (!entry.widget) return entry;
        /* 首选按槽位名匹配：`value_1` 直取自己的目标，比位置更抗得住导出差异。
         *  名字对不上（命名不是 value_N 的私有导出）时退回位置序。 */
        const proxy = byName.get(entry.name) ?? ordered[widgetSlot];
        widgetSlot += 1;
        /* 位置序只能全表唯一地成立：一旦拿到的目标已被别的槽位占用，说明顺序
         *  不可信 —— 宁可给空，也不把别的槽位的字段名安到这一行上。 */
        if (!proxy || usedProxyTargets.has(proxyKey(proxy))) return entry;
        usedProxyTargets.add(proxyKey(proxy));
        const [internalNodeId, fieldName] = proxy;
        const internalNode = internalById.get(internalNodeId);
        const updated: RawInputEntry = { ...entry };
        if (updated.widgetValue === undefined) {
          const value = lookupFieldValue(internalNode, fieldName);

          if (value !== undefined) updated.widgetValue = value;
        }
        /* 封装条目自己没带类型时，采用内部节点该槽位的类型作为权威值
         *  （防御性 —— 通常原始 JSON 里本来就有）。 */
        if (internalNode && Array.isArray(internalNode.inputs)) {
          const inp = internalNode.inputs.find((i) => i?.name === fieldName);
          if (typeof inp?.type === "string") updated.type = inp.type;
          if (!updated.label && typeof inp?.localized_name === "string") {
            updated.label = inp.localized_name;
          }
          /* 记录内部真实字段（业务名的唯一来源）。wrapper 本层槽位名是
           *  ComfyUI 自动编号的别名（value_1），富化据此才能在别名之外
           *  找到真实字段名与其 label / localized（ISSUE #349）。 */
          if (internalNodeId && fieldName) {
            updated.proxyField = {
              nodeId: internalNodeId,
              field: fieldName,
              ...(typeof inp?.label === "string" ? { label: inp.label } : {}),
              ...(typeof inp?.localized_name === "string"
                ? { localized: inp.localized_name }
                : {}),
            };
          }
          /* 存下代理目标（内部节点的 class + 字段），下面那趟异步 COMBO
           *  候选值处理便能为本封装节点上的 COMBO widget 从
           *  /api/object_info 解析候选清单。 */
          updated.__comboClass = internalNode.type;
          updated.__comboField = fieldName;
        } else if (internalNodeId && fieldName) {
          /* 内部节点缺失（子图定义不完整 / 同名冲突）时也要留下字段名——
           *  它仍比别名 value_1 有信息量，富化按 field 兜底。 */
          updated.proxyField = { nodeId: internalNodeId, field: fieldName };
        }
        return updated;
      });
      /* Re-stamp multiline 现在才知道值（基础解析跑在这一趟之前，可能整段跳过）。
       *  声明查的是**内部节点**的类与字段（业务语义在那一侧），wrapper 本层的
       *  槽位名只是别名。必须排在下面的 COMBO 趟之前：那一趟会把
       *  `__comboClass` / `__comboField` 临时字段删掉。 */
      for (const e of updatedList) {
        if (e.type !== "STRING" || e.multiline) continue;
        const declared = await multilineForClassField(
          e.__comboClass ?? subNodeType,
          e.__comboField ?? e.name,
        );
        if (inferIsMultiline(declared, e.widgetValue)) e.multiline = true;
      }
      /* 从 /api/object_info 解析 COMBO 候选清单（每次请求只取一次，带缓存）。
       *  只有是 COMBO 的封装 widget 输入才会拿到 `comboOptions` 数组，
       *  其余一律不动。ComfyUI 不可达时，这些临时字段直接丢掉，
       *  消费方回落到普通文本控件。 */
      for (const e of updatedList) {
        if (e.type === "COMBO" && e.__comboClass) {
          const opts = await comboOptionsForClassField(
            e.__comboClass,
            e.__comboField ?? "",
          );
          if (opts) e.comboOptions = opts;
        }
        delete e.__comboClass;
        delete e.__comboField;
      }
      rawInputsById[nodeId] = updatedList;
    }
  }

  return { rawInputsById, sizeById };
}
