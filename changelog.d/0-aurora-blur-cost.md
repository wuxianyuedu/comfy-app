## Fixed

- **装饰性极光背景的合成成本（`src/components/ui/aurora-background.tsx`）**：
  三层铺满视口的 `blur(40px)` / `blur(50px)` / `blur(60px)` 光晕，再叠
  `mix-blend-screen`（强制整屏重新合成）；它被 workspace 页、模型库、产出页、
  历史记录、作品画廊**常驻渲染**，滚动与页面切换时都要重新光栅化这几大片高斯模糊。
  现在把高斯核降到 24 / 28 / 32px（用放宽到 74% 的渐变软边补回边缘柔和度），
  并给整层加 `contain: layout paint` 做重绘隔离 —— 页面内容变化不再连带重算它。
