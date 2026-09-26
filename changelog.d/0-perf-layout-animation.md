## Fixed

- 进度类动画改 GPU 合成属性（规范 §2.7 布局属性动画）：`AppUpdateSection`、`progress-bar`（确定态填充）、`water-fill-progress` 水层由 `width`/`height` 动画改为 `translateX`/`translateY`（只触发合成层、不引发重排，圆角由轨道 `overflow-hidden` 裁切）；`progress` 基元的 `ProgressIndicator` 过渡收窄为 `transition-[width]`（base-ui 用 width 驱动，去掉过渡一切的 `transition-all`）。关联测试与快照同步更新（`progress-bar.test.tsx` / `SettingsParts.test.tsx` / `TrainingStudio.test.tsx.snap`）。
- 未改项（说明）：`ui/sidebar.tsx`、`ui/navigation-menu.tsx` 的 `transition-[width/left,right,...]` 是折叠侧栏 / 浮层定位器的一次性（用户显式触发）布局过渡——宽度变化真实影响布局、无法用 transform 替代，且定位器由 base-ui 驱动；性能代价可忽略，本次保持不动。
