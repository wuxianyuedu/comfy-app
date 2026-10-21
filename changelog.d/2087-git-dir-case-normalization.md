## Fixed

- **`tests/git-dir.test.ts` 把 TEMP 的「大小写拼法」当成了被测事实**（ISSUE #2087；
  每日档十格首跑全到之后，它是**唯一**还红着的一格）：
  - 左值 `resolveGitDir(repo)` 是 **git 给的盘上正体**（`C:/Users/…/Temp/…`），右值来自
    `os.tmpdir()` —— 服务账号（Runner 以 LocalSystem 跑）下 `%TEMP%` 是**全大写**
    `C:\WINDOWS\TEMP`。Windows 路径大小写不敏感，两串指的是同一条路径，而 `norm()`
    此前只归一分隔符 ⇒ **开发身份恒绿、节点身份恒红**，报的又是 `AssertionError`
    （看着完全像回归）。
  - 修法：`norm()` 在 **win32** 上连大小写一起归一，**posix 那一侧刻意不动** ——
    那条路上大小写有意义，跟着归一会把「取到了另一个目录」判成正确
    （与 `scripts/.runtime-budget-baseline.json` 的 `byPlatform` 同一条口径：判据要在它
    跑得到的那种宿主上自证，而不是共用一个数）。新增一条 `norm()` 自己的回归用例，
    两个分支各断言一次 —— 原缺陷的形态是**恒绿**，只靠 CI 身份照它太晚。
  - 机制在仓外做过一次定点复现（临时目录、跑完即删）：同一条路径
    `git rev-parse --absolute-git-dir` 给 `C:/Users/…`、env 给 `C:/USERS/…`，
    「同一条路径?」= true，而 **旧 `norm` 相等 = false / 新 `norm` 相等 = true**。
    仓库侧再跑两态：默认 `9 passed`，以及把 `TEMP/TMP` 强制成全大写模拟节点身份 ⇒ 同样过。
  - **同文件另外两处恒真一并修掉**（这类断言坏了不会喊）：
    `:114` 那句 `expect(got).not.toBe(path.join(worktree, ".git"))` 两侧没归一 ⇒ 永不相等，
    实现真退化成硬拼它也绿；`gitScratchPath` 那条反向断言的两侧只归一了**一边**，
    在 win32 上等于「永远不包含」。现在统一两侧都过同一个 `norm()`。
    ⚠️ 后者是本刀自己差点带出来的新坑：只给一处加 `toLowerCase` 会让那句反向断言
    从「比较两种拼法」变成「比较两种大小写」——**恒真的修复不是一个修复**。
  - 契约没动：`scripts/git-dir.mjs` 回的形式仍是 git 给的那一份（文件头就写着
    「别拿它做字符串相等比较」）—— 坏的是比较侧，不是取值侧。
  - 这是每日档回到全绿的最后一块：`每日单元测试` 是 `FRESHNESS_TRACKS.full` 在
    `ciStage` 里登记的唯一执行者，而每日档串行失败即停，它红 ⇒ `full` 那张账当天没有凭证。
