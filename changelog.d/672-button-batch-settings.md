## Changed

- **P1 按钮分批第四批：`app/(main)/settings/` 与 `components/settings/` 清零** —— 45 处手写 `<button>` + 11 处自写 spinner，棘轮基线 291 → 235（`scripts/.ui-primitives-baseline.json`）。共 14 个文件：`RemoteModelDialog`（7）/ `UsageTestDialog`（11）/ `LlmLocalSection`（5）/ `LlmRemoteSection`（5）/ `page.tsx`（4）/ `ComfyuiSection`（2）/ `DatabaseSection`（2）/ `SettingsShell`（2）/ `SettingsOverlay`（2）/ `AppUpdateSection` / `AppearanceSection` / `SettingsPageView` / `SettingsPrimitives` / `UpdateCheckSection`。

  最大两处是「实际使用」测试弹窗（关闭 ✕、预设字段 chip、mode 快捷选择、字段行的「链接」/ 删除、添加字段、结果面板的「打开视频」与「继续等待」）与「添加 / 编辑模型」弹窗（关闭 ✕、测试连接、撤销 / 清除密钥、服务端模型 chip、取消 / 保存）。

- **设置页的主按钮原语 `Btn` 改名为 `StatusButton`，底子换成 `ui/button` 的 `<Button>`** —— 它此前是第二个 `<button>` 实现（自拼尺寸类 `rounded-lg px-4 py-2 text-sm font-semibold` + 自拼配色 `bg-primary hover:bg-primary-hover text-white`）。现在配色交给 `variant`（`primary-solid` / `success-solid` 等语义变体），本模块只保留状态行的**排布契约**（`statusButtonClass`：不许换行 / 不许被 flex 压扁 / 行框归位，ISSUE #423），与工作流编辑器顶栏的 `topBarButtonClass` 同一手法（规范 §16.2.4.2 第 3、4 条）。

- **`ui/button` 新增 `warning-solid` 实心变体** —— 「继续等待视频生成」是实心琥珀（`bg-amber-500 text-white`），它同时是「进行中」与「需要用户动手」两种语义的交叠，软底不足以表达。P1 第一批只出了品牌 / 危险 / 成功三色（当时实测只有这三色有实心用法），本批按实测补齐。

- **`ui/page-loading` 新增 `Spinner` 裸转圈出口，`PageLoading` 改为复用它** —— 按钮内联加载态放不下块级的 `PageLoading`（居中 + 文案），调用点于是各自写 `<Loader2 className="animate-spin" />`，那正是 P3 判据所计数的「自写 spinner」。收口后全库只剩一处 `animate-spin`（在 `Spinner` 里），`PageLoading` 也复用它。内联场景统一用 `<Spinner />` 而非 `PageLoading label=""`。

- **新增 `ui/status-dot.tsx`：`StatusDot`（服务/进程状态圆点，全库唯一实现）** —— 设置页三条同构状态行（ComfyUI / Drizzle Studio / Ollama）此前各写一份四分支的三元套娃表示「运行中 / 启动中 / 检测中 / 未运行」，配色还各写各的 Tailwind 色值（`bg-emerald-400` / `bg-amber-400` / `bg-sky-400` / `bg-rose-400`），改一处漏一片且不受主题 token 控制。状态语义（`up` / `busy` / `probing` / `down`）与颜色（`bg-success` / `bg-warning` / `bg-info` / `bg-destructive`）收在一处，三条状态行的圆点判定改由纯派生函数（`comfyDotState` / `dbStudioDotState`）给出。日志「跟随中」的脉冲小点也复用它（`pulse`）。

- **视图里的配色字面量随转换一并收口**（规范 §3.6.2）：设置页残留的 `emerald-*` / `amber-*` / `sky-*` / `rose-*` / `red-*` 全部换成 `success-*` / `warning-*` / `info-*` / `danger-strong` 语义类名 —— 提示条、测试结果面板、失败行提示、额度警告、主题卡选中态、模型移除按钮的 hover 色都在内。

## Fixed

- **`settings-status-row-config.test.ts` 的两条断言与实现脱节**：它断言「本地 Btn 走 statusButtonClass」与 Ollama 行的 `className="ml-auto shrink-0"`，而主按钮原语已换成 `ui/button` 的基元、`shrink-0` 由 `statusButtonClass` 提供。断言改成「原语底子是 `<Button>` 且不再含 `<button>`」+「Ollama 行传 `ml-auto`」，并把原语体的取样起点改到 `export function StatusButton(` 之后 —— 文件头的文档注释里写着「这里此前是第二个 `<button>` 实现」，不改取样会把**说明**当成实现计上（同 `check-ui-primitives.cjs` 的注释剥离教训）。
