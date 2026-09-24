/**
 * 提交前剔除 raw UI-format 工作流里的**纯 UI 节点**（服务端不认识、也不携带数据流）。
 *
 * 现场：工作流里带 rgthree 的 `Bookmark (rgthree)` / `Label (rgthree)`
 * 画布批注节点，comfy-cli 1.20.0 做 UI→API 转换后向 `/prompt` 校验时报
 * `unknown_class_type`（`node 3: class_type 'Bookmark (rgthree)' not found in
 * object_info`），**整单失败**——25 条校验错误里 8 条来自这类节点。
 *
 * 它们只有前端实现，object_info 里没有；服务端本来也会按「不可达」把它们剪掉
 * （同一条 envelope 的 `warnings` 里就是 `node_not_reachable_from_output`），
 * 所以剔除是纯收益：不改变执行结果，只让可执行的那张图能提交。
 *
 * 名单只收 rgthree 的六个**虚拟节点**（`Bookmark` / `Label` / `Reroute` 三个画布
 * 批注与连线整理 + `Fast Groups` 三个分组批量开关）。rgthree 的其余节点
 * （`Context` / `Seed` / `Image Comparer` / `Mute / Bypass Relay` …）都有后端实现，
 * 剔了就是真的丢功能，因此一律不动。
 *
 * 抽成独立叶子模块（而不是留在 `executor-cli.ts` 里）的理由有二：
 *   · 它是**纯函数**（只改传进来的对象、不碰 IO），单测可以直接喂夹具，不必把
 *     executor-cli 那一串服务端依赖整棵拉进测试；
 *   · 「哪些节点要剔」这件事此前没有判据覆盖（`executor-cli.test.ts` 只测了
 *     `applyRawOverrides`），所以名单缺项（正是本次故障）没有任何地方会红。
 */

/** 服务端 object_info 里没有、且不携带数据流的节点类型。 */
export const UI_ONLY_NODE_TYPES: ReadonlySet<string> = new Set([
  "Bookmark (rgthree)",
  "Label (rgthree)",
  "Reroute (rgthree)",
  "Fast Groups Bypasser (rgthree)",
  "Fast Groups Muter (rgthree)",
  "Fast Groups Bookmarker (rgthree)",
]);

/** Read a string field off an unknown payload（非 string → undefined）。 */
function strField(o: unknown, key: string): string | undefined {
  if (o == null || typeof o !== "object") return undefined;
  const v = (o as Record<string, unknown>)[key];
  return typeof v === "string" ? v : undefined;
}

/** 端点的 id → 比较用的字符串；不是 string / number（畸形数据里的对象等）给空串。 */
function idOf(value: unknown): string {
  return typeof value === "string" || typeof value === "number"
    ? String(value)
    : "";
}

/** 从一组节点里挑出 UI-only 的：返回保留的节点与被删的 id。 */
function pickOutUiOnlyNodes(nodes: unknown[]): {
  kept: unknown[];
  removedIds: Set<string>;
} {
  const kept: unknown[] = [];
  const removedIds = new Set<string>();
  for (const n of nodes) {
    if (n == null || typeof n !== "object") {
      kept.push(n);
      continue;
    }
    const node = n as Record<string, unknown>;
    /* 两种导出形态都认：ComfyUI 新导出走 `type`，部分路径（子图 wrapper）走
     * `class_type`（与 `executor-cli` 里读节点类型同口径）。 */
    const type = strField(node, "type") ?? strField(node, "class_type");
    if (type && UI_ONLY_NODE_TYPES.has(type)) {
      const rawId = node.id;
      if (typeof rawId === "string" || typeof rawId === "number") {
        removedIds.add(String(rawId));
      }
      continue;
    }
    kept.push(n);
  }
  return { kept, removedIds };
}

/**
 * 丢掉与已删节点相关的连线——两种形态都要认：
 *   · 顶层 `links` 是六元组 `[linkId, originId, originSlot, targetId, targetSlot, type]`；
 *   · 子图定义里的 `links` 是对象 `{ id, origin_id, origin_slot, target_id, target_slot, type }`。
 *
 * 不清理会留下指向不存在节点的悬空连线（转换器按 id 查表时拿到 `undefined`）。
 */
function dropLinksTo(
  container: Record<string, unknown>,
  removedIds: Set<string>,
): void {
  const links = container.links;
  if (!Array.isArray(links)) return;
  container.links = links.filter((link) => {
    if (Array.isArray(link)) {
      return !removedIds.has(idOf(link[1])) && !removedIds.has(idOf(link[3]));
    }
    if (link != null && typeof link === "object") {
      const l = link as Record<string, unknown>;
      return (
        !removedIds.has(idOf(l.origin_id)) && !removedIds.has(idOf(l.target_id))
      );
    }
    return true;
  });
}

/**
 * 剔除纯 UI 节点：**就地**改 `raw`（顶层与子图内部各走一遍），返回删掉的数量。
 *
 * 子图（ComfyUI v0.7+ 的 `definitions.subgraphs`）必须一起扫：里面的批注节点
 * 同样会被 comfy-cli 展开后拿去校验，现场 `1512:1675` / `1512:1728` 就是子图里的
 * `Bookmark (rgthree)` —— 只扫顶层 `nodes` 会漏掉它们，故障照旧。
 *
 * `definitions.subgraphs` 有两种形态（以 UUID / 数字序号为键的对象，或数组），
 * 两者都处理。
 */
export function stripUiOnlyNodes(raw: Record<string, unknown>): {
  raw: Record<string, unknown>;
  removed: number;
} {
  let removed = 0;

  if (Array.isArray(raw.nodes)) {
    const top = pickOutUiOnlyNodes(raw.nodes);
    if (top.removedIds.size > 0) {
      raw.nodes = top.kept;
      dropLinksTo(raw, top.removedIds);
      removed += top.removedIds.size;
    }
  }

  const defs = raw.definitions;
  const subs =
    defs != null && typeof defs === "object"
      ? (defs as Record<string, unknown>).subgraphs
      : undefined;
  const list: unknown[] = Array.isArray(subs)
    ? subs
    : subs != null && typeof subs === "object"
      ? Object.values(subs)
      : [];
  for (const sub of list) {
    if (sub == null || typeof sub !== "object") continue;
    const def = sub as Record<string, unknown>;
    if (!Array.isArray(def.nodes)) continue;
    const inner = pickOutUiOnlyNodes(def.nodes);
    if (inner.removedIds.size > 0) {
      def.nodes = inner.kept;
      dropLinksTo(def, inner.removedIds);
      removed += inner.removedIds.size;
    }
  }

  return { raw, removed };
}
