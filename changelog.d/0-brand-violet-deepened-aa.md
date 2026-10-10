## Changed

- **品牌色整套深化一档**（`src/app/globals.css` 的 `@theme` + `.dark`，11 行）。**动机不是审美，是实测的 AA 缺口**：旧 `--color-primary: #7c5cfc` 白字压它 **4.38**、`--color-primary-500: #8b5cf6` **4.23** —— 都低于 WCAG AA 正文要求的 4.5，也就是说**实心 CTA 按钮上的白字一直在及格线下**（`.btn-gradient` 的起点档 `#7c3aed` 是 5.70，所以只有渐变那条路是够的，纯色实心档不够）。

  | 角色 | 旧值 | 新值 | 白字压它（新） | 它当字·白底（新） |
  | --- | --- | --- | --- | --- |
  | `--color-primary`（当底 / 焦点环） | `#7c5cfc` | `#8557de` | **4.76** | 4.76 |
  | `--color-primary-hover` | `#6a47e8` | `#7445c6` | 6.16 | 6.16 |
  | `--color-primary-strong`（浅·当字） | `#6d28d9` | `#6230cc` | — | **7.46** |
  | `--color-primary-strong`（深·当字） | `#a78bfa` | `#b79bff` | — | 压 `#14141a` **7.99**（旧 6.74） |
  | `--color-primary-500`（实心 CTA） | `#8b5cf6` | `#8d50e2` | **4.80** | 4.80 |
  | `--color-primary-600`（渐变起点） | `#7c3aed` | `#7a3fd0` | 6.09 | 6.09 |
  | `--color-primary-soft`（浅 / 深） | `#f1ecff` / `#221c3a` | `#f2ecff` / `#251d40` | 正文压上去 15.00 / 13.55 | — |
  | `--color-glow-brand`（浅 / 深） | `var(--color-primary)` / `#a78bfa` | 自动跟手 / `#b79bff` | — | 深底可见度 7.99 |
  | `--color-aurora-violet` | `#8b5cf6` | `#8d50e2` | 装饰层，随实心档 | — |

## 为什么是「深化同族」而不是「换个色相」

把六个语义 token 的色相量出来后，选择空间其实已经**占满**了：

| 语义 | token | 色相 |
| --- | --- | --- |
| 品牌 | `--color-primary` | 252° → **260°** |
| 信息 / 链接 | `--color-info` | **221°（蓝）** |
| 成功 | `--color-success` | 160°（绿） |
| 警告 | `--color-warning` | 38°（琥珀） |
| 危险 | `--color-destructive` | 357°（红） |
| 第二品牌 | `--color-accent` / `-deep` | 332° / 293°（品红 / 紫红） |

⇒ **换蓝/靛会撞 `info`**：靛蓝 `#4f46e5` 与 `--color-info` 只差 **22°**，「链接」和「品牌」在视觉上变成一族，正是规范 03 §3.6.2 立那条判据要防的事（它举的反例就是「改一次品牌色要点 72 个文件」，同族色相漂移是它的近亲）。
⇒ **换青/绿/橙会撞 `success` / `warning`**，而且它们当文字色全部不过 AA（青 3.68 / teal 3.74 / 翠绿 3.77 / 琥珀 3.19 / 橙 3.56），只能当底 —— 换过去等于把品牌降级成一个只能铺底、不能写字的颜色。
⇒ 留在紫罗兰带内、把 lightness 从 68% 压到 60% 左右，是**唯一一处既能补上 AA、又不动任何语义分工**的改动；顺带饱和度上去了，比旧值更艳（旧值偏灰的根源就是太亮）。

## 刻意没动的

