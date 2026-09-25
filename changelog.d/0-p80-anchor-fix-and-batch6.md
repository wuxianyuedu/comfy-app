## Fixed

- **P80 锚点假阳修复**（`scripts/check-ui-primitives.cjs`）：
  JS 正则 `\b` 在 `-h-` 处也算边界（`-` 是非单词字符），所以
  `min-h-0 min-w-0` / `max-w-md max-h-8` 这类**带前缀**的容器写法被 P80
  误当成 `h-0 w-0` / `w-md h-8` 计入棘轮 —— 一共 6 处假阳
  （`AppShell.tsx` 1、`MessageCenterPanel.tsx` 1、`HomePage.tsx` 2、
  `DetailBody.tsx` 1、`WorkflowWirePortRows.tsx` 1）。收紧成
  `(?:^|[^-\w])h-(...)` / `(?:^|[^-\w])w-(...)`：前一位必须是行首、空白
  或引号，不能是 `-`（排除前缀）也不能是字母数字（排除 `wh-N` 之类粘连）。
  修完先 --update 让 baseline 反映真实形态：**146 → 140**（净扣 6 处假阳）。

- **视图层 9 处 `w-N h-N` 同值换 `size-N`（P80 棘轮第六批治理）**：
  全部落在 `components/workshop/`：
  - `WorkshopHeader.tsx` 应用头像方块 `h-9 w-9`；
  - `VideoStudio.parts.tsx` / `StoryboardPlanner.parts.tsx` / `ShotStudio.tsx`
    / `CharacterDesigner.tsx` 四份「镜号 / 角色序号」小圆点 `h-6 w-6`；
  - `ScriptMarkdownEditor.tsx` 顶部文件图标容器 `h-8 w-8`；
  - `FinalComposer.tsx` 镜头序号圆点 `h-7 w-7`；
  - `AgentOverlay.tsx` 智能体头像方块 `h-6 w-6`；
  - `CharacterPortraitStudio.tsx` 定妆照候选缩略图 `h-24 w-24`。

  基线随之 **140 → 131**（P80 累计 91 → 21）。

## 累计进度

P80 从引入时的 91 处、跨 5 批治理降到当前 21 处，加锚点假阳修复 6 处，
一共清掉 70 处。**P80 剩余 21 处**在 20+ 个 1-2 处的小文件里，下一批继续。
