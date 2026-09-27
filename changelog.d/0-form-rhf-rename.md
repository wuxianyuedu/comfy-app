## Changed

- **`src/components/ui/form.tsx` 改名 `form-rhf.tsx`**：
  shadcn 官方装过来时叫 `ui/form.tsx`、但项目自立的 `ui/form-field.tsx`
  早导出了同名的 `FormField`（是 `ui/field` 的薄封装、补 `htmlFor` /
  `aria-describedby` / 错误行三件套、见 §16.2.4.26）。两个 `FormField`
  撞名 · 只要有人 import 错模块就会**静默用错实现**。改名 `form-rhf.tsx`
  消除遮蔽风险、一眼看出"这是 RHF 那一族"。

  **为何不删**：`docs/standards/16-shadcn-ui与表单校验.md` §16.2.4.8 与 §16.5
  把"不接入 RHF · 字段级校验住 `src/lib/<domain>/*-schema.ts` · 集合级留
  controller"作为决策登记、并把这份 `form.tsx` 记为"已装、代码保留以便未
  来若接入 RHF 时不用重新装"的状态。当前 src 内 **0 消费点**（本会话
  `grep -rn 'ui/form"' src tests` 空返回确认）、是**为将来预留**、不是
  死代码。真接入 RHF 那天、从这里起手、§16.2.4.8 的叙事也随之更新。

## Docs

- `docs/standards/16-shadcn-ui与表单校验.md` 里 4 处 `src/components/ui/form.tsx`
  与 2 处 `~/components/ui/form` 路径 ref 一并改到 `form-rhf.tsx` /
  `ui/form-rhf`；§16.5 表格里追加"命名订正 #1099"一句、说明改名缘由。
- `pnpm doc:render` 重新生成 `docs/generated/`。

## 文件头注释

`form-rhf.tsx` 头部加 22 行注释：解释「为何改名（消除 FormField 撞名遮蔽）」
+「为何不删（§16.2.4.8 决策登记 · 保留代码 · 0 消费点为将来预留）」·
让下一次接手的人不用回头翻文档就知道这份东西的定位。
