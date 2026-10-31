## Fixed

- **「启动器不经 shell 层」那一格读的是一份已经不 spawn 的文件，并且绿在一段注释上（ISSUE #2660 的第一批收窄）**。
  现场是普查之后动手时当场撞出来的，比普查本身更有说服力：

  ```
  $ grep -n "spawnSync(" scripts/run-affected-tests.mjs
  18:   * 现在的链路：`node` → `spawnSync(process.execPath, [vitest 入口, …])`，不经 cmd.exe，
  $ grep -n "spawnSync(process.execPath" scripts/affected-launch-spawn.mjs
  147:  const res = spawnSync(process.execPath, [entry, ...args], {
  ```

  也就是说 `tests/hook-affected-launch.test.ts` 里那组断言的接收者（整份
  `run-affected-tests.mjs` 的原文）如今**只在第 18 行的机制说明里**含有 `spawnSync(` ——
  真身早已随「起进程」那一层拆到 `affected-launch-spawn.mjs`（那个文件自己的头注就写着这件事）。
  正向那条绿在注释上是一回事；**更坏的是三条反向断言也扫着同一份不再 spawn 的文件** ——
  今天有人在 `spawnVitest()` 的 options 里写 `shell: true`，那一格一个字都不会红。

  改两处，都不动被测面：

  - **读对文件**：正向（`spawnSync(` / `process.execPath`）钉在 `SPAWN_LAYER_PATH` 那份真身；
    反向（`shell: true` / `pnpm exec vitest` / `npx vitest`）**两份都钉**（入口与起进程层），
    失败文案点得出是哪一份（`起进程那一层：不许经 shell 层起进程`）。
  - **剥注释再判**（ISSUE #2660 的同一格失效：反向断言在原文上判的是"这句话没出现过的"，
    被禁写法挪进一句注释就静默通过；而 `// 别写 shell: true` 这种教人别这么写的注释又会假红）。
    用唯一实现 `tests/helpers/strip-comments.ts` 的 `{ trailing: true }` 档（连行尾注释一起去 ——
    它头注点名的正是这一形），**没在测试里抄第二份剥注释逻辑**（那里有条台账判据看着）。
    每一份被剥的文本前面都加一条"不许是空文"的前置断言 —— 少了它，剥完/切完落空会让
    所有 `not.toMatch` 恒真，那是这一族最坏的形状（"判据在不判任何东西而账面照样绿"）。

  **变异证明**（这一格的价值所在）：往 `scripts/affected-launch-spawn.mjs:148` 那个
  `spawnSync` 的 options 里注入一行 `shell: true` ⇒ 该用例当场红，红话就是新加的那条
  （`AssertionError: 起进程那一层：不许经 shell 层起进程: expected '…' not to match /shell:\s*true/`）；
  **改动前那一形不会被任何一格拦住**（入口那份文件里 `shell` 只出现在第 222 / 381 / 382 行的注释里）。
  摘掉注入后 `git diff` 该文件为空，`tests/hook-affected-launch.test.ts` **119 条全绿**
  （`pnpm exec eslint` 该文件退 0、`pnpm exec tsc --noEmit` 退 0）。

  另记一次**负载假红**（不是这一改动造成的，也不为它抬预算）：第一次跑这份文件时
  `--full --dry-run` 那条真起子进程的用例报 `Test timed out in 30000ms`，
  同一条复跑（仍 `--no-file-parallelism`）绿 —— 按 §11.13 / ISSUE #2606 那条口径，
  这是并发下的形状，**不改 `testTimeout`**。

  本单（#2660）的普查读数与后续批次的标准都写在那张单的评论里：候选 780 处 / 127 份，
  第一批按「反向断言 + 接收者来自多文件链」逐份收，一份一 PR；这一份是第一个。
