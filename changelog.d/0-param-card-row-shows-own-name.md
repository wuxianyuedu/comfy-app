## Changed

- 工作流库「画布节点」页签的对外参数卡片：端口行只显示**这个对外参数自己的名字**
  （「提示词」「高度」）+ 类型徽章，不再显示 ComfyUI 内部的 pin 名（`value` /
  `text_1` / `positive_prompt`）。这一行说「这个口是什么、出去是什么类型」，落到
  工作流的哪一行由连线表达；pin 名退到行的 `title` 提示里可查。
- 卡片标题与端口行读同一个名字：`paramOutputPorts` 新增 `displayName` 入参，由卡片列
  把契约口清单的展示名传下去（此前行上读 `entry.label` 与标题读契约名会各说一个名字）。
- 对外**输出**参数卡片不受影响 —— 那里端口名就是作者要看的名字（`images` /
  `IMAGE_FINAL`），`ParamOutputPort.display` 缺省即回落到 `name`。
