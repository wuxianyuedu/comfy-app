## Fixed

- **画布预览逐 keystroke 全量重渲**（#4467）：「编辑对外参数」页签里，宿主表单每敲
  一个字，左列参数卡片列与右列输出卡片列（含全部卡片、端口行、Handle）整棵重渲染
  一遍，端口多的工作流输入时可感知卡顿。三处同源疏漏同批收口：
  ① `buildParamEntries` 在 `WorkflowCanvasNodePreview` 内联现算（同文件的
  paramCards / outputCards 都已 memo，唯独这份漏了）→ 收进 `useMemo`；
  ② `useLibraryWireFlow` 返回的 `nodeContent` 每次调用都是新对象 → memo 化；
  ③ 三个内容对象在 `WorkflowLibraryCanvas` 内联字面量直传 Provider，且三列节点
  共读**一条** context —— 宿主内容（整张表单）keystroke 之间必然变化，单一
  context 的 value 每帧新建把三列节点的 memo 全部击穿。改为三个内容对象各自
  `useMemo` + context 按列拆成三条（宿主一条、左列一条、右列一条），并把这些
  回调（选中互斥 / 落点重置）收成稳定引用 —— 宿主表单输入只重渲宿主列，
  左 / 右两列的 context value 引用保持稳定。
  隔离契约由 `WorkflowLibraryCanvasNodes.context.test.tsx` 钉住（宿主内容变化
  只重渲宿主列）。
