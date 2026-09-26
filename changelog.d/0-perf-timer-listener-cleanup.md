## Fixed

- **定时器 / 监听器卸载泄漏（规范 §8.5 / P7 反模式）**：多处 `setTimeout` 未在组件卸载时清理、window 监听器仅在非保证路径移除——卸载后触发向已卸载组件 `setState` 或监听器泄漏到页面生命周期。
  - `use-library-wire-flow.ts` / `use-workflow-import.ts`：落点提示 / 导入错误提示的 4s 自隐定时器，先清旧再设新 + 卸载清理 effect。
  - `ui/ToastProvider.tsx`：全局 `timers` Map 新增卸载清理 effect，Provider 卸载时清掉所有挂起定时器。
  - `WorkflowRunRawCliModal.tsx`：复制成功提示 1.5s 定时器加引用 + 卸载清理。
  - `use-custom-nodes-settings.ts`：解析「完成提示停留」800ms 定时器改为先清旧再设新，并在卸载清理里清除。
  - `WorkflowCanvasDecorations.tsx`：拖拽缩放挂到 window 的 `mousemove`/`mouseup` 监听器，拖拽未结束时（鼠标按住未松手）组件卸载会泄漏——登记到 ref 并在卸载时移除。
  - `src/lib/external-open.ts`：文件夹帮助探测的 `blur` 监听器改为 `handled` 时立即移除 + 超时兜底移除，避免永不调用 `settle()` 时泄漏。
