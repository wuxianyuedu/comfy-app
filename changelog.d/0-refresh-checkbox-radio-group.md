## Changed

- **`ui/checkbox.tsx` 与 `ui/radio-group.tsx` 从 shadcn CLI 重新拉齐**
  （`pnpm dlx shadcn@latest add checkbox radio-group -y` 覆盖旧版）：
  两份文件早已存在（`WorkflowRunRawCliModal.tsx:20` 已经在用
  `Checkbox`），本次是**跟 shadcn 官方最新形态对齐**——类串按 CLI 的
  分组顺序重排（tailwind-merge 语义等价、无视觉变化）、import 排序
  按项目 20 个既有基元约定回到「第三方 → 别名」两段（CLI 生成的
  `from "cn"` 直连包名改回 `from "~/lib/utils"`，运行时等价、
  `~/lib/utils` 内部就 `export { cn } from "cn"`）。

## Notes

- 这两件基元**早已装、只是没被广泛使用**：`settings/` 目录下 5 处
  checkbox 与 0 处 radio-group 都在用**原生 `<input type="checkbox">`**
  绕开基元（`ComfyuiSection.tsx:126, 140` / `ExitSection.tsx:25, 49` /
  `UpdateCheckSection.tsx:49`），另有 4 处 raw `<input type="text|
number|password">` 绕开 `ui/input`（`SettingsPrimitives.tsx:108` /
  `RemoteModelDialog.tsx:111, 126, 227` / `LlmLocalSection.tsx:271`）。
  本 PR 只把基元本身**拉齐到最新 shadcn 版**、不动消费点；下一 PR
  再一次性治理 9 处 raw input + 给 `check-ui-primitives.cjs` 加
  P67 的 f（Input）/ g（Checkbox/Radio）两条子判据、把这类反模式
  锁进机器兜底。
