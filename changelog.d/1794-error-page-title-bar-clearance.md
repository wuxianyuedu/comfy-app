## Fixed

- **错误页 / 404 / 登录页的整屏铺法盖住了壳里右上角的关闭按钮（ISSUE #1794）**：桌面壳关掉原生装饰后，最小化 / 最大化 / **关闭**由标题行 `TitleBarTabs` 承担（高 36px、贴视口顶），而 `app/error.tsx` / `app/global-error.tsx` / `app/not-found.tsx` / `app/loading.tsx` 一直写 `min-h-screen`（壳里 = `100svh`，从视口顶起算）——用户看到「页面出错了」的同时，右上角的关闭按钮也点不到了。四处（含 `app/login/page.tsx`）统一改用 `~/lib/full-screen-layer` 新增的 `FULL_PAGE_CLEARANCE_CLASS`（让出标题行、高度收到内容区、页面自己滚）。
- **`check-title-bar-clearance.cjs` 补第四条规则**：此前它只管浮层（`fixed inset-0` 与锚定浮层），**路由页不在射程里**——这正是本次回归从人眼前溜过去的原因。现在 `src/app/**` 里出现 `min-h-screen` / `h-screen` / `h-svh` 之类的视口高度字面量即阻断（要求与内容区高度同源），注释行豁免。
