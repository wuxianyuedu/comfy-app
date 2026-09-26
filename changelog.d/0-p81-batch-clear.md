## Fixed

- 视图层 P81 治理一批清零 114 处 → 0：58 个文件的 `<Button>` 直接子 icon 全部补上 `data-icon="inline-start"`（icon 在文字前，或纯 icon 按钮的唯一子节点）。shadcn `buttonVariants` 的 `has-data-[icon=*]:pr-* / pl-*` 选择器从此按预期切内边距；`ui/button.tsx` 的 `size="default|xs|sm|lg"` 档不再退到 `px-2.5` 无 icon 档。
- 深层嵌套（icon 被 `<span>` / `<div>` 包着）不属本判据（P81 只数深度 1 的直接子级 · 见 #1108 的 RULES 注释与 `tests/check-ui-primitives.test.ts` 的「深层嵌套不算这条账」回归）——那种写法就算加了 `data-icon` 也不生效、不逼业务把外层容器拆掉去迎合机器。
- `<Spinner className="size-4" />`（项目自研 loading）不在 `isP81IconName` 白名单，不计本账；`{uploading ? <Spinner /> : <Plus />}` 里的 `<Plus />` 被补上 `data-icon`。
- 基线由 `node scripts/check-ui-primitives.cjs --update` 从 114 → 0。清零后走下一 PR 把 P81 加进 `HARD_GATE_RULES`（对齐 MEMORY 记录的「加棘轮完整节奏」：引入 → 分片治理 → 清零升硬闸）。
