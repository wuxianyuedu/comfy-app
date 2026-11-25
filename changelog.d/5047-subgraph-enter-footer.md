## Changed

- **子图封装节点「进入子图」入口对齐新版 ComfyUI 形态**（#5047）：入口从标题栏右上角的
  24×24 图标章（目标小、与新版观感不一致）迁到**卡片底部的整宽进入条** —— 居中弱化色
  「进入子图」文字 + 登录式图标，上缘细分隔线，悬停提亮；折叠态不渲染。新增
  `SubgraphEnterFooter`，`SubgraphHeader` 撤掉钻入章与 `onEnter` prop；下钻行为本身
  （点击 → `onEnterSubgraph` → 拉子图详情）不变。
