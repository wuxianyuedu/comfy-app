## Removed

- **`src/components/ui/combobox.tsx`**（Base UI 版 Combobox）—— 界面层
  最严格审计（`shadcn-strict-audit-2026-09-25.md` §2.9）判为**「装了但
  src 内 0 消费点」的死装件**。全库检索确认：无 `import from
  "~/components/ui/combobox"`；`aria-combobox` 与 `role="combobox"` 的语义
  字符串与基元无关。删除。

## Fixed

- **`ui/multi-mode-select.tsx` 文件头「为什么不合并到 Combobox」论证**：
  原本写「1bfc79c 装了 ~/components/ui/combobox」+「若未来 combobox 换
  栈（例如退回 cmdk）或本件被拆解，这段需要重新评估」。改订正为「**曾装
  过、已删除**」+「三条独立论证与磁盘上是否装有 combobox 无关、即便未来
  重新引入也需要独立评估」。这样文档与本 PR 的代码删除保持一致 ——
  论证保留（它是本件"为什么自成一件"的根据、与 combobox 存在性无关），
  只是把"现在装了"的时间状语改成"曾经装过、现在没了"。

- **`docs/standards/16-shadcn-ui与表单校验.md` 里 combobox 3 处引用**：
  都是**语义概念**（"combobox 形态 / a11y 契约 / combobox 语义"），不是
  基元名的点名引用，无需同步修改。

## 决策记录（不做的事）

- **`ui/form.tsx`（react-hook-form 的 Controller/FormProvider 绑定层）**：
  同为"src 内 0 消费点"、且导出的 `FormField` 与项目 `ui/form-field.tsx`
  的 `FormField` **同名易撞车** —— 但 `docs/standards/16` §16.2.4.8
  「第二档的落地：表单校验规则归谁持有」把 `ui/form` 记成
  **「决定不接入 RHF，但已装、代码保留以便未来若接入时不用重新装」**，
  并在 §16.5 里以「✅ 已生成、开箱即用」的状态登记。删掉它需要同步改
  §16.2.4.8 + §16.5 两段决策叙事（"装了但决定不接入" vs "不装了、
  未来接入时重装"是两种合规口径）。这条**收益不对等**（少一个同名符号 vs
  改两段规范叙事），**本 PR 保留 ui/form.tsx**，改名 `form-rhf.tsx`
  消除同名撞车的口子留下一次 PR 独立处理。

## 自查

- [x] pre-commit 29 道全绿
- [x] `changelog.d/0-remove-dead-combobox-and-doc-sync.md` 碎片
- [x] `grep -r "ui/combobox" src tests` 命中 0（除本件自身被删掉）
- [x] multi-mode-select 论证与实际磁盘状态一致
- [x] 注释中文；R10 通过
