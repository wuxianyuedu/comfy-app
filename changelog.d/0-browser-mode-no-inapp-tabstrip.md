## Changed

- **浏览器 / dev 形态不再画「应用内页签栏」**：此前 `ShellTabs` 在非桌面壳
  环境（浏览器 / dev）会退回渲染一条 `InAppTabStrip`（顶部一行「主应用」页签），
  占用纵向空间、且与浏览器自带的页签栏重复。现在浏览器形态**不渲染任何应用内
  页签栏**，`ShellTabs` 只承载主应用内容；桌面壳形态仍由 `TitleBarTabs` 接管
  窗口标题行（ISSUE #310 / #200 的形态不变）。

## Added

- **浏览器形态下「打开查看」ComfyUI 改走新浏览器页签**：`comfy-embed.ts` 新增
  纯判据 `shouldUseBrowserTab(isDesktop)`（浏览器 = `!isDesktop` → true）。
  `use-settings-page` 的 `openComfy` 处理函数在**最顶部、任何 await 之前**消费
  该判据——浏览器分支用状态轮询已缓存的 base 同步 `window.open(base, "_blank",
"noopener,noreferrer")` + 成功 toast，**不**再往 `shell-tabs-store` 里开
  comfyui 页签。`window.open` 前置到 await 之前是为了不被弹窗拦截器拦下（脱离
  用户手势）。拿不到缓存 base 才退回 refetch 再开（冷启动罕见路径）。
  - 与 ISSUE #310「点打开查看只出多页签、不弹第二个窗口」不冲突：#310 约束的是
    **桌面壳**里不要弹独立窗口；浏览器里「新浏览器页签」正是该环境的原生多页签
    形态。桌面壳内的内嵌页签路径（`openComfyTab` → `embed`/`blocked`）完全不变。
  - 设置页那个**主动点击**的「在浏览器打开」并列出口（`setting.comfyOpen` →
    服务端 `openComfyUi`）也照旧保留，与这里无关。

## Notes

- 删除了 `ShellTabs` 里随之失效的 `InAppTabStrip` / `TabButton` 组件及
  `X` / `simpleKeyHandler` / `TITLE_BAR_CHROME_CLASS` / `TITLE_BAR_HEIGHT_CLASS`
  等 import；`TabBlockedNotice`（桌面壳内嵌失败时的页签内说明）保留。
- 同步清理三处提到 `InAppTabStrip` 的注释（`globals.css` 标题行高度注释、
  `full-screen-layer.ts` 的 `TITLE_BAR_HEIGHT_CLASS` 注释、`comfy-embed.ts`
  自身文档），改为只提 `TitleBarTabs`。
- 测试：`comfy-embed.test.ts` 补 `shouldUseBrowserTab` 两态用例；
  `use-settings-page.test.ts` 把 `isDesktopShell` mock 成可控（默认 true，
  保住原「页签形态」用例），新增「浏览器形态走新浏览器页签」describe——断言
  运行中 → `window.open` 被以正确参数调用且**不**开 comfyui 页签、未运行 → 不开
  页签且给可行动提示。
- 浏览器实测：dev 形态下顶部「主应用」页签栏已消失（`inAppStripPresent:false`）、
  控制台无报错。`window.open` 那条端到端路径因本机 ComfyUI 未运行（按钮禁用）
  未在浏览器里点验，由上述单测覆盖。