- **状态色四族**（`success` / `warning` / `danger` / `info`）与 `accent` 第二品牌族 —— 它们不是品牌的附属，是独立语义；换品牌色不该改它们（改了才叫破功）。
- **内容自身的颜色**：`node-registry` / `custom-nodes` 的类别色对齐 litegraph 官方调色板、`WorkflowNode` 的端口角色色（`#a78bfa` 那一族）—— 这些是「内容色」例外（§3.6.1），与品牌无继承关系，**不跟手**。
- **视图层没有「未登记」的品牌裸值**（`pnpm theme:check`：未豁免 0 处 ≤ 基线 0 处），所以语义化的品牌面
  **只改 token 就全站跟手** —— 这正是 §3.6.2 那次收口的验收标准。
  ⚠️ **这句话从前写得太满**（原文是「没有任何一处写死品牌 hex」）。按 §3.6.2 的尺复算，
  `src/` 里另有 **21 行 / 12 个文件**写着旧品牌值 `#7C5CFC`，它们**登记为内容类型色**（端口色、类别色…），
  本来就不该跟品牌走 —— `theme:check` 数的是「有没有没登记的」，看不见这些登记**理由里那句
  「与 `--color-primary` 同值」**已经过期。受影响的 4 处（选中高亮环 / 模型封面渐变 / W 徽标渐变 /
  `ContentAssetNode` 的注释）已开 **ISSUE #1717** 拍板，本笔不动画布可见配色。

## 验证

| 项 | 结果 |
| --- | --- |
| `tests/design-md-contract-sync.test.ts` | 13 passed —— 它逐格比对 DESIGN.md 的两态表与**编译产物**里的取值（改 CSS 不改文档会当场报 8 行，已按它给的清单同步） |
| `tests/theme-token-single-source.test.ts` | 45 passed |
| `pnpm theme:check` | ✓ 未豁免 0 处 / 豁免 285 处不变 |
| `pnpm doc:check` | ✓ |
| `tests/a11y-axe-stories.test.ts` | 1 passed —— 但**别把它当对比度证据**：jsdom 不解析 Tailwind v4 编译出的 `@theme` 变量，axe 在这条路上算不出真实前景/背景对。上面那些 4.76 / 4.80 / 7.46 是按 WCAG 2.1 相对亮度公式**直接算的**（`L = 0.2126R + 0.7152G + 0.0722B`，sRGB 线性化后），复算脚本口径写在上面的表里 |
| `pnpm exec tsc --noEmit` | 0 error |
| `src/components/ui` + `HomePage` | 57 files / 486 passed（**这笔落地的数**是在 `699a8a36` 上量的；推前变基到 `b0ace9cf` 后，`design-md-contract-sync` + `theme-token-single-source` 58 passed、`tsc --noEmit` 0 error 是**在新基上重测的**，其余由重跑的 `.githooks/pre-commit` 覆盖） |
| `.githooks/pre-commit` | 变基后**重跑过一遍**（`git rebase` 不挂钩子），全部通过 ✓ —— 合并号 #1715、落地 sha `2d5e0761` |

## 代价与边界（改到当前事实为止）

- **这笔没有像素基线代价**：本会先按「20 张 PNG 全过期」记了这笔的代价，那个前提**当天就没了**
  —— 像素档（5 份视觉 spec / 10 处 `toHaveScreenshot` / 两档平台基线 + `scripts/pixel-run.mjs`）
  已在 `origin/master` 上整档撤掉（规范 11 §11.8，现跑 `git ls-tree -r --name-only origin/master | grep -c 'e2e/.*\.png$'` = **0**）。
  所以这里没有「要不要重录基线」这一步，那笔账已经不属于本仓。
- **换来的边界**：颜色改动今天**没有任何自动回归**可跑 —— 绝对形状与配色靠 review 看图，
  这是规范 11 §11.8 撤档时**有意留下的空白**，别把它读成「有人管」。本笔能给的机器证据只有两类：
  两态取值与 DESIGN.md 逐格对账（`design-md-contract-sync` 的那条「单一 hex」判据），
  以及上面那张按 WCAG 公式算出来的对比度表。
- 深色档的 `--color-primary` 压深底是 3.86 —— 它只用于**非文本 UI**（焦点环、描边），
  AA 对非文本要求 3.0，够；文字一律走 `-strong`。
