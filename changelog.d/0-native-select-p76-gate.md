## Added

- **UI 基元棘轮新增 P76「视图层裸写 `<select>`」（棘轮，`scripts/check-ui-primitives.cjs`）**：
  P68 拦住了裸 `<input>` / `<textarea>`、P69 拦住了裸 `<input type=checkbox|radio>`；
  `<select>` 是同一族里的漏项。项目里已有两个合规出口——
  `~/components/ui/native-select` 的 `<NativeSelect>`（保留原生外观 + 统一样式与
  a11y 契约）与 `~/components/ui/select-menu` 的 `<SelectMenu>`（Base UI 派，
  与项目里其它富 ReactNode 标签的下拉同一口径）。视图里出现 `<select` = 这个
  文件在**第三处**手拼同一件事。判据按形态取（`<select` 标签起始形态 +
  空白/`>`/`/` 之一），不误伤 `selectedValue` / `select-none` / `onSelect` 这类
  同前缀标识符与类名；`ui/native-select.tsx` 走 `EXEMPT_DIRS` 天然豁免。

  走棘轮（非硬闸）：本批评据上线时视图层实测 **10 个文件、11 处** 存量，冻结
  起点、只许降。下一批按域分片把每个 `<select>` 迁到上述两个出口之一，与 P71
  的引入节奏一致（先冻结、后治理）。差分回归 3 例见
  `tests/check-ui-primitives.test.ts`：视图裸 `<select>` 阻断 / `ui/native-select.tsx`
  豁免 / `selectedValue`+`select-none`+`onSelect` 不误伤。

  P72 / P76 编号跳空是**有意**的：P73 / P74 / P75 预留给 Separator / Alert /
  EmptyState 三条同批的判据、下一批落地。
