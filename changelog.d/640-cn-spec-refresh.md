## Fixed

- **主规范 §4.4.6 与源码相反，已同步（ISSUE #640）**：该节仍写着「当前 `cn()` 为轻量实现：过滤 falsy + 展平一层数组」+「后续应迁移到 `clsx` + `tailwind-merge`」，而 ISSUE #623 已把 `cn` 迁到 `cn@0.3.0`（冲突类合并由它负责，仓库里既没有 `clsx` 也没有 `tailwind-merge` 依赖）。当时改了 `changelog.d/` 与契约测试，漏了规范正文，于是文档长期在教一个已被否决的实现路线。现改为「由 `cn@0.3.0` 提供、单一入口只做 re-export、调用方 `className` 仍必须放最后」，并补「契约由 `src/lib/utils.test.ts` 钉住」与「不要在 `src/lib/utils.ts` 里加第二个工具函数」。`docs/generated/` 里的副本同步重生成。
