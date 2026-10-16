## Fixed

- **「这一次没量到」被当成「这个命令不存在」—— 探针失败码也要分两类**（ISSUE #1961）。

  同一条链上两件**独立成立、互不排斥**的事之一（另一件是
  `changelog.d/1961-env-path-key-case.md`：`{ ...process.env }` 在 Windows 上拿不到
  `PATH`，那才是 `E2E 关键流程` 那一格的直接真因）。

  机制：一次「起一次确认」失败时，libuv 给的 `code` 是**非空**的，而 `usableCommand`
  原先照「非空即失败」读 ⇒ 候选被跳过 ⇒ 全跳过 ⇒ `whichCommand()` 返回 `null` ⇒
  上层读成「这个命令不存在」。而失败码里有一类说的是**机器当时的状态**、不是这个命令的
  属性 —— 而 `c42b15f3` 只摘了其中的 `ETIMEDOUT` 一个。

  修法：新增 `isTransientSpawnCode()`（模块内），把两类分开：

  - **没量到**（按可用返回）：`ETIMEDOUT` + 资源类 `EAGAIN` / `EMFILE` / `ENFILE` /
    `ENOMEM` / `EBUSY` + `UNKNOWN`（libuv 认不出的码一律落到它，满载节点上它来得**快**，
    不是超时那条路）；
  - **结论**（照旧算不可用）：`ENOENT` / `EACCES` / `EINVAL` / `ENOEXEC` ——
    那是「起了一次、明确失败」，与「没来得及起」不是同一件事。

  判据放在 `usableCommand` 而不是默认探针里：探针只负责**取事实**（libuv 给了什么
  code），「这个 code 算不算不可用」是判据，对注入探针的单测一视同仁。同类码用**具名
  集合**表达 —— 下一个码该归哪一类，看集合名就知道。

  同源口径：§13.6.2「**拿不到测量 ≠ 测量结果是红的**」。这里多一层 —— 它也不等于
  **被测对象**有问题。

  回归判据（`src/lib/process/python-resolve.test.ts`）：`it.for` 五个「没量到」的码逐
  个判「按可用算」+ 一条反向「`ENOEXEC` 照旧判 `null`」。反向复算：条件退回
  `!code || code === "ETIMEDOUT"`，那 4 个资源码的用例当场点名。
