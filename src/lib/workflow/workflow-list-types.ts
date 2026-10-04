/* ── 工作流库列表的**行形状**（服务端路由与视图共用一份）──
 *
 * `workflow.list` 的 payload 此前**没有类型**：服务端在一个 `.map()` 回调里
 * 内联攒对象字面量，视图侧另抄一份 `WorkflowRow` 当作它的「子集」。两份声明
 * 各自演化，漂移全靠双跳断言（`as unknown as WorkflowRow[]`）抹平 —— 而断言
 * 把「字段名与类型逐项对上」这项检查也一起丢掉了：服务端哪天改字段名，视图
 * 不会红，只会在渲染时静默变成 `undefined`（ISSUE #1460）。
 *
 * 本模块把这份行形状**定在一处**：服务端出口按它声明、视图按它取子集。
 * 与 `WorkflowParamMap` 同域（都是「工作流这条链路的数据形状」），
 * 同属 `src/lib/workflow/`。
 *
 * ⚠️ 字段的**运行时形状**是本模块唯一的判据来源，两条已实测的坑：
 *   · `createdAt` 是 `Date` 不是 ISO 字符串 —— `workflow.list` 走 tRPC，
 *     `src/server/api/trpc.ts` 挂着 `transformer: superjson`，`Date` 过线保持
 *     `Date`。定义成 `string` 时没有任何消费点会红，因为没人读它；
 *   · `paramMap` 是 `WorkflowParamMap | null` —— 不是「一层 key → string」。
 */

import type { WorkflowPreview } from "~/lib/comfyui/workflow";
import type { WorkflowIOMap } from "~/lib/workflow/workflow-io-types";
import type { WorkflowParamMap } from "~/lib/workflow/workflow-param-map";

/** 「磁盘与库不一致」的四个手动同步标记。在线行（没有 `sourcePath`）这四项
 *  都为 null/false。 */
interface DiskSyncFlags {
  /** `diskMtimeSec > sourceMtimeSec` —— 磁盘上的文件在上次导入之后被改过。 */
  diskDirty: boolean;
  /** 来源文件在磁盘上已不存在。 */
  diskMissing: boolean;
  diskMtimeSec: number | null;
  sourceMtimeSec: number | null;
}

/** 可执行性标记：`hasRaw` 是「RAW 原件列有没有内容」，`usable` 由它推出。 */
interface ExecutionFlags {
  hasRaw: boolean;
  usable: boolean;
}

/** 列表里的一条工作流（已导入、落库的那些）。
 *
 *  「本地待导入」占位行的形状刻意与它同构（`WorkflowListPendingRow`），
 *  让前端的合并不必做额外适配。 */
export interface WorkflowListRow extends DiskSyncFlags, ExecutionFlags {
  id: string;
  name: string;
  taskType: string;
  /** 一条工作流可以同时声明多个模式；为空时 UI 退回用 `[taskType]` 展示。 */
  modes: string[];
  /** 默认模式码；必须出现在 `modes` 里。 */
  defaultMode: string | null;
  /** 落库时间。**是 `Date`**（superjson 保真，见文件头）。 */
  createdAt: Date;
  /** `paramMap` JSON 列，形状见 `WorkflowParamMap`。 */
  paramMap: WorkflowParamMap | null;
  /** 导入来源在磁盘上的绝对路径；在线行为 null。 */
  sourcePath: string | null;
  /** 该文件落在哪个已配置的 `LOCAL_WORKFLOWS_PATH`（原样路径）下。 */
  sourceRoot?: string;
  /** 分类：有 `sourcePath` 即 local，否则 online；`"local-pending"` 只出现在
   *  「本地待导入」占位行上（`workflow-local-roots` 的 `LocalPendingRow`）。 */
  source: "local" | "online" | "local-pending";
  /** 服务端盖的分类戳（类型元数据的三个派生字段）。 */
  typeLabel: string;
  typeCategory: string;
  typeDescription: string;
  isGenerative: boolean;
  /** 紧凑预览（节点/边/宽高），没有 rawJson 时是空图。 */
  preview: WorkflowPreview;
  /** 用户维护的对外 IO。 */
  workflowIO: WorkflowIOMap;
  /** 挂在这条工作流上的模型标签名。 */
  modelTags: string[];
  /** 服务端检测到来源文件被改名并已自动重指。 */
  diskRenamed: boolean;
  /** 给人读的 `old.json → new.json` 摘要；没改名时为 null。 */
  diskRenamedTo: string | null;
}
