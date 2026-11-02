## Fixed

- **`single-logger-channel` 的判据一律先剥注释再判，它那份具名副本同时收进共享件**
  （ISSUE #2660 第八批 + ISSUE #2969 的台账收敛，同一份文件两单的账重叠，一起做省一次回归验证）。

  这一批把方向补齐：#2660 前七批收的是「字面量住在别处 ⇒ 假绿」与「反向断言红在解释上」，
  这份文件里还留着的是**正向断言读原文**那一形 —— 针脚只住在注释里时它照样念绿。改法是文件内
  一处 `codeOf()`（转调唯一实现 `./helpers/strip-comments`，`{trailing:true}`），正向、反向、
  以及那两条「谁 import 了 pino / 谁定义了 `redactSecretShaped`」的全库枚举 filter 都走它。
  唯一保持原文的是 `CLIENT_ONLY` 那条**首行必须写 `"use client"`** 的断言 —— 它判的就是文件第一行
  这段文字本身，剥了反而判错。

  同时它的本地 `function stripComments` 副本换成 import ⇒ `strip-comments-single-source` 的
  `LEDGER` 由 20 份**收紧到 19** 份（那条判据要的正是「只许降」）。

  **两个方向的变异证明**（都打在真实接收者上，每步 `sha1sum` 与快照逐字核对后还原）：

  | 变异 | 旧判据（原文） | 换 `codeOf` 后 |
  | --- | --- | --- |
  | 往 `src/server/lib/logger.ts` 末尾加一句反面举例 `// 旧写法：这里自己 import { pino } from "pino" …` | `2 failed`（红在那句解释上 = 误红） | `7 passed` |
  | 把 `src/lib/comfyui/trace.ts` 那条 `redact-secret` 的 import **注释掉**（实现真的断了线） | `7 passed`（**假绿**：字面量只住在注释里，判据仍念「它在」） | `1 failed` |

  第二行是本批要防的那一半的现场：把一处脱敏守卫的接线注释掉，原判据**一个字都不会说**。
  判决面不变的另一半：改前改后同为 `Tests 7 passed (7)`，与台账格 + 探针自证格合跑 `22 passed (22)`；
  `eslint` 退 0；`tsc --noEmit` 只剩主干那 6 条 `scripts/ci-heavy-gates.mjs`（本批零新增）。
