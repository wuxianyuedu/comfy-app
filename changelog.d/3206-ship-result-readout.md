## Added

- **`pnpm ship` 现在会给自己写一份「上一次到底做了什么」的落盘回读点**：`.git/ship-result.json`（ISSUE #3206，`scripts/ship-result.mjs`）。只读回读口是 `node scripts/ship-result.mjs`，加 `--json` 出原始读数。
  现场是修 #3199 时前台 ship 被超时杀掉（提交已落地、远端未推），改后台跑后第一次又被 pre-push 复算拦红 —— 人只能翻 `temp/ship-*.log` 还原现场。读数其实一行不少，缺的是一份**进程自己写下的、随时可读**的事实源：后台完成**不保证唤醒**，「等通知」不是判据。
- **write-ahead**：sink 一创建就先写一笔 `status=running`，此后每笔 `log()` 同步追加、每行落盘。被 SIGTERM / 超时杀掉时，文件停在最后一行读数，下一轮能看出「走到哪停了」。回读里 `running` / `interrupted` 一律念「**没给结论**」，与三态退码 `2 = 没跑起来` 同口径，不许读成通过。
- **只转述，不判定**：`stages` 从 `reportStage` 的 `[ship] ▶ …` 行提取，`conclusion` 取屏幕上最后一句结论类声明原文（收尾回收改了退码时跟着改口，不留被推翻的声明），`exitCode` 取 `main()` 唯一出口的返回值。`branch` / `sha` / `repo` / `pr` 是**尽力而为**的读数增强：取不到或读到 `(取不到)` 这类占位就落 null，绝不反过来当判据。落点复用 `git-dir.mjs` 的 `gitScratchPath()`，与 `comfy-premerge-proof.json` 同族 —— 本机检出级、不入库、不跨检出互证。
- **回读分三档**：`missing`（还没有上一次，是合法读数，既不是「没跑过」也不是「通过了」）、`unreadable`（JSON 坏 / 形状不对，这一格没跑起来）、`no-git-dir`（取不到落点）分开说；形状用类型守卫校验，不把 `JSON.parse` 的结果直接断言成已验过的类型。
- **写盘 best-effort**：任何写失败都吞掉，绝不改 ship 的三态退码或打印原文（硬规则 28 红线③）。落点还**必须由调用方显式给** —— 编排层默认不落盘，只有 CLI 入口传真实 `resolveGitDir` 才写。几十条 `main({...})` 注入用例共用本仓真实检出，若默认落盘，跑完测试「上一次 ship」就成了测试假读数，恰好污染这一格要守的事实源。

## Changed

- `scripts/ship.mjs`：`main()` 用包装后的 `log` 跑整链，异常路径写 `interrupted` 后原样抛，唯一出口写终态；用法段补上回读口。旗标解析面 / `namedActions` 表 / `ship-core.mjs` 都没动。

## Fixed

- 回归用例（`tests/ship-result.test.ts` + `tests/ship.test.ts`）：write-ahead、running ≠ 通过、每行同步追加、身份 / 阶段 / PR / 结论提取、行数上限截断、finish 三态、异常 interrupted、写盘失败不抛、回读三档、CLI 回读，以及「`main()` 真的把终态写进去了」「不给落点就一个字也不写真实检出」。把 `flush()` 从创建处挪走、或把 sink 从唯一出口摘掉，用例都会红。
