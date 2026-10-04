## Fixed

- **`tests/storybook-tsc-input.test.ts` 第 ④ 条：在「仓库与临时目录不同卷」的开发机上必红、每跑一次删一次本机开发期输入，而且会把同批并发的组 B（eslint）带崩。**
  - 这条判据要把生成件临时**挪走**（模拟新检出），跑完 tsc 再挪回来。两处形态各自埋着一个坑，都不是读代码能看出来的：
    - **暂存点落在 `os.tmpdir()`**：仓库在 `F:`、`%TEMP%` 在 `C:` 是常见开发机形态，Windows 上 `rename` 跨卷直接 `EXDEV` —— 「挪走」这一步其实从没成功过。而 `finally` 不看结果就照旧 `rmSync` 真目录、再 `renameSync` 一个从没存在的暂存点，于是报出来的是 `ENOENT: ... rename '%TEMP%\sb-generated-…' -> '.storybook\generated'`（指向**还原**那一步），真正的 `EXDEV` 被 finally 的异常顶掉。副作用更坏：跑一次就把本机 `.storybook/generated` 删掉，下一次 ④ 因为「目录本来就不在」走 `existed=false` 分支而**假绿** —— 判据在破坏环境的同时把自己的判据来源也拆了。
    - **挪的是整个目录**：pre-commit 各组是并发跑的（钩子文件头写明 `wall ≈ max(各组)`），组 A 的 `tsc` 与组 B 的 `eslint` 都在遍历 `.storybook/**`（`tsconfig.json` 的 `include` 显式列着 `.storybook/**/*.ts(x)`）。目录在它们遍历中途消失，撞上是 `Error: ENOENT: no such file or directory, scandir '…\.storybook\generated'`，组 B 直接以「Oops! Something went wrong!」退出码 2 失败 —— 报错里既没有本条判据、也没有真凶，看起来像别人写坏了。
  - 修法：暂存点改落**仓库内同卷**的 `node_modules/.cache/sb-generated-<pid>/`（git 不看这里、类型程序与 eslint 都不展开这里，`package.json` 的 lint 早已把 `.cache` 当缓存目录在用 —— 同一处用途，不另造约定）；挪的对象改成**只有那个 `app-origin.json`**，目录留在原地（空目录不影响任何人：json 不是 tsc / eslint 的展开目标）；挪不动就**当场**失败并说清是暂存点的问题（挪在 `try` 之外，失败时不再碰真文件）；还原抽成独立出口，暂存不在就按本机现生成一份，并收掉本次自建的暂存目录。

## Tests

- 新增一条形状判据「④ 的暂存点形状：仓库内、同卷、不入库，且挪的是文件不是目录」：判**位置与对象形状**而不判当前机器的卷 —— 单卷机器上按卷判永远绿，只有按形状判才能在所有人身上拦住回潮。含 `git check-ignore` 实测（免得一次判据在仓库里留个未跟踪目录）。
- ④ 内部另有一条当场断言「目录必须还在」，直接判住「改回去挪目录」这条路。
- 反向验证两次都做实物证：
  - 把暂存点改回 `os.tmpdir()` → 形状判据与 ④ 同时红，报错是 `EXDEV: cross-device link not permitted`（真因，不再被 ENOENT 顶掉），且跑完 `.storybook/generated` 仍在。
  - 把 ④ 的挪动对象改成目录 → ④ 红，报错是那句「只许挪走那个 json，不许把 .storybook/generated 目录一起搬走」。
  - 改回后 8 条全绿（④ 实测 ~14s，两遍真 tsc），跑完 `.storybook/generated/app-origin.json` 在位、`node_modules/.cache` 无残留。
