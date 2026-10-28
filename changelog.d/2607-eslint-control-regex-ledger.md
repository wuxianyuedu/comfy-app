## Fixed

- **`scripts/ci-toolchain-pnpm.mjs` 补进 `eslint.config.js` 的 `no-control-regex` 文件级豁免台账
  （ISSUE #2607，`master` 上那条天天念的红）**：治的是「抄了函数、没抄登记」这一格。

  当场读数（本机 `pnpm run lint`，`--max-warnings 0`）：

  ```
  scripts/ci-toolchain-pnpm.mjs
    369:10  error  Unexpected control character(s) in regular expression:
                  \x09, \x0a, \x0d  no-control-regex
  ```

  那一行是 `looksLikeScript()` 里「这文件是不是可打印文本」的判据
  `/^[\x09\x0a\x0d\x20-\x7e]{2,}$/` —— 控制字符是**刻意的**（制表 / 换行 / 回车要算文本），
  与 `src/lib/process/executable-resolve.ts` 的 `executableKind()` 里那一条**逐字同形**，
  而后者早就在台账里（`#2541` 探测后抽查 6/6 全是功能）。这两份实现是 ISSUE #2562 里
  **刻意各留**的（工具链自证那一格不许 import 仓库内模块，它要在「Node 模块链还没被证明
  可用」的机器上给出可读输出）—— 既然规则要求「同一条判据同批改」，**豁免台账也是同一条
  判据的一部分**；从那份文件落主干那天起 `ESLint 零警告` 就是红的，而它挂在每日档 ⇒
  表现是「每天念一条」而不是「谁都提交不了」，所以没人被它挡住、也就没人去收它。

  `.githooks/pre-push` 的合并前复算把这句话逐次念给了每一个推送的人（本机实测）：

  ```
  [pre-push] ⚠ 本分支没有引入新的红，但 master 上已有 1 条：
        · eslint（零警告，范围见 package.json lint）
  ```

  按 `base-check` 的口径（别线的红：挡路的就地收掉）落在这一笔；**只登记，不改那条正则、
  不放宽规则**（豁免仍是文件级，新增文件里真写出意外的控制字符正则时照样被拦）。
  单里另外两格留作跟进：那条注释为什么现在才补、以及「台账 ⇄ 盘上含控制字符正则的文件」
  的双向对账判据 —— 现在这一格没有任何判据，「谁漂了」只能靠一次全仓 lint 撞上。
