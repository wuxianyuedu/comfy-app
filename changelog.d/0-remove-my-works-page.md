## Removed

删除独立的「我的作品」页面及其入口：

- 移除 `src/app/(main)/me/works/page.tsx` 与对应 hook。
- 移除顶部应用菜单中的「我的作品」跳转项。
- 同步清理相关注释引用。

「项目」视图仍在 workspace 左侧导航中保留，继续承担作品聚合功能。

## Fixed

修复首页（workspace home）因 flex 列子项默认 `min-height: auto`
未缩到比内容小而导致的上下内容被裁切问题：为首页 flex 链各环节显式添加
`min-h-0`，使滚动容器能正确收缩并出现滚动条。
