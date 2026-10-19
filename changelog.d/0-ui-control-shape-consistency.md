## Fixed

- **六处按钮/输入框的观感收口：形态回到基元缺省档，装饰发光撤掉，孤立控件不再占位**
  （规范 03 §3.6.2 / §3.8.1 / §3.10.1、DESIGN.md §Elevation 与 §Typography）。
  业主点名这六处「不好看」，逐处量下来共同的那一条病因是**调用点在覆盖基元已经定好的档**：
  同一排里各写一份尺寸/字号/圆角，就会漂移成几种观感；而覆盖掉的那几档恰好都是
  设计契约里写着的那几档（控件 = `h-8 rounded-lg text-sm font-medium`）。
- **模型屏顶栏的搜索框此前是裸 `<input>`**（`studio/ModelLibrary.tsx`）：绕开了输入框
  唯一的出口 `ui/input.tsx`，焦点色写成 `focus:border-violet-500/40` —— 品牌色不跟手
  （§3.6.2 那条「品牌/状态色必须走语义 token」），且 `py-2` 自拼高度比同排的
  「模型目录配置」与顶栏其余控件都高一档。现在走 `ui/input-group` + `InputGroupInput`
  （与 ⌘K 那一枚、工作流库左侧那枚同款），前导放大镜由 `InputGroupAddon` 给，
  高度回落到基元的 `h-8`（实测两颗都 32px、顶边 52.5/53 同线），并补上此前缺的
  `aria-label`。同文件配置弹窗里那枚 `<Input>` 带着同一串 `focus:border-violet-500/40`
  覆写，一并删掉（覆写满之后基元的焦点环、圆角、字号全被绕过，而它本来就是 `Input`）。
- **库里一个模型都没有时不再渲染只剩「全部 (0)」的那排筛选**：那一档点它什么也不会发生
  （只有「全部」一个选项），而下方空态已经在说同一件事 —— 孤零零一枚描边胶囊浮在空区上方
  是噪声，不是信息。判据用 `c.models.length`（未筛选前的存量），所以「有模型但当前筛选
  命中 0 条」那一格照旧留着一排可点回去。
- **`ui/select-chip` 选中档的描边由饱和紫收成品牌色 40%**（`aria-checked:border-primary`
  → `border-primary/40`，pill / segment / compact 三档同改）。选中档本来已经是
  「深底 `bg-primary-soft` + 浅紫字 + 加粗」三层，再套一圈**饱和**紫环，读起来像
  **输入框被聚焦**而不是**这一档被选中**；而同一件里 `dashed` 档的描边一直是 `/40`
  —— 两档同值才成一套。四层选中信号（底 / 字 / 边 / 重）一条没少：未选中是中性发丝边
  `border-border`（深色实测 `rgb(38,38,46)`），选中是带品牌色相的边
  （`oklab(0.575 0.084 -0.178 / 0.4)`），两态主题下都判得出来。基类顺带补
  `tabular-nums`，让「全部 (12)」这类计数在换档时不左右跳。
  ⚠️ 12 份用例判这一层用的是 `toContain("aria-checked:border-primary")`，
  带 alpha 的写法仍是它的**超串**，因此这一改**不会**报红 —— 那 12 处仍在判「描边这一层
  在不在」，改的是它的浓度。
- **ComfyUI 运行状态那一排：三颗次级按钮此前有两种形状**（`comfyui/ComfyuiControlView.tsx`）。
  「打开查看」与「关闭 ComfyUI」走软底 `primary`，唯独「在浏览器打开」走 `outline`
  再手写 `text-muted-foreground hover:text-ink` 覆写字色 —— 同一层的四个动作长出两种
  底色，读起来像「这四个各有不同职责」，而它们其实是「除实心那一颗之外都点不动」。
  现在三颗次级同档，一屏只剩「启动」一颗实心（ISSUE #672 那次定的层级，这次补齐它漏掉的那一半）。
- **工作流库页头「导入工作流」撤掉那圈装饰发光**（`shadow-lg shadow-primary-500/20
  hover:shadow-primary-500/30`）。这一条**不是新决定**：`CHANGELOG-archive.md:14783` 已经
  立过「去掉三处装饰性辉光：`FinalComposer` 与 `ScriptMarkdownEditor` 的 CTA 上的
  `shadow-lg shadow-primary-500/20`，以及剧本段那两颗 `btn-gradient` 按钮的同类辉光。
  **分层靠描边与字号，不靠按钮发光**；浮层（Agent 面板、弹窗、下拉）的阴影**保留** ——
  那是真实的叠放语义，不是分层替代品」—— 用的是**逐字相同的那串类**，而
  `WorkflowLibraryHeader` 是那一刀漏掉的第四处。DESIGN.md §Elevation 的底色同一条
  （「扁平为主：纯色、无阴影、无模糊、无渐变发光」）。`variant="gradient"` 的 hover
  观感本来就由 `.btn-gradient` 的 `brightness(1.08)` 提供，不靠投影。
  ⚠️ 只撤**按钮上**的这一圈：浮层阴影按那句签字一律保留，别顺手一起清。
