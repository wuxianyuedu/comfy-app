## Fixed

- **修 `/workshop` 静态预渲染崩溃（打断 `next build`）**：`src/components/workshop/WorkshopHeader.tsx`
  的 `useHotkey({ key: "Escape" }, closeMenu, { …, target: document })` 在 **render 期**求值
  `document`。它是 "use client" 组件，但 Next 仍会在服务端做 SSG 预渲染——服务端无 `document`，
  于是 `next build` 的 export 阶段抛 `ReferenceError: document is not defined` 直接失败。
  该问题躲过了 pre-commit（仓库 28 门只跑 tsc/eslint/结构测试，**不含 `next build`**），
  只有真正构建桌面包时才暴露。修法：去掉显式 `target: document` —— `useHotkey` 本就在其
  effect 内解析宿主（默认 `window`，对 `keydown` 与 `document` 等价），其文档化的「Esc 关菜单」
  用法也不传 target，故为行为等价的最小修复。验证：`pnpm build` 由红转绿。
