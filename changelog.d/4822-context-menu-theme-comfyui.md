## Added

- 应用内右键菜单新增「ComfyUI」组（#4822）：组内两档卸载 ——「卸载模型」
  （`freeMemory=false`，只卸显存里的模型权重）与「卸载模型和执行缓存」
  （`freeMemory=true`，连执行缓存一起释放）。动作走既有 `setting.comfyFree`
  端点，结果信封的 detail 进 toast；两项共享 busy 态防并发双发，点完菜单即收起。
  逻辑按 §16.2.1 收进 `app-context-menu/hooks/use-comfy-free.ts`（视图层不直接
  调 tRPC options）。

## Fixed

- 右键菜单配色不再写死浅色：容器 / 菜单项 / 悬停 / 分隔线 / 图标改用 `dark:`
  变体跟随明暗主题（暗色对齐 Chromium 暗色菜单：深底 `#292a2d`、浅字
  `#e8eaed`、悬停 `#3c3b40`）。此前暗色主题下菜单仍是白底黑字。