- **同一批把「按控件档写」的那层收回来**：`HEADER_ACTION_BTN` 此前自带
  `h-auto py-1.5 text-xs`，实测把三颗压成 ~28px 的一档 —— 既不是基元的 `sm`(h-7) 也不是
  `default`(h-8)，且 CTA 文案落到 `text-xs`（§3.10.1 里 12px 是「段级说明」档，不是按钮
  文案档）。现在这一串只留与缺省档不同的 `shrink-0 gap-1.5 px-3`，其余回落到基元的
  `h-8 rounded-lg text-sm font-medium`。`workshop/WorkshopStageBody.tsx` 那三颗
  （编辑 / 新建 / 导入剧本）同病：渐变那颗写 `text-2xs`(11px)、同排 ghost 那颗写 `text-xs`
  —— 一行里两个字号；现在都回落到 `text-sm`，实测两颗同为 32px 高、顶边对齐。
- **`workshop/ModelAdaptersView.tsx` 的「保存适配器」两处**：① 它吃基元缺省
  `h-8 px-2.5`，比全站其余主 CTA（`h-auto px-4 py-2` = 38px）小一档，改成同档；
  ② 上面那段逐模式映射表单由 `selectedModel` 门控，而这一颗**不门控**、只把自己
  `disabled` —— 于是没选模型时它是一枚悬在整片空白右下角的禁用件。现在跟着同一个判据
  出现（`disabled` 只剩 `saving` 那一半）。选中模型后实测：h=38、`opacity:1`、
  底 `rgb(141,80,226)`。

## 刻意没做的事（写清楚，别当成已完成）

- **没有动 `--gradient-brand` 的三段色**（紫 → 品红 → 浅粉）。暗色下终点取
  `--color-accent-soft` 的深档 `#ff8ac4`、因此比历史上亮一档，那是 DESIGN.md §待定4
  已经**签过字**的既定后果（「跟着品牌 token 走」的直接后果，不是笔误），且
  `tests/theme-token-single-source.test.ts` 把「三段怎么排」钉成一处出口。
  这几处难看的是**发光、字号与高度**，不是色相。
- **没有给 `Button` 加新 variant、也没有新 token**：六处全部落在既有的
  `primary` / `primary-solid` / `outline` / `gradient` 四支与基元缺省 size 上，
  所以 `@theme` 名快照与 `docs/DESIGN.md` 的 frontmatter 都不需要跟着改。
- **没有改 `disabled:opacity-50` 这一条全局缺省**。它确实让置灰的实心紫看着像
  「可点但浅一点」（`service-status-row.tsx` 文件头早就记过这条），但那一档是
  所有基元共用的，抬它的代价落在每一处禁用态上，不属于这一刀。
- **没有动 `ResourceLibrary.tsx` 那枚同款空态按钮**：它的文案是「看跨项目素材」——
  换一条能看的路，不是「去把缺的东西补上」，所以 `outline` 是对的，与模型屏那颗
  该分档而不是并成一档。

## 验证

- `tsc --noEmit` 0 错；`eslint` 改动面 7 份 0 警。
- 门禁：`pnpm theme:check`（未豁免 0 处）、`pnpm ui:primitives`（硬闸 85 条全 0）、
  `check-file-structure` / `check-code-duplication` / `check-dead-exports` /
  `check-ui-logic-separation` 全绿。
- 用例：`select-chip` / `service-status-row` / `ModelLibrary.integration` /
  `ComfyuiControlView` / `WorkflowLibraryLayout` / `LLMSettingsChips` /
  `ChannelSwitchChips` / `design-md-contract-sync` 合计 **8 files / 72 passed**；
  另跑 `login` / `model/ModelLibrary` / `HistoryList` / `LogLevelFilterChips` /
  `HistoryPanel` / `StepLogFilterChips` / `VideoQueueModal` /
  `display-density-toggle` / `workflow-library-config` /
  `theme-token-single-source` 合计 **10 files / 95 passed**（`SelectChip` 被 22 份文件消费，
  选中态那四层逐一点名判过）。
- **真浏览器读数**（Playwright + 本检出 dev server，1440×900、默认深色）：
  模型屏顶栏两颗控件同为 32px 高；「新建剧本」与「导入剧本」同为 32px 且顶边对齐、
  字号 14px、`box-shadow: none`；「保存适配器」38px；选中 chip 的四层取到
  底 `#251d40` / 字 `#b79bff` / 边 `primary@0.4` / 重 600。四屏逐屏截图看过：
  模型屏（搜索框走基元 + 空筛选条不再出现）、ComfyUI 屏（三颗次级同形 + 一颗实心）、
  工作流库屏（页头三颗同高、渐变无发光）、模型适配屏（选中前那颗悬空的禁用件不再出现）。
