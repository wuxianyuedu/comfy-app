## Fixed

- **`jsx-a11y` 从「半开」对齐到官方 `recommended`，并给它一个执行者（ISSUE #1498）**：
  这个插件装着 39 条规则，而 `eslint-config-next` 只启用 6 条、全是 `warn` —— 锚点没有
  可访问内容、`<video>` 没有字幕轨、`autoFocus`、组件化 `<label>` 的关联、非原生元素上的
  交互这些**本来会响的真形态**，一条判据都没有；而「半开」这件事本身也没有任何东西在数
  （`grep -c jsx-a11y eslint.config.js` 是 0，配置在 next 里）。
  现在 `eslint.config.js` 的 `a11yRecommendedRules()` **从插件自己的数据**算出官方
  `recommended` 集合并全部升成 `error`（不手抄规则表，插件升版即跟着走）；
  与本仓默认不同的每一处（`no-autofocus` / `label-has-associated-control` 两条方言 +
  12 处就地豁免）逐条登记进 `scripts/.a11y-rule-ledger.json`，答出「为什么」与
  「谁在守它」。新增 `scripts/check-a11y-rules.cjs` 三向核（官方集合全开 / 方言必须真的
  关着 / 被关掉的必须登记）并接进 pre-commit 的 D 组与固定清单。
  顺带：`ui/pagination` 接上日志面板页脚（此前是裸 `span` 串两个按钮，读屏器读不出
  「这是一组分页控件」）；`ui/media-thumbnail` 的 `<video>` 补 `aria-label`、
  `<img>` 补装饰态 `aria-hidden`；`AttributeMultiSelect` 的选项行补 `tabIndex`。
