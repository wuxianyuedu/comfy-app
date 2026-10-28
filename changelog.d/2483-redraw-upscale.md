## Added

- **带修改的重跑：局部重绘 / 放大重出（FR-QA-09 · #2483）**：
  - 历史详情弹窗对图片产物新增「放大 / 局部重绘」面板：模式二选一——
    放大 = 原图整张重出；局部重绘 = 画蒙版（`MaskCanvas`：黑底白笔、
    画笔三档 + 清空，白色为重绘区）后提交。
  - 提交形状：原图（重绘另加蒙版）走 `referenceImages` 的契约槽
    （模板第一个图像口 = 原图，第二个 = 蒙版），`parentId` 指回原任务，
    提示词预填可改；复用 `prepareLocalInputImage` 上传与
    `startLocalGenerate` 提交，任务照走既有 task 链路。
  - 追溯：`task` 表新增 `parentId` 列（入参 schema 放行、router 落库），
    产物元数据面板显示「来源任务」；常规提交为 NULL。
  - 模板口径（与立案文案的偏差，如实）：**不内置硬编码 inpaint / upscale
    模板**——工作流库是唯一模板来源（`generate.ts` 自注「内置模板已移除」），
    模板由用户从库中选，面板给口径提示；选了没有图像输入口的模板时，
    执行侧 unmatched 读数会说明值没落上。
- 需求文档同批：FR-QA-09 翻「已上线」（catalog 状态与 §3 缺口索引、specs
  验收与落点、pipeline-stages 阶段④缺口行）。
