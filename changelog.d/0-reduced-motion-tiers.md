## Added

- **`prefers-reduced-motion` 三档分治落地**（设计契约「冲突 2」的签字执行，规范 06
  §6.7 同步收窄）：`src/app/globals.css` 末尾新增一个**层外**（非 `@layer`）的
  `@media (prefers-reduced-motion: reduce)` 块，按签字的三档处理 ——
  ① **7 处循环动画全部停**（`animate-spin` / `animate-pulse` / `.wf-wave` /
  `progress-bar` 的不确定条 / `AgentOverlay` 的运行中圆点）；② **2 处大位移只归零位移、
  保留淡入**（`sheet-content`、`navigation-menu-content`）；③ **短程 hover/focus 明确
  豁免** —— 125 行 `transition-*` 里 112 行走默认 150ms、位移量为 0，与 WCAG 2.3.3 关心的
  大面积/视差运动不是一回事，全局关掉只会让悬停态变成「无过渡直接换色」。
  签字时否掉的正是「一条 `*{animation:none}` 全局闸门」那一档，所以第 ③ 档不是遗漏而是
  决策，并有用例反向钉住（块里不许出现裸 `*` 或 `transition: none`）。
- **两处必须 `!important`，且理由不是风格**：`ui/progress-bar.tsx:140` 与
  `workshop/AgentOverlay.tsx:209` 都是**内联 `style={{ animation: … }}`** —— 行内样式压过
  层外一切规则，不带 `!important` 这两处会**静默不降级**（用户开了系统「减弱动态效果」
  而它们照转，且没有任何构建/测试会报）。为此给 `AgentOverlay` 那枚圆点补了
  `data-slot="agent-tool-status-dot"`：选择器一律挂 `data-slot`，不按 class 字面量匹配
  （Tailwind 任意值类名会转义、改名即失效）。
- **§6.7 从「所有 transition/animation 都要降级」改成三档表**（`docs/standards/06`，
  生成态 `docs/generated/06` 同批 `pnpm doc:render`）。原句在本仓的实测存量面前等于空话：
  条文要求全覆盖、实现 0 命中，而**零执行者的强制条文比没有条文更坏** —— 它让人以为
  这件事已经做完了。AutoAnimate 那条刻意例外保留，并归到第 ③ 档口径下。
- **执行者**：`tests/reduced-motion-tiers.test.ts` 并进 `FIXED_STRUCTURAL_TESTS`（它用
  `fs` 读 CSS 文本，import 图追不到，挂在受影响层等于零执行者 —— 与 `design-md-contract-sync`
  同因、同 #1372 那一课）。判四件事：块在且非空、① 每档选择器齐且带 `!important`、
  ② 位移归零而淡入不被连带杀掉、③ 不许出现全局一把梭、④ **块里点名的每个 `data-slot`
  在组件源码里真的存在**（这一档才是本用例独有的价值：CSS 选择器指到已改名的 slot 不会
  报错，只会静默不再命中任何元素）。`reduceBlockOf()` 按**花括号配平**切块 —— 块里有嵌套
  规则，「找到下一个 `}`」会在第一个内层闭括号就截断，等于只核到半条规则。
- **判据不空转的证明**：真目标变异一次 —— 把 `globals.css` 里的
  `[data-slot="sheet-content"]` 改成 `sheet-content-renamed-probe`，第 ④ 档当场红并点名
  「降级块指到了空气上」；改回后 8/8 绿。另有用例内三条负控制（缺块返回 null、空块判 0
  长度、嵌套不被截断）与两条扫描面自证（`data-slot` 解析数 > 2、源码文件数 > 100）。
- **另记一笔、刻意不在本刀修**：实测 8 处动画挂在 layout 属性上（`ui/progress`、
  `ui/sidebar` ×4、`ui/navigation-menu` ×3、`RgthreeBodies`），违反规范 02 §2.7。
  它与晕动症是两回事，签字口径明确要求另开一刀，混修会让两笔账都归不清。
