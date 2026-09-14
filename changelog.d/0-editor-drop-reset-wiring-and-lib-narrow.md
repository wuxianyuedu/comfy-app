## Removed

- **工作流编辑器顶栏的「↺ 恢复默认映射」按钮去掉**：编辑器不再管「对外参数 → 节点端口」的落点编辑与重置 —— 那件事整个归工作流库详情的「画布节点」页签。编辑器保存时仍把当前 `paramMap` 原样交回去，库内改过的落点不会因为在这里按一次保存被抹掉。随之失去全部消费方的映射编排层 `hooks/use-param-mapping.ts`（含 `useParamMapping` / `validateMapping`）一并删除。
- **`wiredPinKeys` / `reportNodeWiredPins` 上报链路清理**：这条「宿主节点把本帧渲染出来的落点行上报给 store」的通道，唯一消费方是已删除的画布卡片候选端点。现在 store 的字段与动作、`selectWiredPinKeys`、`useWiredPinKeysRegistry`、以及两处节点行（widget 行 / 纯连接行）的上报调用一并删除 —— 节点行渲染不再每帧写 store。
- **`lib/workflow-param-mapping` 里只剩测试在用的卡片几何清理**：`placeParamNodes` / `paramNodeHeight` / `paramNodeId` / `entryIdFromParamNodeId` / `placeOutputNodes` / `outputNodeId` / `outputIoKeyFromNodeId`，以及配套的节点 id 前缀、卡片列宽 / 间距 / 输出列偏移等常量。卡片宽度、端口行高、圆点尺寸这些**仍在用**的视觉常量保留（库内两侧卡片列共用）。
- **编辑器「打开时落到的模式」链路清理**：`initialMode`（编辑器 / 画布编辑器 / 库侧 `editingMode` / 详情页「在编辑器中打开」的入参）删除。它只服务已删除的连线与卡片显示，且库侧 `actions.edit` 本来就只传 id —— 这条参数从未真正生效。

## Fixed

- **工作流库详情面板右侧内容在小屏不再被裁掉（右上角的操作按钮整排可见）**：详情面板是弹性项，缺 `min-w-0` 时 `min-width: auto` 会让它**不肯窄于内容的最小宽度**（面板里的画布预览与卡片列都不小），整行于是比窗口宽、右半部分被根容器的 `overflow-hidden` 裁掉。现在面板带 `min-w-0`（可被压窄，内部画布预览仍可拖动平移 / 缩放 / 「适应」），列表侧栏固定不缩（`shrink-0`）；头部那一排「导入画布 / 模型标签 / 编辑 / 同步 / 源文件 / 下载 / 删除」在装不下时**整组换到第二行并保持靠右**，而不是被挤出可视区（标题区有可读下限，让位的是标题截断）。
