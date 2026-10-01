## Fixed

- 两份 theme 判据在**全量并发跑**下整份 suite 红、里面的用例一条没跑却被记成 skipped
  （ISSUE #1336）。成因不是行为回归：`tests/helpers/theme-tokens.ts` 的编译走 Tailwind v4 的
  **自动源码探测**，每次 `beforeAll` 都把全仓扫一遍找类名 —— 本机裸跑实测 **21109ms**、
  vitest 隔离跑 **7.2s/文件**，两个文件各编一遍；满载时这份编译排到 `hookTimeout: 45_000`
  之外 ⇒ 钩子超时 ⇒ `theme-token-single-source`（35 条）与 `theme-dark-token-cascade`（18 条）
  整份红。串行隔离重跑同代码全绿，即典型争用假红。
- 修法是**减少满载时的工作量，不是再抬一次超时**（`vitest.config.ts` 那条注释自己就写着
  「这是天花板不是目标」，而且它已经为这件事抬过一次）。编译的输入源改成固定的三件事：
  ① `@import "tailwindcss" source(none)` 关掉自动探测；
  ② 判据要读的三条 utility 用 `@source inline("bg-card" / "bg-popover" / "border-border")`
  显式钉住（关探测后不点名就不产出，那三条 `css` 正则是别的用例读不着的东西）；
  ③ 项目自己的 `@theme` 块改成 `@theme static`。
  结果：单份 suite 的 `beforeAll` 由 7.2s 降到实测 **0.13s**（`theme-dark-token-cascade` 127ms /
  `theme-token-single-source` 180ms / `sidebar-state-contrast` 199ms），`hookTimeout` 保持 45s 没动。

## Changed

- 产物形状的两处差异，都不改任何已有值（逐条比对过两态挂在 `:root` / `:host` / `.dark` 上的
  自定义属性声明：**同名不同值 = 0 条**）：**少**了「只有全仓扫描才会带进来的默认调色板档」
  （`--color-red-200` 这类 238 条，三个消费方一条都不读）；**多**了项目 `@theme` 里此前被
  按用法 tree-shake 掉的声明。第二项不是顺手加的，是第一版踩出来的：只做 ①② 时
  `--color-primary-strong` 的**浅色档**从产物里消失了（深色档手写在 `.dark {}` 里所以还在），
  `sidebar-state-contrast` 的「浅色：选中底上的正文与指示条都够亮」当场红 —— 这种「一半在、
  一半被摇掉」的形状比全红更难归因，所以判据不该依赖「全仓哪里用到过某个类」。
- `@import "tailwindcss"` 那一行匹配不到时**抛错**，不静默按全量扫描编一遍：后者等于让这条
  优化悄悄失效，表现是「某天满载时 theme 又间歇红」而归因线索全断。

## Added

- `tests/theme-tokens-compile-source.test.ts`（4 条反向判据，全部打在**产物形状**上、不用耗时
  当判据）：`@theme` 块里声明的每个 token 必须无条件进产物（并先钉「真的解析到了 >50 个」，
  免得解析式空跑）；三条 utility 必须仍在产物里；默认调色板档必须**不在**产物里（= 探测关着）；
  匹配式落空必须抛。三条各自做过变异验证，且各自**恰好红一条**：摘掉 `@theme static` ⇒ 只有
  第一条红（并列出 56 个丢失的 token 名）；清空 `@source inline` 清单 ⇒ 只有第二条红，同时
  `theme-dark-token-cascade` 那条真判据跟着红（说明钉的是同一个形状）；把探测换成
  `source("../..")` ⇒ 只有第三条红（`source(auto)` 那种写法会被 Tailwind 拒：`source(…) paths
must be quoted`，这是变异过程中顺手量到的）。

## Verified

- 三个消费方（合计 60 条）+ 新判据 4 条在串行隔离下全绿。
- **全量并发跑才是这条要消灭的形态**，所以取的是并发数：`pnpm test`（540 文件，默认
  `maxWorkers: 8`）这一轮 `Test Files 1 failed | 539 passed`、`Tests 1 failed | 6621 passed
  | 23 skipped`，两份 theme suite 在里面**绿着跑完**：
  `✓ theme-dark-token-cascade (18 tests) 430ms`、`✓ theme-token-single-source (35 tests) 783ms`、
  `✓ sidebar-state-contrast (7 tests) 432ms`、`✓ theme-tokens-compile-source (4 tests) 431ms`
  —— 对照开跑前那轮「整份红 + 53 条被记成 skipped」。
- 那轮唯一的一条红是**别线的**（`src/components/studio/nav-items.test.ts` 的「恰好两项」被
  `aa3ee904` 加的 `overlay: "console"` 顶掉），与本刀无关（本刀只动 `tests/helpers/theme-tokens.ts`
  / `vitest.config.ts` / 文档），也没有为它放宽任何判据 —— 已在 ISSUE #1327 下指路给该线处置。
- 口径来源：规范 §11.13「为什么默认值不够」那张表的「主题令牌」那一行已按实测改成
  收口前/收口后两个数，并写清「不再靠抬超时」；`vitest.config.ts` 里那句「两个 theme 用例的
  `beforeAll` 现编一份 CSS，隔离跑 7.2s」同步改掉，并注明这两个预算没有为它再抬过。
