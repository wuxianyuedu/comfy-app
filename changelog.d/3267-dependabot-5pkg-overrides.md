## Security

- **`pnpm audit` 命中 10 条 → 2 条**（ISSUE #3267，GitHub 镜像仓 Dependabot 页面点名的 5 个包）：改动前 `low 4 / moderate 6 / high 0 / critical 0`，改动后 `low 2 / moderate 0 / high 0 / critical 0`。走的是 §13.5.9 出路 ① —— 全部按 registry 给的 `patched_versions` 取**最小可达修复版**，仍写 `pnpm-workspace.yaml` 的 `overrides`，不升顶层依赖（这 5 个包全无一处是我们直接 import 的）。

  | 包 | 旧 → 新 | advisory | 落点 |
  | --- | --- | --- | --- |
  | `fast-uri@3` | `3.1.8` → **`3.1.9`** | `#1243098` / `#1243104` / `#1243101` / `#1243107` | `ajv@8.20.0` 的 20 条路径 |
  | `ip-address@10` | `10.7.1` → **`10.7.4`** | `#1242883` | `express-rate-limit` / `socks` |
  | `hono@4` | `4.13.7` → **`4.13.11`** | `#1242595` | `@hono/node-server` / MCP SDK |
  | `minimatch@10` | `10.2.6` → **`11.0.1`** | `#1244623` | `@eslint/config-array` / `@ts-morph/common` / typedoc |
  | `glob@13` | `13.0.6` → **`14.0.2`** | `#1244013` | `@sentry/bundler-plugins` |

  前三条是**抬高已经存在的 override 键**（又一次「旧 override 被新 advisory 追上」，§13.5.9 已记过两次）；后两条是新增，且是 `webpack-dev-middleware@6 → 7.4.5` 之后第二批**跨 major** —— 受影响区间 `>=7.0.0 <11.0.1` / `>=9.0.0 <=14.0.1` 里没有同 major 的修复版，不跨就消不掉。

- 剩下 2 条 low 是 `elliptic#1112030` 与 `deepmerge#1243505`，公开 advisory 库的 `first_patched_version` 都是 `null`（上游未发修复版），另立 `#3268` 记录，不在本次改动面。`check-dependency-audit.mjs` 的 `BLOCKED_SEVERITIES` 只管 `high/critical`，本次没动判据口径。

## Changed

- 两条跨 major 的键**必须带 major**：锁里同时有 `minimatch@3.1.5`（eslint-plugin-import / jsx-a11y / react / `glob@7`）与 `glob@7.2.3`（rimraf / flat-cache），它们都不在这两条 advisory 的区间内；写不带 major 的全局 override 会把它们顶到 11 / 14 上（`brace-expansion@1` / `@5` 双键就是为同一形状写的）。`pnpm why` 回读：旧 major 两支都在、仍是 CJS 且可用；`glob@14.0.2` 自带 `minimatch@11.0.5`（也在区间外），`path-scurry` 随它从 2.0.2 到 3.0.0。
- 同步 `pnpm-workspace.yaml` 里 `webpack-dev-middleware@6` 那条注释的「唯一一条跨 major」口径（`#3267` 之后多了两条），并给 5 条 override 各补 advisory / 引入路径 / 为什么走 override；注释语言仍全中文。

## 验证

- 本机可执行判面 `temp/verify-3267.mjs`（`temp/` gitignored）：**16/16 相符** —— ① 用 `git show HEAD:pnpm-lock.yaml` 的旧版本对改动前 advisory 区间逐条判「旧命中 / 新不命中」；② 从**真实消费方落点** load 并真跑：`@eslint/config-array` 那层 `minimatch@11.0.1` 的 `minimatch()` / `Minimatch`，`@sentry/bundler-plugins` 那层 `glob@14.0.2` 扫 `scripts/check-*.cjs` 命中 63 份，另三条补丁版的入口 + 基础 API，两个旧 major 仍是 CJS 可用；③ audit 前后读数与「剩余两条都无修复版」。**不是只验装得上。**
- **反向验证**：摘掉 `'minimatch@10': '11.0.1'` 一条 → `pnpm install --lockfile-only` 让锁文件回落到 `minimatch@10.2.6` → `pnpm audit --json` 重新命中 `#1244623`（`moderate 0 → 1`）；恢复后两份文件 sha256 与备份逐字一致、audit 回到 `low 2 / moderate 0`。
- 判决面：`pnpm run lint` 384 条规则 / 2476 文件 `0 warnings 0 errors`；`pnpm run check:premerge` 43 条判据红 0、`current-green`；`node scripts/check-dependency-audit.mjs` `high/critical 命中 0 条`、exit 0；`pnpm check:deps-freshness` OK；`pnpm deps:guard` 0（install 前）；`check-allow-builds.cjs` 覆盖 3 个带构建脚本的依赖、exit 0。定向用例 `dependency-audit` 17 / `strip-comments-single-source` 7 / `lockfile-diff` 21 / `check-commit-claims` 26（16 skipped）/ `check-allow-builds` 18（15 skipped）共 58 passed、49 skipped，整份 `deps-freshness-gate.test.ts` 18 skipped —— **win32 的 skipped 按三态是「没给结论」，不是通过**。
- ⚠️ **本机 `pnpm build` 这一格没给结论**：进程停在 `✓ Running next.config.js took 425ms` 后再无输出，30 分钟累计 CPU 49s（基本空转），已终止；按 §13.6.3 记为「没跑起来」，**不写进已校验清单**。`next.config.js` 没有接入 Sentry 插件，`glob@14` 只在 bundler-plugin 链上，所以该卡住与本次依赖改动无关；跨 major 的工作路径改由上面「消费方真实落点真跑」覆盖，构建侧由平台 CI 兜底。
- 另：`check-allow-builds` 稳定打印「1 个条目在扫描期间消失（工作区并发变更）」，实为 pnpm 固有的 `.pnpm/node_modules` 被误当 store 条目，与本次改动无关，另立 `#3269` 记录。
