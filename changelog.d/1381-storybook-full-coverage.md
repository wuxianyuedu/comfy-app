## Added

- **组件工作台的组件覆盖率补到全量：`ui/` 87/87**（story 34 → 86 份 / 337 条），
  `scripts/storybook-checks/coverage-ledger.mjs` 的理由表**清空**（5 条 → 0 条）。
  本批新增 51 份 story，逐件按「它此前为什么没有 story」补：
  - **shadcn 基元族**（此前只是没人写）：`accordion` / `breadcrumb` / `button-group` /
    `card` / `command` / `context-menu` / `dialog` / `dropdown-menu` / `empty` /
    `hover-card` / `input-group` / `item` / `label` / `menubar` / `navigation-menu` /
    `pagination` / `popover` / `radio-group` / `native-select` / `resizable` /
    `scroll-area` / `select` / `separator` / `sheet` / `slider` / `range-slider` /
    `table` / `tabs` / `textarea` / `toggle-group` / `tooltip`；
  - **应用级复合件**：`sidebar`（806 行的全家桶，四件事逐档给出）/ `fullscreen-dialog` /
    `confirm-dialog` / `settings-card` / `editable-label` / `multi-mode-select` /
    `key-value-rows`（四档 layout 并排）/ `code-block` / `tree-rows` /
    `expansion-set` / `media-drag-source` / `wide-panel` / `aurora-background` /
    `file-picker` / `number-field` / `disclosure`；
  - **此前记在理由表里的那 5 条**：`progress`（`ProgressLabel` / `ProgressValue`
    两个 slot 在 `progress-bar` 里看不到）、`sonner`（story 里**真调** `toast()`）、
    `error-boundary`（配一个会抛的 `Boom`）、`dialog-overlay` / `dialog-width`
    （出口算出来的字符串就是它的对外面）。
- `ui/dialog-overlay.stories.tsx` 的「它不做什么」之外，新增
  `docs/guide-storybook.md` 的「理由是补法还是不能写」一段。

## Changed

- 覆盖率判据的「在空转」信号**从理由表挪回实测那一侧**：`scripts/storybook-check.mjs`
  原先有一条「`NO_STORY_REASON` 是空表 = 判据在空转」的守卫，表真的清空之后它会
  **要求人凑一条假理由**（正是这套棘轮最不该鼓励的事）。换成一条双向不变式 ——
  **表空 ⟺ 覆盖率已满**：两边单独成立都不合法（表空而覆盖率不满 = 有人把理由删了；
  表满而覆盖率已满 = 有人把干净的账留在了表里）。同批的口径写在规范 16 §16.2.3.7。
- `scripts/storybook-checks/coverage-ledger.mjs` 的 `NO_STORY_REASON` 从
  `new Map([…])` 改成显式注解的空 `new Map()` —— 空数组字面量会被推成
  `Map<any, any>`，用例里读 `reason.length` 会变成 `no-unsafe-member-access`
  （判据自己的红会拦下所有人的提交）。

## Fixed

- **`cvaVariantKeys` 按「整文件同名轴取并集」比较的真缺陷**：`ui/item.tsx` 里有
  两处 `cva()`，`itemVariants.variant` 是 `default|outline|muted`、
  `itemMediaVariants.variant` 是 `default|icon|image`。取并集会让一份**正确**的
  清单被判成「缺 icon / image」，而修法无处可去（补上那两档，`itemVariants` 那一处
  又该报「多」）。改成按**绑定名分组**（新增 `cvaVariantKeysByBinding`），story 与
  **其中任意一处**逐字对上即通过；门禁脚本、契约用例与它们的回归用例同批改。
  `ui/input-group.tsx` 是同一族的第二例（`align` / `size` 两处轴名不同、当时侥幸没暴露）。
- `tests/storybook-check-script.test.ts` 那条「理由表指向不存在的文件」的**变异正则**
  原先锚在 `new Map([...])` 的**字面量形状**上 —— 表一变空，正则静默失配、变异不生效、
  这条判据就在空转（正是它要拦的那族失效）。改成锚在**导出行**上，并加一条
  「变异没生效 = 红」的断言。

## Documentation

- 规范 16 新增 §16.2.3.7「覆盖率的终点：`ui/` 87/87，理由表清空」（含那 5 条理由
  各自的补法与「判据改成双向不变式」的理由）；
  `docs/guide-storybook.md` 的覆盖率一节补「表空 ⟺ 覆盖率满」与「加新 story 之前
  先看什么」；`PRODUCTION-GAPS` 的 F6 同步。
- 本批 337 条 story 全部在**真浏览器**里逐条打开核对（构建退出码说明不了「画布上
  画没画出来」—— §16.2.3.4 那轮「侧栏有故事、画布一片空白」就是这么漏过去的）。
