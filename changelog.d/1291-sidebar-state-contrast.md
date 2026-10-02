## Fixed

- **侧边栏的悬停与选中在深色下无法分辨，且选中效果偏弱**（ISSUE #1291）。根因不是透明度调得小，而是**两颗 token 放在一起时的相对亮度**：shadcn 别名 `--sidebar-accent` 一路转发到通用表面 token `--color-subtle`，而那颗 token 的深色档 `#141419` 与侧栏底 `--color-panel-deep` `#0f0f16` 只差 **1.04:1** —— 悬停与选中在深色下等于没有反馈（浅色档 1.06:1 已偏弱）。第二层原因是官方基元里**悬停与选中共用同一档底色**，两级状态在结构上就不可分辨，「选中偏弱」是必然结果。
  - 修法：侧栏出**一组专用 token**（`--color-nav-hover` / `--color-nav-selected`，别名 `--sidebar-accent` / `--sidebar-selected`），不再搭 `--color-subtle` 的车 —— 那颗 token 还被 `.u-chip` / `.u-ghost` / `.u-input` 消费，就地改值会把浮层与输入框一起拖下水。两态取到「相对侧栏底确实看得出」的档位：浅色 悬停 1.14:1 / 选中 1.42:1，深色 悬停 1.35:1 / 选中 1.88:1。
  - 选中态再加一根**品牌色指示条**（`before:` 伪元素，`bg-primary-strong`）：只靠底色深浅区分的话色觉障碍用户看不出选中在哪一项，指示条是形状/位置通道、与色彩通道正交（规范 06 §6.3 / WCAG 1.4.1）。指示条取 `--color-primary-strong` 而非 `--color-primary` —— 后者压在选中底色上实测只有 2.73:1（浅）/ 2.32:1（深），低于 WCAG 1.4.11 对「传达状态的图形」要求的 3:1，等于这根条子自己也不够显眼；`--color-primary-strong` 实测 4.43:1 / 3.74:1，两态都过。
  - 指标条用伪元素而非额外 DOM：`SidebarMenuButton` 被全库多处复用，加一个必须自己渲染的子元素会变成每个调用点都要记得带上。落点留在按钮内左侧（`left-0`）**不**外移到容器 padding 槽 —— `SidebarContent` 在图标档带 `overflow-hidden`，外移会被裁掉、折叠档下选中提示直接消失。

## Tests

- `tests/sidebar-state-contrast.test.ts`（新增）：从**真编译产物**（`tests/helpers/theme-tokens.ts`，自己解析 `var()` 链）量三态底色的 WCAG 相对亮度比 —— 悬停/选中 vs 侧栏底各有下限、选中还必须比悬停明显（「选中偏弱」的直接判据）、正文 ≥4.5:1、指示条 ≥3:1，外加「别名没有退回 `--color-subtle`」的反向判据。变异核过：把两档改回 `#141419` → 4 条红（深色 1.0396:1 正是修复前的数）。
- `tests/sidebar-selected-state.test.tsx`（新增）：只钉接线 —— `isActive` 是否真的接到选中档（`data-active:bg-sidebar-selected`）、有没有带上指示条、未选中时 `data-active` 不落上。变异核过：把选中档退回悬停档 → 当场红（prop 传得对但看不出差别，正是修复前的形态）。
- `tests/theme-token-single-source.test.ts`：新别名 `--sidebar-selected` 登记进 `ALIASES`（该用例的既有反例闸门拦下了裸自定义属性，属预期）。

## Docs

- `src/app/globals.css`：新增两档 token 的取值理由（含两态实测数字、为什么不能与 `--color-subtle` 合并、以及项目 token 为何叫 `--color-nav-*` —— `@theme inline` 的单向转发若同名会成环，`tests/helpers/theme-tokens.ts` 的环检测会直接报出来）。
