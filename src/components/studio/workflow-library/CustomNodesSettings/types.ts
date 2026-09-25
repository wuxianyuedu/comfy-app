/* CustomNodesSettings 弹窗各模块共享的类型契约。
 * 服务端产出的协议形状（报告 / 发现子包 / 摘要 / 两个 SSE 事件联合）已上收到
 * `~/lib/comfyui/custom-nodes-stream`（server 与 view 共用地基），此处 re-export
 * 保持所有既有 `../types` importer 路径不变；仅保留视图内部推导出来的类型
 * （RowState / ParseProgress）。 */

export type {
  PkgReport,
  ParseReport,
  DiscoveredSubpkg,
  SummaryPkg,
  SettingsResp,
  SettingsStreamEvent,
  ParseStreamEvent,
} from "~/lib/comfyui/custom-nodes-stream";

/** 每个子包行由发现的条目 + 同路径上已加载的清单
 *  条目共同推导出的视觉状态。 */
export type RowState =
  | { kind: "loaded"; savedHash: string; nodeCount: number }
  | {
      kind: "outdated";
      savedHash: string;
      savedNodeCount: number;
      diskHash: string;
    }
  | { kind: "unimported" }
  | { kind: "error"; reason: string }
  | { kind: "missing" }
  | { kind: "empty" };

/** 两阶段解析进度，以**包**计数表示（**不是**文件数）：
 *   扫描阶段 → discovered 增长；文件遍历结束前总数未知。
 *   哈希阶段 → 已处理 / 总包数。
 * 进度条填充会切换：扫描期间不确定（CSS 动画），
 * 然后当扫描宣布 `total=M` 时跳到确定的 K/M。 */
export type ParseProgress = {
  phase: "queue" | "scan" | "hash" | "";
  done: number;
  total: number;
  discovered: number;
  parent: string;
  msg: string;
};
