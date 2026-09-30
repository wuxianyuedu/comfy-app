## Fixed

- 并入 `master`（`e01df4b8`「项目有了主页」，ISSUE #1293）并解决 **3 处冲突** ——
  两侧都在同一份「项目页签清单」上加了新页签，合起来的真身是 **6 项**，不是任何一侧的 5 项：
  - `src/components/studio/NavItems.tsx`：三处注释（`projectTabs` 分区说明 / `projectScoped`
    字段说明 / `projectTabs()` 文档）取**并集**「主页 / 画布 / 工坊 / 资源库 / 产出 / 成片」。
  - `src/components/studio/nav-items.test.ts`：用例名与 `PROJECT_TAB_IDS` 同步成 6 项
    （两侧的清单本身已自动合并为并集，只有「五个」这个计数文字需要改）。
  - `src/components/studio/ProjectTabBar.test.tsx`：渲染用例补上 `资源库`，用例名改「六个页签」。

## Changed

- 顺带把**未冲突但已过期**的同族注释补齐（自动合并会把「少了主页」的旧枚举悄悄留下，
  这类漂移不会让任何用例变红）：`ProjectTabBar.tsx`（接口文档与组件说明、`这四项`→`这些页签`）、
  `AppShell.tsx`、`TopBar.tsx`、`ResourceLibrary.tsx` 头注释、`workspace/page.tsx` 的闸门说明。
- `scripts/shell-gate.mjs` 补上**合并提交**这条边界：合并进行中时 `git diff --cached` 报的是
  「相对第一父的整份内容差」，会把被合进来那侧**早已在对方分支编好发版**的壳文件
  （`splash-assets/**`）算成「本次改了壳」，于是在编不出壳的机器（Linux 容器）上，一个
  纯前端 PR 只因拉了 `master` 就被重编判据永久拦死。判据改为「某壳输入**同时**不同于第一父
  与第二父」才算本次改动 —— 仅与第一父不同、与第二父逐字节相同 = 自动合并原样采纳，不触发
  重编；冲突解决真动过壳文件的，两侧都不同，照样拦（`tests/shell-gate.test.ts` 三种形态覆盖）。
