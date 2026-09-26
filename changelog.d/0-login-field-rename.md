## Fixed

- **`app/login/page.tsx:299` 局部 `Field` 组件改名 `LoginFieldRow`**：
  此前 login 页有一个局部 `function Field({ label, type, … })`（三处
  188/197/205 用），与 shadcn `~/components/ui/field` 的 `Field` 基元
  **同名**。当前文件只 import `FormField`、实际不冲突；但只要未来在这个
  文件里加 `import { Field } from "~/components/ui/field"`（比如为了
  套 `<Field>` + `<FieldGroup>` 走 shadcn 表单结构规范），局部 `Field`
  会遮蔽 import · 报"找不到 Field"或更糟：静默用局部版当 shadcn 版走。
  改名 `LoginFieldRow` 消除这个隐患 · 加一条注释说明"为何不叫 Field"
  （免得下一次有人又给改回来）。

## 关联的下一步

`app/login/page.tsx:186` 那层 `<form onSubmit={handleSubmit} className="flex flex-col gap-4">` 里
三个 `<LoginFieldRow>` + 一个 `<Button>` 提交 · 未来若要按 shadcn
`forms.md`「Forms use FieldGroup + Field」把 `<form>` 内层包
`<FieldGroup>` + 每个字段行用 `<Field>` + `<FieldLabel>` 走标准结构 ·
这一改动（消除同名遮蔽）是那条 PR 的前置。
