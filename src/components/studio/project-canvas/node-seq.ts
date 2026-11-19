/**
 * node-seq.ts — 画布节点「短序号」（#1 / #2 …，= 节点在画布节点数组里的下标 + 1）
 * 的唯一算法。画布节点头部与日志面板的任务切换器都靠它把 taskId / nodeId 翻成
 * 人类可读的序号，因此收在一处，避免两处各写一遍 `findIndex`。
 */

/* 按「节点数组引用」记忆整张映射表：选择器本体在 store 每次更新时都会执行，
 * 拖拽 / 平移每帧换一份 nodes 数组 —— 每个节点各自 `findIndex` 就是每帧 O(N²)，
 * 节点一多画布就拖不动。缓存后同一帧内只有首个查询重建映射（O(N)），其余查表 O(1)。
 * 只保留最新一份数组引用，不随帧数增长；纯派生数据，丢了下一帧重算，无需失效逻辑。 */
let cached: {
  nodes: ReadonlyArray<{ id: string }>;
  seqById: Map<string, number>;
} | null = null;

/** 取节点短序号（1 起）；节点不在当前数组里返回 null。 */
export function nodeSeqOf(nodes: ReadonlyArray<{ id: string }>, id: string): number | null {
  if (cached?.nodes !== nodes) {
    cached = {
      nodes,
      seqById: new Map(nodes.map((node, index) => [node.id, index + 1])),
    };
  }
  return cached.seqById.get(id) ?? null;
}
