## Changed

- **移除画布顶栏的项目切换器（Phase 2b）**：承接 ADR §11「切换项目只在首页」——画布此前左上角有 `ProjectSwitcher`（切换 / 新建 / 重命名 / 删除项目），与工坊侧同类切换器一起构成「项目到处都能切」的割裂感。现在画布只展示 / 编辑当前活跃 `proj_*`，项目的新建 / 切换 / 删除统一收归首页。`ProjectCanvas` 去掉 `useProjectManager` 接线与「删除此项目」确认框，只保留自动持久化；`ProjectSwitcher.tsx`、其测试、`use-project-manager.ts` 随之无消费方，一并删除。
