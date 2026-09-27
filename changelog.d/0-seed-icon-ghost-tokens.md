## Fixed

- **seed 模式图标一直在静默失效，根因是「token 化只改了一半」**
  （`src/app/globals.css`、`src/components/ui/seed-mode-button.tsx`）：四枚 seed 图标
  （固定 / 递增 / 递减 / 随机）在一次目录归并里从写死色值改成了
  `fill="var(--color-seed-…)"` / `stroke="var(--color-seed-…)"`，但 `globals.css`
  从没补上这 5 颗 token 的定义。CSS 变量查无此名**不报错**：`fill` 退成黑色初值、
  `stroke` 退成 `none` —— 骰子变黑块、递增/递减两支箭头整条消失，而组件的注释还写着
  「色值已逐条登记在主题色豁免清单里」（那是 token 化之前的状态）。
  现在 `@theme` 里补上 `--color-seed-fixed` / `-step` / `-dice-bg` / `-dice-stroke` /
  `-dice-pip`，注释改成指真事实。
  顺带一条：原设计稿那两颗红绿（`#FF6B6B` / `#67E89D`）是在**深色面板**上定的，而图标
  现在托在 `bg-node-accent`（浅色 = 极浅紫）上，照抄只有 1.5~2:1 —— 于是这两颗做成
  两档（浅底 `#E11D48` / `#059669`，深底沿用原值），骰子三颗是图形自身、两态同值。
  这与 `globals.css` 上方那张「深色档值压在浅色上消失」的反例清单是同一件事。
- **清掉 4 条「一处都不再命中」的主题色豁免**（`scripts/check-theme-colors.cjs`）：
  `ui/seed-mode-button.tsx`（即本条上半段）、`workflow-library/WorkflowParamCardColumn.tsx`、
  `CustomNodesSettings/constants.ts`、`workflow-editor/WorkflowEditorInner.tsx` 后三者的
  色值只剩在注释里 —— 判据本来就不数注释，条目留着等于白放行。留着不报错，只会把
  那个文件**今后**新写的死色值一并静默放行（整文件豁免粒度尤其危险）。
