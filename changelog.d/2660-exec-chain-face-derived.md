## Fixed

- **「执行链的任何模块都不再持有 `EventEmitter`」这一条，判的是一份 9 项手抄清单，而执行链有 17 份**
  （ISSUE #2660 的第二批收窄，对象 `tests/in-process-event-channel-retired.test.ts`）。

  当场读数（只读探针，一次也不改文件）：

  ```
  $ node <探针> src/lib/comfyui/            # 目录里 .ts/.tsx 131 份，去掉 test/spec 剩 79 份
  按名字规则派生出的面：17 份
  派生面比当前登记多出来的：
    + executor-cli-stream.ts  + executor-continuation.ts  + executor-errors.ts
    + executor-history.ts     + executor-mode.ts          + executor-outputs.ts
    + executor-write-retry.ts + firstframe.ts
  ```

  那 8 份不是"顺手多扫几份"：它们和清单里那几份是**同一次拆分**的产物（`executor.ts` 现在只是一张
  barrel，自己的头注写着「执行链按职责分在以下模块」），而拆出去的这些**一份都不在面上**。
  用例里那行 `/** 执行链里「曾经会 emit」的那几个模块。新增执行侧模块时把它加进来。 */`
  把这件事写成了人记得改的口径 —— 覆盖面靠人记得改，就是靠不住。

  失效方向是**假绿不是红**（与本单第一批同形）：`it.for(清单)` 少一项 ⇒ 少一条用例，账面仍是全绿。

  改四处，都不动被测面：

  - **面从目录派生**：`readdirSync("src/lib/comfyui")` 取非 `test`/`spec` 的 `.ts(x)`，
    按 `^(executor|runner-state|enqueue|reaper|firstframe)` 收 ⇒ 17 份，新拆出去的执行侧模块
    自动在面里。**扩面今天不改变任何判决**：那 131 份里 `emitter` 原文命中 13 处、剥完注释后
    **代码里 0 处**（`runner-state-shape.ts` 一份就占原文 5 处，全是解释「为什么不再有它」的注释），
    所以这条不是"存量被清了"，是把「任何模块」这句话的作用域补成它自称的那个。
  - **命名成员前置断言**：面里必须看得见 `enqueue.ts` / `executor.ts` / `runner-state.ts` /
    `runner-state-shape.ts` / `reaper.ts`。派生规则或文件名漂了 ⇒ 当场红并点名掉的是哪一份。
    这条不是装饰（变异见下）。
  - **每份读进来的文本不许是空文**：`src(rel)` 之前没有这一格；`executor.ts` 剥完只剩 430 字符，
    再拆一次就是 0。
  - **`{ trailing: true }` 档 + 对照走同一条链**：有效性对照改为调 `stripCode()` 本身（原来它另调
    一次 `stripComments`，于是「上面那组忘了传 `{ trailing: true }`」这一形不会被它抓住）。
    诚实边界：这一档**今天不改变真文件的判决**（把 `{trailing:true}` 摘掉，只有对照用例红，
    17 份真文件一份都没红）⇒ 它是预防行尾注释那一形误红，不是修一处现成的假红。

  **三条变异证明**（`pnpm exec vitest run` 该文件，逐条 EXIT=1）：

  1. 把 `src/lib/comfyui/executor.ts` 写成只剩一段注释（模拟"代码搬空、解释留下"）⇒
     红的是新的那条前置断言（`AssertionError: src/lib/comfyui/executor.ts：剥完注释是空文，`
     `落在它身上的反向断言恒真: expected '' to not have a length of +0`），
     **而同一次的 `✓ src/lib/comfyui/executor.ts 里没有 emitter 的构造、持有或投递` 是绿的** ——
     这一行就是本单说的那个形状：判据在不判任何东西，而读数与真绿逐字相同。
  2. 往 `executor-outputs.ts`（老清单没有的那 8 份之一）注入一行 `export const legacyEmitterShim =
     new EventEmitter();` ⇒ `× src/lib/comfyui/executor-outputs.ts 里没有 emitter 的构造、持有或投递`。
     老那一版读不读这份文件不由我说：`git show HEAD:tests/in-process-event-channel-retired.test.ts`
     里 `executor-outputs` **0 次命中**。（这一形顺带会被 `check-dead-exports` 抓到，因为它没被消费 ——
     本条对照的是**这一族自己的覆盖面**，不是"全仓只有这一格能抓"。）
  3. 把派生规则里的 `reaper` 改成 `reapers` ⇒ 用例数从 26 掉到 25（少一份文件就是少一条用例，
     这一格自己不会红），红的是命名成员那条
     （`执行链面里不见了 reaper.ts —— 派生规则没命中它了`）。

  两次注入都按字节快照还原（`cp` 回来 + `sha1sum` 与快照逐字相同 + `git status` 只剩测试文件），
  还原后 `pnpm exec vitest run tests/in-process-event-channel-retired.test.ts` **26 条全绿**（287ms）。

  **一处刻意没扩**：`type === "error"` / `type === "progress"` 这两条反向断言仍只钉
  `generation-client.ts` 与 SSE 路由，不跟着扩到执行链 —— 因为 `executor-cli-stream.ts` 的代码里
  这两串各有 1 处命中，而那是**入站的 comfy-cli 帧**（`evt.type === "error"`，落 trace 与进度库），
  与"对外只发 log / state"不是同一件事。同一串字面量在两侧各有含义，扩面会造出一条假红。
  这条与本单第一批的结论同形：**先量命中再决定扩不扩，别拿"覆盖面越宽越安全"当默认**。
