## Added

- **`next.config.js`：`experimental.turbopackAdditionalRoots`（issue #2521，解 #2081 死局）**。
  依赖缓存槽（`ci-slot-apply.mjs`）把作业 `node_modules` 接成指向项目根外的 junction，
  Turbopack 对 `next build` 硬拒（`Symlink … is invalid, it points out of the filesystem root`，
  见 `changelog.d/2081-*`）。#2081 当年判定官方 `turbopackAdditionalRoots`「在 Next 16.3.8
  不存在」而作罢；本仓已锁定 `next@^16.4.3`，该选项现为 `config-shared.d.ts:382` 里的
  `Record<string, { path; ignoreIfMissing? }>`，字段 doc-comment 即 *"symlinked dependencies
  may resolve into"* —— 正是为 pnpm 符号链准备的。
  - 仅当 `COMFY_CI_SLOT === "1"`（CI 接槽）时登记，把槽根
    `<store 卷>/ci-cache/<包名小写>`（与 `ci-cache-slot.mjs` 的 `resolveCacheRoot` 同源）
    登记为附加根，Turbopack 即顺着链解析而不再拒；
  - `ignoreIfMissing: true`：不接槽的本地/dev/PR 构建下该根不存在，仅告警忽略；
  - 槽根推导**内联**最小实现、不 import 槽脚本（next.config 每次构建加载，避免把
    spawn `pnpm` 的槽逻辑拖进配置加载面）。两处漂移责任同 §12.12。
  - 本增量只加配置、不动每日槽开关；每日构建重新接槽是独立的、可回退的一步（§13.5.25），
    其收益（~35s/天 + Turbopack 持久缓存跨运行复用）由 **CI 每日档**真正验证。
