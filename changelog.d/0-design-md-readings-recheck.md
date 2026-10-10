## Fixed

- **`docs/DESIGN.md` 里一批读数已被后续落地否掉，逐条按当前实测重写**（本节 4 条 + 下面「附带订正」2 条；只改文档，不动代码）：
  - **组件出口那行**：「186 个文件 = 83 个组件 + 29 个 `.stories.tsx` + 36 个 `.test.tsx`」
    → 实测 `git ls-files src/components/ui` = **245 份**（83 份故事 / 39 份单测 / 123 份其余），
    并写明「组件」这个数在故事面判据里的口径是 **89**（复算入口
    `node scripts/storybook-check.mjs`），避免两份数被当成两次互相矛盾的测量。
  - **Storybook 覆盖**：「29/83，核心交互件里 input / dialog / select / card / tooltip /
    popover / switch / checkbox / … 无 story」→ 现在实测 **89/89、理由表 0 条、故事面 122 份**
    （份数那一格随新增故事漂移，文中写明「别当判据读」，要复核现跑命令）。
    缺口挪到了单元层：`src/components/ui/` 下 **55 个组件没有同名 `.test.tsx`**
    （含 dialog / select / tabs / card / input / switch / checkbox 这些交互件）。
    同时写明两个口径差别：`tooltip` **有**单测（旧清单把它列进「无 story 且无单测」是错的），
    而 `input` / `switch` / `checkbox` 没有自己的 `.stories.tsx` 却仍被算进 89/89
    （故事面按导出计数、单元层按同名文件计数）。
  - **`.u-*` 消费者计数**：量具自证那组数字（`u-title` 51 / `u-title-page` 18）与
    「按类名精确计数」（26 / 17 / 1 / 1）都已过期，且**两个口径混在一句话里**——
    `grep -rn "\bu-title\b"` 的 `\b` 把连字符当词边界，52 行里含三枚兄弟名。现改为
    **52 行（宽松 grep）vs 28/19/4/1（逐 token 精确）**，并把「相加正好等于 52」写成
    这条量具的自证；文末复算清单第 8 条的循环同步（补齐 8 枚类名、去掉那条
    对 `--include` 已生效的 `globals.css` 再过滤）。
  - **像素覆盖**：「`toHaveScreenshot` 全仓只有 2 处、要补的是代表屏的截图用例 +
    一个手动跑的入口」→ 实测 **5 份视觉 spec / 10 处 `toHaveScreenshot` / 18 份基线
    （`-linux` 10 + `-win32` 8，`darwin` 0）**，手动入口早就在了（`pnpm check:visual` /
    `check:visual:update`）。结论收窄而不是翻案：**绝对形状只在被取景的那 10 屏上有判据**，
    且 playwright 仍不进 pre-commit（`visual-gate.mjs` / `visual-freshness-gate.mjs`
    两步都刻意不跑像素），所以「这台机器的结论换个人不一定成立」那半句照旧。

## 附带订正（同一把尺往前挪的第二轮扫出来的）

- **token 规模那组数**：`@theme` / `@theme inline` / `.dark` / `:root` / 唯一 `--color-*` 名
  从 88 / 28 / 72 / 47 / 115 改成实测 **93 / 27 / 77 / 49 / 120**（Colors 表头那句「88 条声明」同步）。
  顺手把一条**量具本身的坑**写进复算清单：`globals.css` 里有三个 `:root {`（636 / 1015 / 1241）
  和三个 `.dark {`（350 / 639 / 1045），而 `awk '/^X \{/,/^\}/'` 的区间**会重复起段**
  ⇒ 那两条 awk 数的是同名各段之和，不是「第一个块」；`:root` 那条还是「块内全部 `--` 声明」，
  与 `--color-*` 口径不同。
- **reduced-motion 那格已经不是缺口**：复算清单第 5 条标题写着「缺口」、注释写着 `# 0`，
  而三档分治的 `@media (prefers-reduced-motion: reduce)` 早就落地在 `globals.css:1392` 起，
  执行者 `tests/reduced-motion-tiers.test.ts`（登记在 `scripts/affected-tests.mjs` 的固定清单）。
  现在改成「判降级块在不在」+ 实测 **3 行**（1 行 `@media` 本体 + 2 行说明注释，口径写明）。
  「冲突 2」那节里「这不是文档笔误，是缺口：要么补降级块、要么收窄条文」那句是**立案原话**，
  留着是为了记当时把缺口读成笔误这个动作，但它排在「已签字」那条**之后**，读起来像还敞着的
  选择题 —— 已就地标明是历史语料，并写出实际落的是「两件事一起做」。
- **一份会漂的数字与一份有基线的数字要分开**：覆盖率 89/89 有 `storybook-check` 的基线顶着，
  而「故事面 122 份」这类计数每加一份 story 就变（写文档时 120、同步一次 master 就 122）
  —— 这类数在文中一律标「别当判据读，要复核现跑」，不然下一轮又是「文档自称的读数」骗人。
- `changelog.d/0-empty-state-panel-variant.md` 的「覆盖边界」段曾断言 `panel` 档
  **不在**像素取景内——那是按屏的名字猜的。`overlay.visual.spec.ts` 把日志钉成空来源，
  `settle(page, "暂无匹配的日志")` 等的正是 `logs/LogPanel` 的 `variant="panel"` 分支
  ⇒ `overlay-log-default/-wide` × 两档 = **4 张基线里有它**；其余 5 处确实不在取景内。
  同一事实写进 `docs/DESIGN.md` 的像素那条，并留了「取景范围要按 spec 自己的注释读」
  这条手法。

## 验证

| 项                                        | 结果                                                                   |
| ----------------------------------------- | ---------------------------------------------------------------------- |
| `pnpm doc:check`                          | 通过（端口 / frontmatter / 事实表那几向）                              |
| `tests/design-md-contract-sync.test.ts`   | 13 passed                                                              |
| 文中每条读数的复算入口                    | `git ls-files` 计数、`node scripts/storybook-check.mjs`、第 8 条那段循环、`git ls-files 'e2e/*.png'` 分档 tally |

**边界**：本轮只订正「文档自称的读数」，没有据此放宽或收紧任何判据；棘轮数字、
基线与代码一律未动。
