## Fixed

- **工作流表单：视频组渲染出重复 React key**（ISSUE #4927）：`inferVideoGroup`
  按角色挑 pin 时没有同 ioKey 防撞，节点上两个同名 pin（如 `value_1`）分别标
  「时长」「比例」（或一个 pin 同时命中两个角色关键字）时，`VideoControl` 会拿
  同一个 ioKey 当 React key 渲染两行（控制台重复 key 告警，子元素可能复制 / 丢失）。
  现在按「时长 → 比例 → 画质」取候选时同一 ioKey 只进一组，比例 / 画质被撞得
  一个不剩时整组不认、退回通用逐行渲染——与 `inferDimensionGroup` 的同 key
  守卫同一口径；同批补四条防撞用例。
