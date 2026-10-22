## Added

- **台账 E4 第四格的第三刀：`video-queue-client.submitGeneration` 那条 cast 收了**，
  发出去之前先过**服务端那一个** `generateInputSchema`（`parseGenerateInput`），不合格就**不发**，
  原因点名那一列。`src/lib/media/video-queue-client.ts` 自己那份
  `type GenerateInput = RouterInputs["generate"]["generate"]` 同时删掉 —— 入参类型现在只有一处。

## Changed

- **`parseStoredGenerateInput` 改名 `parseGenerateInput`，文案跟着去重**：它现在有两个生产者
  （错误面板的重试、视频队列的草稿），原话术里的「这条记录」「无法原样重跑」只说得了前一半。
  新那句是「这份请求的入参与当前形状不符（`workflow`：缺少要执行的工作流），这次没有发出去；
  请重新配置参数后再生成」—— 判点没动（还是同一个 schema），动的是它走到界面时的说法。
- **`tests/task-list-wire-contract.test.ts` 里 `submitGeneration` 那份既有契约改了口径**（业主点头）：
  原判「`params` 缺省时照样把只有 `prompt` 的入参发出去」，现判「合法的载荷照发、但发出去的是
  判据认的那些列（`width` 这种多余键不再上线）」+「缺必填 `workflow` 就不发，且原因点名那一列」。
  「服务端拒绝原样交回调用方（出口在视图，这里不吞）」那一格逐字保留 —— 它判的是不吞错，与预检不冲突。
- **视频队列的失败通道带上第一条真实原因**：整批都失败时出口那句现在是
  「提交失败：<第一条原因>」，不再是一句万金油的「请检查参数或 ComfyUI 连接」。

## Fixed

- **照出一格产品缺口并立案（不在本批定）**：`VideoQueueModal` 的草稿页签**没有工作流来源** ——
  全仓唯一的挂载点（`src/app/workspace/page.tsx`）不传 `draftItems`，页签内手动加的那一行只有
  `prompt`，`params` 恒为 `undefined`。也就是说这条「批量提交」通路从来没有产得出合法入参：
  过去每条都在服务端撞墙、再被「逐条提交、跳过失败项」那层吞掉，所以没人看见；本批之后它当场
  就说不成立。要真能用，得给草稿一个工作流选择器（或把这一格显式关掉）—— 那是产品决定，
  已登记进台账 E4，不替业主定。

## 判据

- `src/components/studio/VideoQueueModal.test.tsx` 新增一条（整批失败时出口带的是判据点名的那一列）；
  `tests/task-list-wire-contract.test.ts` 两条改写；`tests/generate-input-wire-contract.test.ts`
  跟着改名与新文案。变异三刀各有归属：客户端不判、原样发 → `submitGeneration` 那两格红；
  视图把原因丢回通用文案 → 新增那条红（`Unable to find an element with the text:
  /缺少要执行的工作流/`）；构造里漏掉 `referenceImages` / 预检退化成不判 → 前两批各自的格子红。
