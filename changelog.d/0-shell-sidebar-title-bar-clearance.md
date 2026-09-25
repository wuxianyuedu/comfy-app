## Fixed

- **桌面壳左上角「Comfy-APP」被页签遮住一块**：shadcn `ui/sidebar` 的容器是
  `fixed inset-y-0 h-svh`（钉死视口顶、满高）。桌面壳里 `ShellTabs` 顶部多了一条
  自定义标题行 `TitleBarTabs`（高 `--spacing-title-bar` = 2.25rem），但 fixed 侧栏
  无视这条流内行、仍从视口 top:0 起，于是侧栏头部「Comfy-APP」被压在「主应用」页签
  后面（用户实测：壳里左上角看不见一块）。浏览器 / dev 形态此前没暴露——#982 起
  浏览器不再渲染应用内页签栏，顶部本就没有遮挡物。

  修法：`ShellTabs` 根在壳态（`useTitleBar` 为真）打 `data-shell` 属性；`globals.css`
  加一条顶层规则，把壳态下的 `[data-slot="sidebar-container"]` 的 `top` 让出标题行
  高度、`height` 相应减去（`calc(100svh - var(--spacing-title-bar))`）。顶层非
  `@layer` 规则 + 双属性选择器，压过 Tailwind 的 `inset-y-0` / `h-svh` 工具类。
  浏览器 / dev 无 `data-shell`，侧栏仍从 0 起、行为不变。

## Notes

- 复用既有的 `--spacing-title-bar` token（与 `TitleBarTabs` 的高度、全屏视图层
  `top-title-bar` 让位同源），不新增魔数。
- 浏览器实测：给应用根注入 `data-shell` 后，侧栏容器 computed `top` 从 `0px` 变
  `36px`、`height` 变 `calc(100svh - 36px)`（894px），撤掉属性即回 `0px`——规则
  生效且仅在壳态生效。
