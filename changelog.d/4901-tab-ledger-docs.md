## Fixed

- **16 章混合形态台账的 `tabs` 行与警示注改写（ISSUE #4901）**：#4770 退役顶部页签栏后，该行仍写着「应用级页签 `TitleBar` / `ShellTabs` 已有完整 `role="tablist"` / `role="tab"`」—— 引用的实现已不存在。改为注明现状：应用级切换器是侧栏「临时页签」组（`SidebarTempTabs`，菜单按钮 + `data-active` 高亮，非 `role="tab"` 语义）；`workflow-library` 详情面板三页签仍是干净的 `ui/tabs` 落点。
