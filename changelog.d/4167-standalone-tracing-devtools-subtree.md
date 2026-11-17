## Fixed

- **每日生产构建（GA Linux runner）红在执行器宿主冒烟：产物缺 `scripts/devtools/env-preflight.mjs`**（ISSUE #4167）：
  根因是 `outputFileTracingExcludes` 在 Linux（正斜杠路径）上按 contains（子串）语义匹配整条产物路径——
  `devtools/` 含子串 `tools/`、`affected-tests/` 含 `tests/`，连同 `docs/`、`e2e/` 整棵子树被排除出
  全项目追踪；而 `RUNTIME_SCRIPTS` 白名单只保证「剔除时保留在场文件」，救不回「追踪根本没带进来」的件。
  Windows 路径用反斜杠，子串匹配打不中，所以本地构建一直绿、测不出这一类缺件。
  修复两件同批：把 `scripts/devtools/env-preflight.mjs` 与 `scripts/devtools/install-comfyapp-helper.ps1`
  逐件登记进 `next.config.js` 的 `outputFileTracingIncludes`（§7.5.1 的既定补法：excludes 只做减法，
  缺件只能由 includes 加回）；`pnpm build` 收尾冒烟新增「RUNTIME_SCRIPTS 逐件在场」检查，缺件时一次
  列出全部缺件与修法，不再等宿主 `ERR_MODULE_NOT_FOUND` 反推。
