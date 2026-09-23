## Added

- **引入官方 `sidebar` 基元**（`ui/sidebar.tsx` 725 行 + `ui/use-mobile.ts`）：UI 框架主线「侧栏 + 顶部工具条」的前置件。**零新依赖**（dry-run 的 Dependencies 只有 `cn`）；`--sidebar-*` 主题 token 仓库里早已齐备（`globals.css` 的 16 行 `--sidebar-*` / `--color-sidebar-*`，语义映射到 `--color-panel-deep` / `--color-ink` 等），不需要补 token。

  引入流程照 §16.8：走 `shadcn add sidebar --view <path>` 取官方**原始内容**（含 CLI 自报行数校验），不跑 `add` —— 依赖链会覆盖 9 个既有文件（`button` / `input` / `separator` / `skeleton` / `tooltip` / `breadcrumb` / `dropdown-menu` / `avatar` / `sheet`，其中 `button` / `dropdown-menu` / `sheet` 是台账里的定制件）。本次**一个既有文件都没动**。

- **`~/lib/browser-storage` 新增 `writeCookieItem(name, value, maxAgeSeconds)`**：本模块是「把一件小事留下来」的唯一出口，cookie 是 localStorage 之外的第二条通道 —— 它唯一不可替代的能力是**服务端读得到**（`next/headers` 的 `cookies()`），也就是随后给 `SidebarProvider` 传 `defaultOpen` 的前提（首屏即用户上次选的那档，不必等水合）。函数注释写清了它与 localStorage 的分工与代价（所有 cookie 共享一个名称空间、有效期必须显式给、清理粒度与「清除本地存储」是两个开关），并说明读侧为何不在这里提供（服务端读走 `next/headers`，客户端读只能作为水合后的修补，两者都不是「读一件小事」这个形状）。

## Changed

- **`ui/sidebar.tsx` 相对官方有 4 处改造**（待 §16.8 台账机制合并后登记并加 `ui-customized` 标记）：

  1. `useIsMobile` 落点：官方 `src/hooks/use-mobile`（§12.5 明令顶层不建 `src/hooks/`）→ `~/components/ui/use-mobile`，与 `use-hotkey` / `use-scroll-follow` / `use-wide-panel` 同处；
  2. 开合态写入：官方裸写 `document.cookie = …` → 走 `writeCookieItem`（持久化唯一出口）；cookie 语义不变，`max-age` 从官方 **7 天改为 1 年**（与 `useWidePanel` 的加宽档同语义：记忆型偏好不该自己过期）；
  3. ⌘/Ctrl+B：官方自注册 `window.addEventListener("keydown")` → 走 P20 唯一出口 `useHotkey` —— 顺带修掉「在输入框里按 ⌘B 被 `preventDefault()` 抢走并开关侧栏」（`useHotkey` 默认 `filterInput`）；
  4. 注释全部中文化（9 行，含 1 行 JSX 注释 `{/* … */}` —— 正是 `check-comment-language` 头注点名的那个「早期判据盲区」形态）。

- **`ui/use-mobile.ts` 改用 `useSyncExternalStore`**：官方是 `useState<boolean | undefined>(undefined)` + 在 `useEffect` 体内同步 `setIsMobile(...)`，被 `react-hooks/set-state-in-effect` 判「在 effect 里直接 setState」（级联渲染），且首帧 `undefined` 会逼调用处写 `!!isMobile`。改成与 `useWidePanel` / `useCanvasSettings` 同一套机制：首帧即有确定值，服务端快照显式给 `false`（桌面壳与浏览器桌面尺寸一致，首屏按非窄窗渲染）。
