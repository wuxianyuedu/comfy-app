## Changed

- **壳内 ComfyUI 页签的两条契约补上组件层看守（ISSUE #1244）**：新增 `src/components/studio/ShellTabs.test.tsx`（jsdom，6 条），钉住「可嵌 → 内容在**当前窗口的页签里**（`iframe[title=ComfyUI]`，同棵子树里就是那条页签栏）」「不可嵌 → 仍在**同一个页签里**给可读说明（带内容地址），且不塞一个注定空白的 `iframe`」，外加三种页签内容态（说明 / iframe / 空态）、页签切换只切显隐（`hidden` + `aria-hidden`，切回来不重载）与说明里「复制地址」的可见反馈。
  - 壳形态直接打 `__TAURI_INTERNALS__` 标记摆出来（同 `use-overlay-boundary.test.tsx`），不按模块 mock —— 组件树里 `ShellTabs` 与 `TitleBarTabs` 各读一次该判据，ESM 命名导入是活绑定，按模块 mock 要连 store 与 hook 一起假掉才挂得起来。
  - 为什么这半边此前是盲区：e2e 跑的是浏览器形态，而该形态下 `ShellTabs` 不渲染任何应用内页签栏，iframe 与不可嵌说明都只存在于桌面壳里（ISSUE #1243 之后的盘点结论）。
  - 变异核过三条：不可嵌时改回「也塞 iframe」、可嵌时不渲染 iframe、把壳内页签栏从子树里拿掉 —— 各自恰好红一条（第三条红在「同一个窗口」那条计数断言上）。
  - 同批把 `ShellTabs.tsx` 登记进 `vitest.config.ts` 的 `coverage.include` 与 `thresholds`（**两处同批**，隔离实测 100/100/100/100）—— 只在用例里判、不登记数字，下次有人把某个分支改空不会有任何东西变红。
