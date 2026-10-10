## Fixed

- **首页像素基线在 linux 档悄悄过期了四张，加上「模型概览」那一格录到的是骨架态
  （ISSUE #1620）**。`pnpm check:visual` 在生产口径下重跑，10 张里 6 张红 —— 逐张定性后
  分成两件独立的事，两件都不是「像素回归」，但都会让像素档失去执行者：
  ① **四张基线过期**（`canvas` 两张 + `overlay` 两张）：#1558 把视图页签的选中态从
  「紫色药丸」改成「更亮的表面 + 品牌色条」（`u-tab-active`）时没有同批重录基线，而
  `-linux.png` 自那之后没再跑过。差异就是那条色条本身（44 列、约 9.7k 像素），
  属于**合法 UI 变更没跟上基线**，不是界面退化。
  ② **`model.configList` 没桩**：首页「模型概览」卡的判据读本机 ComfyUI 的 `models`
  目录，不桩时既随机器变，又会因为 TanStack Query 的 `isLoading` **录到三行 Skeleton
  那一刻** —— 骨架与空态卡高不同，自那一行往下整段位移。这正是 #1593 实测「录完立刻
  串行复跑仍差 4652 像素、差异区间 `bbox=(407,480)-(1289,876)`」的根因。

  修法两半：`e2e/visual/support/page-baseline.ts` 新增 `freezeModelOverview()`（与
  `freezeComfyStats` 并列，钉成 `{folders: []}` 的空态 —— 容器 / CI 里没有 ComfyUI 时
  的真形态，不复述某台机器的私有计数）；`workspace.visual.spec.ts` 在 `goto` 前调它，
  并把「这一档钉了哪几样、为什么」写进文件头。linux 六张基线按登记口径
  （`CI=true` ⇒ `pnpm start`）重录，随即**同一条命令连跑两次全绿**（§11.8 判据），
  `scripts/.visual-baseline-freshness.json` 的 linux 一条随提交更新。

  **没动的两处**：win32 那 10 张由那一档自己的机器担保（#1593 已补齐并复跑自证），
  本刀一个字节都没碰；`project.list` 的 `hydrateFromServer()` 只由 `ProjectCanvas`
  挂载时调用、首页不调，所以「最近项目」只读 localStorage —— #1620 文里记的「第②桩」
  与实测不符，已在文件头写清免得下一个人重复怀疑；`/api/schema` 那一格会随容器里有没有
  建表变，但它整条被 `unstableChromeMasks` 遮着，不进像素。
