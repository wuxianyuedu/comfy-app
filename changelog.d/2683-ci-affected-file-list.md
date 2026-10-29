## Fixed

**平台 `受影响用例` 一格的日志里读不出「跑了哪些用例」，只剩总数**（ISSUE #2683 的现场：
一屏日志里只有 `Tests 1116 passed (1116)` 这类汇总，一个文件名都没有）。

根因是上一轮那条日志预算：平台对单次构建日志的硬上限是 102400 字节、**保留尾部**，超了
开头整段被截，而 `vitest run` 的默认 reporter 会**逐个文件**打一行 ⇒ 那一格置了
`COMFY_AFFECTED_QUIET=1`（`--reporter=dot`）。结论因此保住了，代价是**清单也没了** ——
而清单里排在最前面的是 103 份**固定清单**（日志实现只有一处、`src/lib` 的 Node-only 声明
口径、core 骨架单一事实源……），它们才是「这次守的到底是什么」的答案，总数答不了。

补的是同一格的**另一半**，判据一个字没动：

- 新增 `scripts/affected-launch-file-list.mjs` 的 `fileListReport()`：quiet 档把**送进
  vitest 的那一份清单**逐行念一遍（紧接着 `reporter：dot` 那行、在起 vitest 之前 ——
  落在平台的尾部保留区里）。**不额外起一次 vitest**、不解析 junit，这一档买的是可读性，
  不是第二份证据。
- 三条边界：**只在 quiet 档打**（不 quiet 时默认 reporter 已经逐文件打过，再打一遍就是把
  102400 字节的预算作废两次）；**200 行封顶**（几百份的名单本身也是预算消耗方）；**截断必须
  念出来**（「另有 N 份未列出」—— 「少打一份」与「少跑一份」在日志上长得一模一样）。
- `--full` 那一档没有清单可列（vitest 自己收集全集），但只念一句「本档不逐份列出」而不是
  静默 —— 「这一档本来就不列」与「列清单这件事坏了」必须读得出区别。
- 顺带把 `collectAttribute`（拆小建议的归因）搬进 `affected-launch-scope-advice.mjs`：
  启动器已经贴住 900 行硬闸，而越闸的形态不是报错，是「那一层读不动了」。载体与改动面的
  读法由 `affected-launch-changed-list.mjs` 转出（`spawnAffected` / `changedFromEnv`），
  不抄第二份。

判据：`tests/hook-affected-launch.test.ts` 新增「跑了哪些用例这一格」一组 6 条（不 quiet
一个字都不打、quiet 逐份列出、超封顶必须点名、封顶是 200、空清单不许静默、两个调用点的
形状）。规范 §13.5.8.3「第九笔账」补一节。

同批记账：新增两份 `.mjs` 让 `tsconfig.scripts.json` 的判决面从 211 涨到 **213**，而账本
（`scripts/.scripts-typecheck-baseline.json` 的 `face`）是拿配置原值对账的棘轮 ⇒ 不跟着记，
平台 `受影响用例` 那一格会红在「面与账不许两份口径」上（PR #2688 的现场：`配置展开 213 份，
账上写 211`）。走它自己的写入口 `node scripts/check-scripts-typecheck.cjs --update` 重写，
`face` 记 213、`total` 保持实测的 206 处 / 17 份 —— 两份新脚本实测 0 处红，不是把新增登记成已知。

## 合并之后：启动器越过 900 行硬闸时的第二刀（同一 PR）

与 master 的 oxlint 那一批合并之后启动器仍在闸上（`check-infra-file-size.cjs` 的 900 行；
越闸的形态不是报错，是所有人的提交停在门口），所以再切一刀 —— 仍**只搬位置、判据一个字不改**：

- 「怎么起一次 vitest」那一层出列到 `affected-launch-spawn.mjs`：并发覆盖
  （`resolveMaxWorkers`）、命令行分块（`planLaunches`）、入口定位（`resolveVitestEntry`）、
  子进程输出抓取（`spawnVitest`）。留下的仍是**判决链**（第 1 遍什么档 / 复不复跑 /
  逐文件补跑 / 退哪个码）。
- 调用点与用例按**真实落点** import（机制层不转假出口）；`run-affected-tests.mjs` 对
  `planLaunches` / `resolveMaxWorkers` / `resolveVitestEntry` 做转出，既有 import 面不变。
- `@ts-nocheck` 随代码搬：那批函数原本住在一份带它的脚本里（「提交门槛脚本、无类型消费方」），
  丢掉会让一整套 `TS7006` 当场变成「新增脚本的存量红」（棘轮对新增零容忍）。

同批记账：`scripts/.scripts-typecheck-baseline.json` 的 `face` 按实测走它自己的写入口
（新增一份 `.mjs`），存量取实测的 170 处 / 15 份 —— 新文件零红，不是把新增登记成已知。
