## Changed

- **标题字阶三颗（`--text-section` / `--text-page` / `--text-stage`）从 `@theme` 移到 `:root`** ——
  它们只该经 `.u-title*` 使用，而 `@theme` 的 `--text-*` 命名空间会被 Tailwind 顺带生成成
  工具类：编译产物里实测有 `.text-page` / `.text-section` / `.text-stage` 三条，JSX 侧零消费者。
  留着它们等于同时留两个坑 —— `cn()` 把不认识的 `text-<名字>` 归进**颜色**组、吃掉同一行真正的
  状态色，而调用点写下的是「一个会随设置页变的字号」。移到 `:root` 之后那个类**根本不存在**，
  「别在 JSX 里用它们」从一句注释变成机器事实（编译对账：那三条从 3 → 0）。

## Removed

- **P83 的第二个合规出口 `text-page`**。从前屏级 `h1` 挂 `.u-title-page` 或 `text-page` 都算合规 ——
  后者正是上面那个坑的入口：判据给了一条「写上去会静默丢状态色」的出路。现在只剩
  `.u-title-page` 一条，用例按既有先例翻向（「档不再是出口之后，判据不许还放行它」，
  同 `u-title-hero` 那条）：只挂 `text-page` 的 h1 现在**计为违规**。产品代码里此前
  零处那么写（实测 `grep` 只在用例夹具里），所以这条不改动任何界面。

## Fixed

- **两处「改名就能纳入射程」的错登记**：契约与 helper 从前写着「把标题档改成 t-shirt 名，
  那条对称判据会自动把 17px 纳入射程」—— 不成立。判据的读法只解常量声明（`calc()` 形状看不见），
  真正的边界是**有没有单一渲染值**：这三颗乘 `--font-scale`（14px 的 `section` 在 125% 档下是
  17.5px），拿 scale=1 的读数当等式去要求调用点改类名本来就是错的。现在按真实理由重写，
  并记下「名字形状」那道闸真正管的是**项目自加的常量档**。
- 判据脚本 `ui-primitives-rules-p67-p86.cjs` 的注释里还留着「h2 / h3 保留 **10.5**–14px 微排版」——
  那个射程在 #1840 已按实测订正成 11–14px（52 处 10.5px 里只有 1 处落在 `h3`），脚本注释漏跟。

## Added

- 两条新判据（定义侧 + 调用侧各一条，同一件事的两半）：
  · `tests/theme-token-single-source.test.ts` 的 **T6** —— 三颗必须住在 `:root`、不得出现在
    `@theme` 块内，并带一条反向验证（真搬回去时判据必须看得见；这条反向验证本身第一版是坏的：
    它把 `:root {` 换成 `@theme {`，造出的是**第二个**块，而 `braceBlock` 只读第一个 ——
    断言看着在验其实什么都没验到，正是本文件开头记着的「覆盖面比措辞窄」那一类）；
  · `tests/design-md-contract-sync.test.ts` —— 产品代码里不许出现 `text-section` / `text-page`
    / `text-stage` 这三个类名（归零等式，带正则自验）。
- 真机读数（Storybook 沙箱 + Chromium）：`.u-title-page` 的 h1 在默认字阶下 24px / 700，
  把 `--font-scale` 设成 1.25 后跟着变 30px —— 移到 `:root` 没有动到渲染；同时挂 `text-page`
  的元素现在拿不到任何字号（实测等于 `body` 的 16px），即「那个类不存在」是被读出来的、不是推断的。
- **`@theme` token 清单快照（`tests/__snapshots__/theme-tokens.css-theme-surface.txt`）同批更新**，
  并记下它为什么滞后：快照的正确新态是「少三颗标题 token、多一颗 `--text-4xs`」，而
  `--text-4xs` 是上一单（#1883）加的 —— 那一单的钩子全绿却**没跑到这条快照**，因为
  `theme-tokens-compile-source.test.ts` 既不在固定清单里、也不在「从 `globals.css` 沿静态
  import 图追溯」的可达面上（改的是 CSS 文件，没有测试 import 它）。⇒ 改 `@theme` 的 token
  清单时**要点名跑这一条**，别指望受影响用例档替它兜底（§13.5.8 的那张图是 import 图，
  CSS 不在图上）。
