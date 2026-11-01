## Changed

oxlint `typescript/no-unnecessary-condition` 第一批：`scripts/**` 里 4 份的机械冗余。

- `m.index ?? 0` 那一族（`affected-tests.mjs` / `check-tracked-secrets.cjs` / `tw4-scan-core.mjs` /
  `spawn-shell-scan.mjs` 共 9 处）→ `m.index`。`RegExpExecArray.index` 在 TS 6.0.3 里**已是必填
  `number`**（`lib.es5.d.ts:980`），这个 `??` 从来不会生效。
- `affected-tests.mjs` 的 `text === null || text === undefined` → `text === null`：`readText` 的
  返回类型就是 `string | null`，`undefined` 那半支在类型与运行时两边都不存在。

`spawn-shell-scan.mjs` 的 `maskStringContents` 有一处**不是**机械删除：`text[i + 1]` 的静态类型是
`string`（`noUncheckedIndexedAccess` 不看字符串索引），而串尾的孤立反斜杠确实没有下一个字符 ——
改成按真值判并把类型标成 `string | undefined`。15 个边界输入与原实现逐字一致（含 `"abc\`、`"\`
这类串尾反斜杠），27 条既有用例全绿。

## 未动（两类，各自的理由不同）

- **`??` 是类型检查要的，不是运行时要的**（`m[1] ?? ""`、`res.reasons.__note ?? "见 --json"`、
  `SpawnSyncReturns.stdout`）：tsc 在 `.mjs` 里读不出「正则必需分组必定存在」与
  「`Record` 上这个键一定在」，删了当场撞脚本档类型检查（§13.5.14）。规则与 tsc 在同一行上
  给出相反答案，这一行归 tsc。
- **`String(r.stdout ?? "")` 那 86 处是必要防御**：`SpawnSyncReturns<T>` 把 `stdout` 声明成 `T`
  （`@types/node:1342`），但子进程起不来（ENOENT）时运行时是 `undefined` —— 实测
  `spawnSync("nonexistent-cmd-xyz")` 的 `stdout` 就是 `undefined`。类型说不可能、运行时说可能。

读数的完整清单与最小复现见 #2941。

#2919
