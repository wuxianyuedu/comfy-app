## Changed

- **「模型适配」「模式契约」从弹窗改成与设置 / 控制台同形的视图页签**（用户要求的三件事里的第三件）。
  侧栏那两项此前是「全局浮层入口」：点开弹窗、不改视图。它们和设置、控制台是同一族问题 ——
  读写的是**全局注册表**（模式契约 = 每种模式有哪些统一输入 / 输出；适配器 = 每个远端模型 ×
  每个模式的字段映射），与当前项目无关，而配置一张适配器恰恰要来回对照工作流库的模式定义 ——
  弹窗形态下没有页签、不能一边配着别的一边看。
  - 登记进 `WorkspaceView` / `NAV_ITEMS`（排在「流程」之后、「控制台」之间，理由沿用旧注释：
    契约口清单是工作流库配落点的依据、适配器是远端模型的字段映射，两件事都服务这条链路）/
    `WORKSPACE_VIEWS` 白名单 / `renderCenter` 分支。
  - `OVERLAY_NAV_ITEMS` / `OverlayNavItem` / `OverlayEntryId` **整套删掉**，`AppShell` 里那份
    `overlay` 单值状态与两处条件渲染一起删。留着一套「点开弹窗、不改视图」的平行建模，
    同一个功能就会有两种「开没开」的真相（外壳那个布尔 vs 页签状态），而那正是这一刀要消掉的形状。
  - 懒加载的归属收进 `app/workspace/page.tsx`（别的视图都在这里）。此前外壳自己 lazy 两份弹窗，
    与 `page.tsx` 那批视图是两套加载路径。
- **三个入口落到同一对页面，不再各开各的弹窗。** 旧形态下「模式契约开没开」同时存在于
  外壳的 `overlay` 状态与 `ModeContractSettings` 自己的 `useState(false)` 两处：
  - 工坊阶段内的「API 直连未配置 → 去配置」：`use-workshop-pipeline` 的
    `apiSettingsOpen` 布尔 + `openApiSettings` / `closeApiSettings` 一对回调 +
    `WorkshopPipeline` 里一层弹窗挂载，全删；改成一个 `openModelAdapters`，广播
    `workspace:navigate`（与工坊右栏「在资源库中打开」**同一条已收口的通道**，载荷类型
    同一份，`tests/app-event-pairing.test.ts` 盯两端配对）。
  - 工作流库页头那枚按钮：`ModeContractSettings` 从「useState + 渲染弹窗」收成只剩入口本身。
- **退役的名字一并清掉**（`API 通道设置` 指的是这个界面早期的名字，而它现在连弹窗都不是了）：
  三处阶段内按钮文案、两处「未配置」提示、`api-channel-core.ts` 那条用户可见的降级提示、
  `docs/guides/feature-workshop-flow.md` 的那一格（含生成物）。
  `generation-client.ts` 里那处提到旧行为的注释**留着** —— 它说的是历史形态，改了反而说不通。
- 两个视图的页眉**不再自绘关闭按钮**：那枚 ✕ 是弹窗时代的产物（`ui/dialog` 的内置关闭被关掉、
  改由页眉画一枚）。视图这一层的「关」由页签自己的关闭按钮承担。连带删掉
  `useModeContractEditor({ onClose })` 这个入参与控制器上的 `onClose` —— 没有消费者之后，
  它就是一条指向空气的退路（§12.16）。
  `ModeContractEditorView` 正文那层 `min-h-0 flex-1 overflow-auto` 也一并改成普通排布：
  那是「卡片有 max-h、内部自己滚」的形状，搬到 `DocumentFrame` 里那三个类既不生效（父层不是
  定高 flex）又误导。

## Removed

- `WorkshopModelAdapterModal.tsx` → `ModelAdaptersView.tsx`（`git mv` 保历史）。
- `mode-contract/ModeContractDialog.tsx` → `ModeContractView.tsx`（同上）。
- `NavItems` 的浮层入口那一套建模（`OVERLAY_NAV_ITEMS` / `OverlayNavItem` / `OverlayEntryId`）。

## Tests

