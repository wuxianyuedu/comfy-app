## Fixed

- **补齐 P70 硬闸遗漏的 2 处 `space-y-*`**：`CharacterReviewButton.tsx` 的评审面板（内容容器与 `verdict.issues` 列表）漏在「全库 107 处 `space-y-*` 清零」之外，导致 P70 硬闸在 `master` 上即为红、任何本地提交都被 `pre-commit` 卡住。按 shadcn `styling.md` 的标准替法改为 `flex flex-col gap-*`，列表对齐同款 `ShotReviewDialog` 的 `flex list-disc flex-col gap-1`。
