## Changed

- **旧品牌紫在视图层的 21 处按角色分治完毕，「与品牌 token 同值」那类主张被门禁收掉（ISSUE #1717）**。
  上一笔品牌紫深化（#1715）把 `--color-primary` 从 `#7C5CFC` 改成 `#8557de`，而四处
  「与品牌 token 同值 / 1:1」的说法（**三条 `EXEMPT_TABLES` 登记理由 + 一处代码注释**）
  当场变成假话 —— `pnpm theme:check` 那时全绿，因为它数裸值、**不读理由**。
  拍板的口径是**按角色分治**，不是整片选一头：

  | 角色 | 站点 | 处置 |
  | --- | --- | --- |
  | 品牌用途 | `CanvasNode` 选中高亮环 + 两层光晕、`CanvasContextMenu` 的 W 徽标双色渐变 | **跟手**：改成 `var(--color-primary)` / `var(--color-accent)`，光晕强度走 `color-mix(… N%, transparent)`；两条豁免理由随之改写、`CanvasContextMenu` 那条整条删除（它已一处都不命中 = 死豁免） |
  | 端口 / 类别类型色 | `WorkflowPortHandle`(4) + 它的 chip 用例(1)、`WorkflowNodeArdot`(3)、`ContentAssetNode`(2)、`custom-nodes`(2)、`WorkflowSubgraphNode`(1)、`workflow-param-mapping-ui`(1) | **不跟手**：语义来源是「类型 ↔ 色」（`custom-nodes` 还要对齐 litegraph 官方调色板），跟手反而是错的；只把「与 globals.css token 1:1」那句注释改成写语义来源 |
  | 装饰渐变表 | `model-cover.ts`（六支按 `hash(id) % 6` 取一支） | **单独定性为不跟手**：查过这张表**没有「品牌封面」那个特权位** —— 那颗紫只出现在六支中的两支与空表兜底里，与蓝/绿/琥珀/青平级。焊进 token 的后果是今后任何一次品牌调整**只带走六分之一张表**，用户看到「有几分变了、有几分没变」，比整张不跟手更难解释 |

  这条分治也否掉了本 issue 原文里我自己那句倾向：它写过「选中环 / W 徽标 / **模型封面** 三处都该跟品牌」。
  动手前查了 `model-cover` 有没有那个特权位 —— **没有**，所以它落到「不跟手」那一栏，本条按实测改写而非静默换方案。

- **`pnpm theme:check` 多了一条硬闸：跨面相等主张 = 0**（`scripts/check-theme-colors.cjs` 第 ⑤ 条，
  §3.6.1.1 的三条反向判据因此变四条）。口径是**禁止这种写法**，不是「校验主张是否成立」——
  后者每次改 token 都要重算，长出来就是 §12.18 明写不要的「扫豁免理由的启发式」。
  形状收窄到品牌家族（`与 --color-primary*/--color-accent* + 同值|相等|1:1|同一个值|逐字节同`）
  加一条真实发生过的变体（`与 globals.css token 1:1`），**扫描面是两处**：`src/**`（含注释）
  与本脚本自己的豁免 `reason` 字段 —— 这次的四处里有三处长在理由里，只扫 `src` 等于覆盖一半。

- **AA 读数（本笔算的，不是引用的）**：白字压旧品牌 `#7C5CFC` = **4.38**（不够 AA 正文 4.5）、
  压新 `#8557de` = **4.76**（够）；W 徽标那条渐变的**终点** `#FF5CA8` 仍是 **2.86** ——
  白字在徽标上的实际可读性由终点决定，**这一格不由本笔解决**，别把它写成「徽标已过 AA」。
  两紫之间的对比度差只有 **1.09**（观感是「深一点点」）。

- **顺带收掉一处第二记账**：`globals.css` 的 `--color-node-mix-base` 原本抄着 hex 并注
  「与 `--color-node` 同值」⇒ 改成 `var(--color-node)`。两态实测同值（浅 `#ffffff` / 深 `#2b2b36`）
  ⇒ 换写法零像素差；这与光晕那批「浅色档写成 token 本体，抄 hex 会和源头各自漂移」是同一条规则。

- **覆盖边界要说清**：像素基线层已整档撤除（规范 11 §11.8），所以**没有任何截图对比能证明这两处好看**
  —— 观感（两紫对比度差只有 1.09，「深一点点」）仍要肉眼过一遍。但「内联 `style` 里的 `color-mix()`
  写错会被 CSSOM 静默丢掉整条属性、而 Tailwind 那条链看不见它」这一格是**量过的**：Chromium 里
  解一次得 `outline: rgb(133, 87, 222) solid 2px`、
  `box-shadow: color(srgb 0.521569 0.341176 0.870588 / 0.5) 0 0 0 1px, color(srgb … / 0.3) 0 4px 24px`、
  徽标 `linear-gradient(135deg, rgb(133, 87, 222) 0%, rgb(255, 92, 168) 100%)`
  —— 三条都解析成颜色、`--color-primary` 分量逐字对上 `#8557de`，没有一条被丢。

### 验证

- 新闸的自测 6 条（`tests/check-theme-colors.test.ts` 的 `跨面相等主张` 一组），其中**三条是反控制**：
  `var(--color-primary)` 的正确写法不命中、非品牌家族的散文（`与 --color-subtle … 同一个值`）不命中、
  `#609` 这类行号不被当色值 —— 缺一条它就是误报机。
- **变异复核三个方向各红一条**（都是逐条看红的是哪个用例、不是看退出码）：摘掉 `src` 注释那一路
  → 红「注释里写『与 --color-primary 同值』」；摘掉豁免理由那一路 → 红「豁免登记理由里写同样的话也算命中」；
  把判据放宽成「任何 `--color-*` 的同值散文」→ 红「不误伤：非品牌家族的 token 散文不算」。
  变异跑完用 md5 比对确认门禁脚本与改前逐字节相同。
- 真树读数：`pnpm theme:check` 通过 ✓（未豁免 0 处 / 显式豁免 280 处 / 死豁免 0 条 / 跨面主张 0 处）；
  豁免从 285 处降到 280（跟手两处 + 徽标一处的裸值离开扫描面、`CanvasContextMenu` 整条豁免删除）。
- 受影响用例：`CanvasNode` / `CanvasContextMenu` / `ViewTabStrip` / `theme-token-single-source` /
  `theme-tokens-compile-source` / `design-md-contract-sync` / `tw4-canonical-ratchet` /
  `check-inline-style` 八份 98 条全绿；`tsc --noEmit` 0；`eslint --max-warnings 0` 0；
  `pnpm doc:check` ✓；`docs/standards/03`（新增 §3.6.1.2）与 `docs/DESIGN.md` 同步改，`pnpm doc:render` 已重生成。
