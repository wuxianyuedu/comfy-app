## Fixed

**scripts 面 core `no-unused-vars` 收编：84 条历史死代码逐条清零**（ISSUE #2541 第二批）。

### 背景

#2583（第一批）把 core recommended 作用面收到 `LINT_FILES + scripts js 面`时，
`no-unused-vars` 对 scripts 关停（68 条历史死代码留待逐条裁决）。本批裁决完，
读数随 master 漂移涨到 84 条（#2561 拆出的 `ci-toolchain-pnpm.mjs` 等）。

### 裁决分布（84 条全部处置，无一处静默豁免）

- **ui-primitives 五文件解构块裁剪（46 条）**：四个规则分片 + 主脚本都从
  `ui-primitives-engine.cjs` 解构同一组 10 个 helper，各自只用子集。按 eslint
  判虚名单把每个文件的解构裁到实际用量，块头留一句「跨片搬规则时同步增删」。
  主脚本那条「判据全留在本脚本里」的过时注释顺手订正（#1811 已拆分片）。
- **死常量 / 死 import（24 条）**：`fs` 死 import ×6（备份已收口 db-backup-core、
  枚举已收口 gate-scan-read 等演进残留）、`SECTIONS`（同源在
  check-changelog-fragments.cjs）、`CACHE_FILE`（oxfmt 换掉 prettier 后缓存键恒
  miss，286-289 行注释自证）、`walk` 整函数（barrel-heavy-deps）、
  `isPureModuleEntry`（判定已内联）、`AT_ALIAS` / `TEST_FILE_RE` / `SRC` /
  `HERE` / `BATCH`（分批从未实现）、`os` / `sleep`（并发已收口 ci-load.mjs）、
  `heads`（结果全走 byPos）、`full` ×2、`let m` 循环（体不读值，条件不再赋值）。
- **形参（5 条）**：heal-db 两处 `catch (e)` 改 optional catch binding；
  generate-api-docs 闭包删未用形参；start.mjs 的 `logLine(message, level)` 是
  接口形态的占位 —— 改 `_level` 配 `argsIgnorePattern: "^_"`（注释写明何时有用）。
- **`.d.ts` / `.d.mts` 声明文件豁免（16 条）**：声明里的参数名是 API 面
  documentation，本就「不使用」，加 files 块关停并写明「无收紧条件」。
- **配置两个选项各有出处**：`ignoreRestSiblings` 是 rest 解构剥字段惯用法
  （check-function-length 的 `({ start, end, named, ...rest }) => rest`）；
  `argsIgnorePattern: "^_"` 给占位形参。
- **顺带**：`ci-toolchain-pnpm.mjs` 判「文本脚本 vs 二进制」的可打印 ASCII 正则
  （ISSUE #2563 回归现场）进 `no-control-regex` 文件级豁免台账，同一功能类。

### 验证

全量 `eslint --max-warnings 0` 清零（scripts 的 no-unused-vars 正式生效）；
`tsc --noEmit` 绿；`oxfmt --check` 绿；受影响判据针对性测试 12 文件 600 条通过
（script-main-guard / check-ui-primitives 347 / lib-node-only-declarations /
precommit-timing / lockfile-diff / tw4-hardgate 等）。
