## Changed

- **oxlint 迁移·机械批 2：`eslint/curly` 加花括号**——所有控制语句的单语句体补 `{}`（预设 `oxlint-config-awesomeness` 同款 `curly: "error"`，即 `"all"` 形态：杜绝 dangling-else 歧义与单行体误读）。7194 处 `oxlint --fix` 全自动收敛 + 2 处 fixer 在紧凑单行嵌套里不吃的 `if` 体内层手补（`scripts/check-dead-exports.cjs`、`src/lib/comfyui/executor-outputs.ts`）。纯语法形态改写，零运行时语义变更；tsc --noEmit / 暂存面 oxfmt / 脚本档基线全绿。已主动扫过 `tests/` 里解析源码文本的契约用例，确认无 `not.toContain("if (") / for (...)` 这类会被加括号前缀反转的断言。这是「每规则一个 PR」机械批的第二条（接 #2685 / #2699 / #2744）。


  > **本批豁免 4 个 ~900 行文件**（待专门的拆分工夫，不是 curly 批能顺手做）：infra 面 `scripts/check-doc-references.cjs`、`scripts/ui-primitives-rules-p67-p86.cjs`；src 面 `src/lib/process/executable-resolve.ts`（943 行）、`src/lib/comfyui/lifecycle.ts`（908 行）。加括号把这四个文件顶过 900 行硬闸（§12.6 R5：`check-infra-file-size.cjs` 管 infra、`check-file-structure.cjs` 管 src，存量均已清零、无基线可登记），pre-commit/pre-push 直接拦下。这闸的唯一出口是「按职责拆模块」，对机械 lint 批是越界重构，故本批先不动这四个文件（保持 <900），它们的 curly 合规留待拆分 PR 一并收口。
