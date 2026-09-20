## Changed

- 按形态扫出的三条账各收成一处实现（规范 16 §16.2.4.57 ~ §16.2.4.59）：
  - **键盘键判据**（P53）：元素上的键动作收进 `~/components/ui/simple-key-handler`
    的 `simpleKeyHandler`，键名归一收进 `~/lib/keyboard` 的
    `normalizeKeyName` / `isKeyIn` —— 两个落点**共用一份**归一规则，不再各写
    一遍 `e.key === " "` 手写比较（无修饰单键的 `event.key` 是带 Shift 的
    大写字符，能不能命中纯属碰巧）。`preventDefault` 与 `ignoreRepeat`
    成为显式选项。
  - **剥 / 判 SGR**（P54）：`~/lib/log/log-ansi` 补 `hasSgr` 与
    `stripSgr(text, { includePartial })`，横幅色板收成 `BANNER_ANSI` ——
    此前同一条 `\x1b[[0-9;:]*m` 在 4 处各写一遍，而「要不要连残缺颜色码
    一起剥」这条差异没有一处写下来；写侧（横幅）与读侧（会话切分）此前
    各持一份同样的颜色码字面量，写侧改色读侧就认不出自己写的横幅。
  - **驼峰 ⇄ kebab 换算**（P55）：收进 `~/lib/case-token` 的 `toKebabCase` /
    `toCamelCase`；此前判据写在 `zClass` 的表达式里，而它派生的工具类名要
    与 `globals.css` 的 `@theme` 逐字一致 —— 写错时是静默的（Tailwind
    找不到类名不报错，只是那一层没有 `z-index`）。

## Added

- `scripts/check-ui-primitives.cjs` 新增三条硬闸判据 **P53 / P54 / P55**
  （规范 16 §16.2.3 判据表 + §16.2.4.57 ~ §16.2.4.59 台账），一上来就是
  硬闸、不进棘轮基线。
- `~/lib/keyboard` / `~/components/ui/simple-key-handler` / `~/lib/case-token`
  三个新出口登记 `coverage.include` + `thresholds`（按实测值设满档，均 100%）
  与 `check-file-structure.cjs` 的 `DOMAIN_EXEMPT`（三者都是「唯一持有者 +
  任何域消费」的顶层单例）。
