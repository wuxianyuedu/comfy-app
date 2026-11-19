## Fixed

- **参考图装载的「追加端口」候选补全（#4405）**：扇出配置此前只从**已暴露**的
  workflowIO 里找图片口，而多参考图工作流（如 MiniMax H3 的 `images.image_0..4`、
  Text Generate V2 的 `images.image1/2`）的参考图消费口是**没勾选暴露的张量连线口**
  —— 候选为空 ⇒ 封装页签的「追加端口」下拉整格不渲染，「LoadImage → 处理节点 →
  端口」这条链的末端接到哪里（要同时喂几个地方）没有地方可配。
  现在详情载荷新增 `imageInputPorts`（从 rawJson 输入元数据现收全图 IMAGE/MASK
  连线口，`collectGraphImageInputs`），绑定区候选 = 已暴露图片口 ∪ 全图图片族
  连线口（按 ioKey 去重）；装载计划构造（`buildReferenceLoaderPlan`）用同一份
  候选解析目标端口的 nodeId / name，落在未暴露口上的追加端口不再被静默丢掉。