- 新增 `e2e/overlay-entries-as-views.spec.ts` 四条 @critical：侧栏两项各开出一页页签且
  **内容真的渲染**（取该页无条件渲染的独有文案）、重复点击不产生第二页、页签条仍可操作
  （能点回首页）、内容**不在 `role=dialog` 里**（这一句才是「改成视图」的正面判据 ——
  只判「内容可见」时弹窗也满足）；再加一条判两页能并存（旧形态下外壳那个 `overlay`
  是单值，第二下会把第一层顶掉，页签数不会涨）；最后一条判**工作流库页头那枚**按钮。
- **第一条反向验证抓到一条装饰性判据**：工作流库那条最初写成
  `getByRole(...).last().click()`，反向验证（把那枚按钮退回「自己开一层弹窗」）它**照样绿** ——
  因为同名只匹配到一枚时 `.last()` 仍点中侧栏那枚，用例从头到尾没碰过被测组件。
  补上前置断言「同名按钮此刻恰好两枚」并改用 `.nth(1)` 之后，同一个反向验证才真的红。
  这条前置断言的注释里写明了它治的两种失败形态。
- 第二条反向验证：把 `renderCenter` 的 `case "model-adapters"` 掏空，判据红在
  「模型适配 视图里缺『选择远端模型（生图 / 视频）』」。
- `AppShell.overlay-entry.test.tsx` → `AppShell.sidebar-view-entry.test.tsx`（4 条）。
  其中**两条判据方向随形态一起翻了**：旧版判「点击挂的是不是同一个弹窗」与「浮层入口
  **不参与**视图高亮」（那时它们根本不是视图）；新版判「点击走 `onSelect(视图 id)`」与
  「当前视图就是它时**要**参与高亮」。另加一条读 `AppShell.tsx` 源码文本的判据 ——
  外壳里不该再出现这两个视图组件的名字，防的是有人图省事把弹窗壳加回侧栏那一条路
  （运行时判据抓不到「外壳里多挂了一份当前没点开的弹窗」）。
- `nav-items.test.ts`：全局项清单加入两项（有序清单本身就是「不许静默增删」的那道闸）；
  旧的 `OVERLAY_NAV_ITEMS` 三条换成两条 —— 一条继承「按序 + 标签不许漂」，
  一条判那三个退役标识在 `NavItems.tsx` 里**一个字都不该再出现**。
- `VideoStudio.test.tsx` 补一条判阶段内那枚就近入口：此前它的回调在所有用例里都写成
  `() => undefined`，**没有任何用例断过它被调用**（接错线的表现就是按钮变成装饰）；
  现在判「点它 ⇒ `onOpenModelAdapters` 被调一次」，同时把按钮文案钉成「模型适配」——
  与它要去的那一页标题同名。

## 连带后果：改侧栏 = 让**另一档**基线过期，而这件事此前没人能发现

侧栏多两项，凡是把侧栏拍进去的基线都会变。实测 win32 档有四张红：
`canvas-empty` / `canvas-filled` / `models-empty` / `overlay-log-default`（差 1201~1643 像素，
位置就在侧栏那一条）—— 这四张本刀已按登记口径重录并复跑自证。

⚠️ **更要紧的是 linux 档**：同名那几张最后一次入库是 `f562cfc7`（2026-10-08），而
`848088bc`（2026-10-09，「设置」进侧栏）之后它们**就已经过期了** —— 不是本刀弄坏的，
本刀只是把同一件事再推远一步。为什么没人发现，三条一起才成立：

1. 像素档**不在 pre-commit 里跑**（`.githooks/pre-commit` 那一步的注释写得很明白：
   「钩子里不跑像素」，它只跑「每档都有主」那份新鲜度账）；
2. win32 档被 `PENDING_PLATFORMS` 的硬闸拦着（缺首页那两张 ⇒ `pixel-run` 退出码 2，
   不起 webServer）⇒ 唯一能随手跑像素的那台机器**跑不了**；
3. #623 之后没有 CI 兜底 ⇒ linux 那台能跑的执行环境**没人跑**。

三条叠起来的结果是：「改了侧栏」这种再普通不过的改动，可以让另一档基线静默过期而**任何
门禁都不报**。这正是 #1598 的 changelog 里认下的那笔账（「补齐前该档没有执行者」）第一次
真的咬人。还账入口是 **#1282**（linux 档基线过期），本刀不顺手改 linux 基线 —— 那只能在
linux 上重录，在 Windows 上改名交进去是造假。

