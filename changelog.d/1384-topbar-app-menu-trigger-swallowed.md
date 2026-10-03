## Fixed

- **顶栏「应用菜单」点不开下拉**（ISSUE #1384）：`TopBar` 把 `<Hint>` 写进了 `DropdownMenuTrigger` 的 `render`，而 menu 的触发 props（`aria-haspopup` / pointerdown / 键盘处理）是**以 props 形式灌进 `render` 收到的那颗元素**的 —— `Hint` 只吃 `label` / `side` / `accessibleName` / `wrap` / `children`、不转发任意 props，于是这串 props 全落在它门口被丢掉，按钮长着按钮的样子却什么都不做（浏览器与桌面壳一致，与壳无关）。
  - 修法是**调换嵌套顺序**：`<Hint>` 在外、`DropdownMenuTrigger` 在内，两层 `render` 合并到同一颗 `<Button>` 上，互不吞并。
  - 判据 ①（jsdom，`pnpm test` 覆盖）：`TopBar.test.tsx` 断 `aria-haspopup="menu"` —— 它是**渲染结果属性**，不依赖 pointerdown，所以 jsdom 拿得到证据；`data-slot` 被 tooltip 接管是已知无害的副作用（`tooltip-trigger`），**不能**拿来判「接管成功与否」。
  - 判据 ②（真浏览器，`e2e/top-bar-app-menu.spec.ts` @critical）：点开后 `role="menu"` 可见且含 `menuitem`「设置」。jsdom 判不了这一条 —— 那边连一个光秃秃的 `DropdownMenuTrigger` 都点不开（开合挂在 pointerdown 上），写在 jsdom 里只会得到一条永远绿的假判据。两条判据在修前**都红**、修后**都绿**（已 A/B 核过）。
- `ui/hint.tsx` 的文件头补一条反面用法：**不要把 `Hint` 当别的基元 `Trigger` 的 `render` 承载体**，并写明正确顺序与两条回归判据的出处 —— 原先那份注释只记了 `data-slot` 互相覆盖，没提「外层还有一个别的触发器时会把它的 props 一起吞掉」，正是这个缺口让缺陷形态看起来像接管成功。
