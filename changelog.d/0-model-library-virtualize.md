## Changed

- **模型库列表改定高虚拟滚动（性能，含新增依赖）**：`src/components/studio/ModelLibrary.tsx`
  此前把 `c.filtered` 一次性 `.map` 全量渲染成 `role="listitem"` 行——ComfyUI 用户的
  模型数（LoRA/ckpt 混放）常上百、可上探三位数，每行还带类型药丸 / 模板 class 拼接，
  进入「模型」视图时整批 DOM 一次挂载。抽出 `ModelList` 子组件，用 `@tanstack/react-virtual`
  （新增依赖，纯 JS、无构建脚本，未动 `pnpm-workspace.allowBuilds`）按固定行高 37px 只渲染
  视口内的若干行、DOM 数量恒定（规范 §2.6）。沿用 LogPanel 的兜底口径：滚动容器量不到
  高度（jsdom 不做布局 / 首帧未测量）时退回整页渲染，绝不把「性能优化」变成「内容看不见」，
  `ModelLibrary.integration.test.tsx` 据此仍断言到具体文件名行。行标记（truncate 单行、
  分隔线、不可用徽标、`fmtSize`）与视觉与原实现一致。
  注：`src/components/model/ModelLibrary`（`/models` 路由另一套实现）本次未改，两套并存
  的合并属另一议题（见 §12.12 孪生对）。
