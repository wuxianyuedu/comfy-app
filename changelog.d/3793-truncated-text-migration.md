## Fixed

- **把剩余截断文本接上 TruncatedText（悬停看全文），以及 Rich 节点走 Hint（#3793）。**

  #3790 落地了 `~/components/ui/truncated-text` 的 `<TruncatedText>` 基元与一批落点后，全仓还有
  ~180 处文本截成省略号却不给任何读全出口（原生 `title=` 又被 P88 判违规）。本轮按逐处判断收口：

  - 把**用户需要读到的**纯文本值（模型/节点/任务/日志源/路径/元数据/设置项/工坊参数等，共 45 处）迁移到 `<TruncatedText>`；
  - 组合子节点（标题 + 徽章、键值行值 + 徽标、带富文本行的标题/副行等，约 30 处）不迁进 TruncatedText（它要求纯文本），
    改走 `<Hint label=…>` 给全文（#3790 口径，P82/P88）；
  - `KeyValueRows` 的值截断行补上 `title`（悬停全文）；
  - canvas 节点 / 日志行等**本就截断并自带 `<Hint label={全文}>` 的处置，保持现状**（全文早已能在悬停里读到，迁移无增量）；
  - 「故意截断、不出提示」的（画布设置面板静态文案、图标轨/状态轨 class 串、静态注册表文案、demo 样例）保持现状。

  附带：UI 基元层 `option-list-popover` / `multi-mode-select` / `page-header` 的 `{item.label}` / `{title}` 同批接上悬停全文。
