## Changed

- **撤掉 `~/components/ui/page-loading` 的 `Spinner` re-export，15 处消费点直连 `~/components/ui/spinner`**：
  本件在 P67 治理 PR-2 期间把 spinner 实现下沉到 shadcn 基元 `ui/spinner`，但为了
  不打破既有 `import { Spinner } from "~/components/ui/page-loading"` 的消费点、
  留了一层薄 re-export（文件头注释自认「留作后续 PR 逐条换到 ui/spinner 直连」）。
  同一实现两个 import 址会让「Spinner 从哪来」变模糊，也是 §12.18 复用优先里
  要消掉的那种中间地带。本批一次性把 15 处 import 全量迁到直连 `ui/spinner`、
  把 re-export 撤除：`AgentOverlay.tsx`、`UsageTestDialog.tsx`、
  `UpdateCheckSection.tsx`、`LlmLocalSection.tsx`、`AppUpdateSection.tsx`、
  `ui/confirm-dialog.tsx`、`ModelLibrary.tsx`、`ToastProvider.tsx`、
  `EmptyCanvasHint.tsx`、`MaterialLibraryPanel.tsx`、`WorkflowLibraryList.tsx`、
  `sections/DetailHeader.tsx`、`CustomNodesSettings/NodesTab.tsx`
  （13 处 `import { Spinner }`）+ `ui/page-loading.tsx` 内部把
  `Spinner as ShadcnSpinner` 的 alias 撤掉、改直连。
  `page-loading.tsx` 从此只管 `PageLoading` 一件事（页面级居中 spinner + 文案 +
  布局）；`page-loading.test.tsx` 的 import 也改到 `./spinner`、文件头注释
  同步更新（测试文件保留原名是历史沿革、不断裂既有 `pnpm test` 目标）。

## 未做（留作后续 PR）

- **`ui/combobox.tsx` 与 `ui/form.tsx` 的删除**：两者 src 内 0 引用（combobox 是
  Base UI 版、multi-mode-select 的注释已在 #998 订正为对齐 Base UI；form 是
  RHF 族、RHF 未接入）。但 `docs/standards/16-shadcn-ui与表单校验.md`
  §16.2.4.8 与 §16.5 都在讨论 `ui/form` 的选型（决定不接入 RHF），删除该
  文件需要连带订正这几段文档；`combobox.tsx` 也同理由（多模式选择器文件头
  的整段「为什么不合并到 Combobox」论证需要跟着调整）。这类**文档与代码
  原子更新**留到下一批做。
