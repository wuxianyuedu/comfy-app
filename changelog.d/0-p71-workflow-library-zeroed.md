## Changed

- **`src/components/studio/workflow-library/**` 域 P71 清零**（37 → 0，接
  #955 / #959 / #961 的语义 token 收敛）：状态色与品牌色全部走语义 token、`dark:`
  手写档一并消失。与 log-level、`STATUS_STYLE`、log 徽标同源——改一处状态色
  token 全站跟动。
  - **`sections/WorkshopEncapsulationPanel.tsx`**（11 处）：契约口状态徽标
    表（`RESOLVED_BADGE_CLASS` emerald→`success`、`MISSING_REQUIRED_BADGE_CLASS`
    rose→`destructive`）、"已配置 / 未配置" 顶栏 pill、顶部警示面板 amber→
    `warning`、"必填" 小 pill、流程测试错误面板 → 一并 token 化。**关键**：
    token 内部两态自配套，之前的 `dark:bg-emerald-500/15` 手写深底（"浅绿字
    叠浅绿底" 事故的补丁）不再需要。
  - **`sections/DetailHeader.tsx`**（4 处）：默认模式 pill（violet→primary）、
    无可执行内容 / 磁盘丢失 / 磁盘更新 三种红/琥珀 pill → destructive /
    warning-strong。
  - **`CustomNodesSettings/SettingsParts.tsx`**（5 处）：widget "✗" 状态从
    red-500→destructive（与"✓" 侧 success-strong 对称）、select 值 chip
    violet→primary、log level 分色 error→destructive / success→success-strong
    （与 log 徽标同源）、包错误文件行 red→destructive。
  - **`CustomNodesSettings/NodesTab.tsx`**（2 处）：保存错误文字 / 错误计数
    pill 全走 destructive。
  - **`ParamOwnerTag.tsx`**（1 处）：品牌紫参数归属徽标整块（border / bg /
    text）→ primary 三件套。
  - **`sections/EncapsulationTestForm.tsx`**（1 处）：错误面板 → destructive。
  - **`WorkflowCanvasNodePreview.tsx`**（3 处）：运行失败 banner / 素材上传
    提示 / 必填参数未填 → destructive / warning-strong。
  - **`WorkflowLibrary.tsx`**（2 处）：action 失败 / load 失败 两条顶部横幅
    → destructive / warning。
  - **`WorkflowLibraryList.tsx`**（3 处 + 1 邻居）：拖拽 active 提示、"未载入
    的本地工作流" 分组边框+标题（cyan→info 语义化）；文件错误横幅（red→
    destructive）。
  - **`WorkflowRunLogModal.tsx`**（2 处）：头部 FileText 图标 violet→
    `text-primary-strong`（与 LogPanel:479 同一模式，#959 落地的品牌图标
    primary 化），errorMessage 面板 → destructive。
  - **`WorkflowRunRawCliModal.tsx`**（3 处）：`TAG_STYLES` 表 原始/stdout/
    stderr → `info-strong` / `ink-soft` / `destructive`（三种流类型标签语义化，
    slate 归中性 ink 系），头部 FileJson 图标 violet→primary-strong。

## Notes

- **P71 基线 183 → 146**（一次折叠 37 处）。
- 有意视觉 delta：
  - "契约口状态徽标" 由 emerald-100/rose-100（浅底 + 深字）→ `/15 opacity 深底
    - strong 字`——**明底浅、暗底稍深**是 token 内部两态值，"浅绿字叠浅绿底"
的暗色事故在 token 化后不会再回来（作者之前手写 `dark:bg-emerald-500/15`
      就是为绕开这个，token 化后不需要那种手工补丁）。
  - cyan 系（拖拽提示 / 未载入工作流分组 / 原始 CLI 流标签）→ info（青转蓝）
    ——cyan 没有语义 token、也不表达"等待/信息"以外的独立语义，归 info 与
    history 域 QUEUED、CLI 原始流保持全站"信息态=蓝"一致。
  - 品牌紫 violet 系（ParamOwnerTag / DetailHeader 默认模式 / SettingsParts
    select chip / 两个 modal 头部图标）→ `--color-primary-*` 系（浅色精确等值、
    深色略亮一档）。
  - rose 与 red 在 UI 中并存 → 统一走 `destructive`，与 log 徽标 / status-badge
    / alert 一致。
- 剩余 146 处分布：`workshop`(31) / `project-canvas`(30) / `app/(main)`(18) /
  `VideoQueueModal.tsx`(10) 等。下一批候选 `workshop`（工坊域，与 workflow-library
  同属"内容管理"上层，状态色密度类似）。
