## Changed

- **oxlint `curly`（给单语句控制流体补 `{}`）全量落地**：1166 份文件的 7194 处 `--fix` 自动改写 + 收尾的紧凑嵌套形态手补，另有 4 份约 900 行的文件按职责拆开（`scripts/check-doc-references.cjs` → `check-doc-gate-refs.cjs`；`scripts/ui-primitives-rules-p67-p86.cjs` → `ui-primitives-rules-p87.cjs`；`src/lib/process/executable-resolve.ts` → `pnpm-resolve.ts` / `version-compare.ts`；`src/lib/comfyui/lifecycle.ts` → `lifecycle-session-log.ts`）。语义零改动，判据与话术一字未变。

- **「读源码做形态断言」的契约测试接上归一化**：`tests/helpers/source-shape.ts` 的 `normalizeControlFlow()` 接到 6 处读源点（`app-port-vectors-timeout-classification` / `app-service-exit-contract` / `ci-cp936-glyphs` / `film-resume-startup-point` / `WorkflowLibraryLayout` 等），并跟改 3 处钉死无括号字面形态的断言与一处按源码原文替换的探针锚点（`ci-toolchain-selfcheck` 补丁 ①″ 改锚「条件那半句」，钉整句会在 `curly` 之后静默 no-op）。
