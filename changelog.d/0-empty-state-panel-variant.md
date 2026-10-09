## Added

- **`ui/empty-state` 的第四档 `panel`** —— 面板里铺满居中的轻量占位（无框、无内距、吃满父级
  高度、图标弱化到 30% 透明、文案 `text-sm` + `text-ink-fainter`）。这一档此前没有归宿，
  于是同一个形状被手抄成 **6 份**：`console/ConsoleOutput`（运行中 / 空输出两个分支）、
  `logs/TaskLogTimeline` 的 `TaskLogEmptyHint`、`logs/LogPanel`、
  `project-canvas/GlobalStepLogPanel` 的 `emptySlot`、
  `workflow-library/WorkflowRunRawCliModal`（加载中不带图标 / 无完整输出带图标），以及
  `message-center/MessageCenterPanel`。
- **「只许有一个出处」判据的第 5 族**，带一个新形状：`scope: "line"` —— 标记只在**同一枚
  class 字符串**上全命中才算出处。这是量出来的不是洁癖：这一族每一枚标记单独看都很常见，
  整文件口径实测命中 9 个文件、其中三处是无关的（`HistoryPanel` 的两枚标记分别在第 69 与
  第 230 行；`ProjectGate` 命中的那颗其实是 `placeholder:` 前缀；`ShellTabs` 那一处是页签
  诊断卡）。收窄到单行后**严格同形正好 5 处、零误抓**。判据与它的负控制共用同一个出口函数
  （`familyHits`），否则负控制测的是另一套逻辑、红了也证明不了判据。

## Changed

- 6 处调用点迁到 `<EmptyState variant="panel">`，**外观逐像素不变**。两处差异不靠抄类名表达：
  消息中心那一处原本 `gap-3` + 44px / `strokeWidth 1.2` 的图标，改走 `className="gap-3"` 与
  「传已渲染的图标节点」；其余五处本来就同形。`cn()` 对 `gap-*` 是**同组后者取胜**（实测
  `cn("… gap-2 …", "gap-3")` 把 `gap-2` 摘掉），所以覆写不是赌产物里两条规则的先后。
- `panel` 档**刻意自绘 `<div>`**、不套官方 `Empty` 骨架，理由写进件头：`Empty` 自带
  `p-6` / `rounded-xl` / `border-dashed` / `text-balance`，套上去要覆写的比它带来的还多，
  而 `text-balance` 会把长提示的折行改形 —— 那是改外观，不是收口。与 `hint` 档的处置同源。
- 契约同步：`docs/DESIGN.md` 新增 §Components「空态四档」一节（含两处**刻意没并进来**的
  `ShellTabs` 形状及各自的理由 —— 排除项不写进文档，下一轮就会被当漏网清掉），§Shapes 那条
  判据清单从四族改到五族并补上 `scope: "line"` 的适用条件。

## 验证

| 项 | 结果 |
| --- | --- |
| `tests/design-md-contract-sync.test.ts` | 13 passed（含「被抽走的 **5 族**形状只许有一个出处」与三条新的反向样本）|
| `src/components/ui/empty-state.test.tsx` | 10 passed（新增 3 条 panel：形状本身、图标弱化档 32/1.5/`opacity-30`/`aria-hidden`、调用点覆写取胜）|
| 受影响面（console / message-center / logs / workflow-library / project-canvas / ui）| 49 files / **692 passed** |
| `tsc --noEmit` / `eslint` / `prettier --check` | 0 error / 0 warning / 干净 |
| 手抄存量（单行全命中）| 迁移前 **5** 处 → 迁移后 **1** 处（只剩基元自己）|
| `.githooks/pre-commit` | 见下方提交 |

**覆盖边界**：`panel` 档**不在像素基线的取景范围内** —— win32 那 8 张基线已补齐（`a4b9b626`），
但取的是 canvas / 登录 / 模型 / 浮层 / 工作区那几屏，不含这 6 处所在的日志面板、控制台输出、
CLI 原文模态与消息中心。所以「零像素」的依据是类名逐字同源 + `cn()` 覆写实测 + 单测，
而不是截图对比；真要出像素判决，得给这几个面板补取景。
