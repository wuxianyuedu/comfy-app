## Removed

- **`GroupedControls.tsx` 里手抄的整行区头**（16 行 → 1 行）：那枚「计数胶囊」此前被
  记成一对孪生（`SectionHeader.tsx:23` / `GroupedControls.tsx:101` 类名逐字相同），
  实际抄的比计数多得多 —— 强调圆点、大写标签、计数胶囊、虚线分隔一整行都重抄了一遍，
  而 `DynamicWorkflowForm/SectionHeader` **本就是那一行的具名件**（文件头写明「IO 编辑 /
  预览模式下两处子区共用的区头」，另有 `DynamicWorkflowFormView` 与 `IoEndpointsSection`
  两个消费者在走它）。所以这一刀不新造基元，只是删抄 + import（§12.18）。
  为什么机器判据没抓到它：`check-code-duplication.cjs` 的门槛是「重合 ≥75% **且**两边
  ≥60 行」，这一对只有 16 行 —— 小尺度孪生落在字面判据的射程之外，只能靠形状登记表守。

## Added

- **「只许有一个出处」判据加到四族**（`tests/design-md-contract-sync.test.ts`，固定清单
  成员）：序号圆 / 类型 chip / 节点右侧胶囊 / **区头那一行**。用例名改成
  `${FAMILIES.length} 族`，加一族不必再改标题。
  区头那族的标记刻意**不含**计数胶囊单独一项：`WorkflowIOPreviewPanel.tsx:206` 有一枚
  同形、只差底色（`bg-subtle` vs `bg-surface-2`，它坐在 `bg-panel` 浮层上）的计数，
  那是合理分叉不是孪生 —— 已把它的整行写成**反向样本**登记进负控制（被误抓即判据太松）。

## Changed

- 契约里订正一条被本轮否掉的主张：徽标家族「明确排除」表里那行还写着那两个站点
  「该抽自己的基元」，而基元一直在那里，缺的是有人用它。
