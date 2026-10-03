## Added

- **品牌渐变收口：`.btn-gradient` 走 token，`Button` 补 `variant="gradient"`**（设计契约
  「待定 4」的签字落地，`docs/DESIGN.md`）：`globals.css` 里那三条字面量
  `#7c3aed / #c026d3 / #ec4899` 中，**两端与现有 token 逐字同值**（分别就是
  `--color-primary-600` 与 `--color-accent-soft` 的浅档），只有中间那颗没有名字 ——
  所以只新增 `--color-accent-deep: #c026d3`（**两态同值**，理由写进 `@theme` 注释：
  品牌渐变不随主题换色相），三段一律 `var()` 引用 ⇒ **改品牌色时这条渐变跟手**。
  `Button` 新增 `gradient` 档（= `btn-gradient text-on-brand`），4 处 `<Button>` 调用点
  从「`variant="ghost"` / 默认档 + `className` 叠 `btn-gradient text-white`」收进变体；
  `CanvasNodePrimitives.tsx` 那处**不是 Button**（画布节点内的共享 class 常量），保留
  直接写类名 —— 定义只有一处这件事已经成立。
- **一处要接受的观感变化**：终点 `--color-accent-soft` 自带深档 `#ff8ac4`，所以
  **暗色主题下 CTA 渐变比以前亮一档**（浅色逐字不变）。这是「跟着品牌 token 走」的直接
  后果，不是笔误，已写进契约的 Components 段。
- **变体刻意不带 `hover:bg-*`**：hover 观感由 `.btn-gradient` 的
  `filter: brightness(1.08)` 提供，而 utilities 层压过 components 层 —— 再叠一层
  `hover:bg-*` 会把它的 transition 整条洗掉（规范 03 §3.8.1.0 那条「同族打同族看产序」
  的同一形态）。
- **随批订正契约里六处被新读数否掉的主张**（都是实测，命令在文末「取证方法」）：
  `.u-*` 扁平工具层八个类**全仓零消费者**（量具自证：同法在 `u-title` 上抓到 26 处、
  `u-title-page` 17 处）⇒ 上一版写的「输入框有两套形态」是错的，实际只有一种；
  `transition-*` 存量是 **125 行**（不是 113）且仅 13 行带显式时长，真·infinite 循环
  只有 **7 处 / 6 文件**（按 `animate-spin` grep 会翻倍，因为四个命中里两个是注释）；
  另**独立记下一笔** —— 8 处动画挂在 layout 属性上，违反规范 02 §2.7，与 reduced-motion
  无关、不混修；`--shimmer-` 那条白名单**不是死豁免**，声明在
  `node_modules/shadcn/dist/tailwind.css:620`，只是判据读的是 `globals.css` 源码；
  `Sarasa Gothic SC` 的前提被推翻 —— 本机 `C:\Windows\Fonts`（563 个文件，可读）与用户级
  字体目录**都没有它**，所以那条不是「装机才回退」而是**从来没在任何机器生效过**，
  15 处 `font-title` 一直渲染 Geist + 系统 CJK；圆角那一刀的真实影响面量清为 **706 处**
  变档（`rounded-lg` 364 处 +4px 是主力），同时记下「全站圆角改档几乎测不住」
  （全仓只有 2 处 `toHaveScreenshot`、playwright 不进 pre-commit、`e2e/**` 里
  `borderRadius` 断言 0 处）。
- **三条签字已记进契约**（另两条待落地）：圆角认 8/12/16/20 为设计意图（直接改 + 人眼
  看一轮，接缝 2xl 待定）、动效按三档分治（循环与大位移补降级、短程 hover 豁免、
  §6.7 收窄）、标题字体随包内嵌子集（先定子集范围与许可，另要过产物层那两道白名单）。
