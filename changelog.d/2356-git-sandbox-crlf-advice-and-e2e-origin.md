## Fixed

- **临时仓库的 `git add` 不再打换行 advice**：`tests/helpers/git-sandbox-env.ts` 的
  `sandboxGitConfig()` 此前只答了「身份」与「签名」，没答「换行与 advice」——
  宿主若开着 `core.autocrlf=true`，夹具仓库里每一次 `git add` 都往 stderr 打一行
  `warning: in the working copy of '…', LF will be replaced by CRLF …`。
  现在补齐 `core.autocrlf` / `core.safecrlf` / `advice.addIgnoredFile` /
  `advice.detachedHead` / `gc.auto`，仓库口径定在规范 §13.7 那一档（LF 入库、不做
  autocrlf 改写），行为与 `git -c core.autocrlf=false add` 一致。
  那一行不改变任何结论，却是 CI 日志里最容易被读成「真红」的噪音，而屏蔽面
  （`gitSandboxEnv()` 与共用夹具 `gate-repo`）一改到底。
- **同一条判据补了反向锚点**：`tests/git-sandbox-env.test.ts` 第 ③ 档先证明宿主的
  `autocrlf=true` 确实会让 `git add` 叫一声，再证明夹具注入之后一声都不叫 ——
  少了前一半，那条断言在「宿主本来就没开 autocrlf」的机器上同样为绿（等于没判）。
- **几处漏网的夹具补上 `gitSandboxEnv()`**：`base-check` / `ast-gates-aggregate` /
  `precommit-timing` / `postinstall-cross-platform` / `merge-changelog-anchor`
  的自起仓库此前就地 `git init`，没走统一夹具 ⇒ 上面那条修复盖不到它们。
- **`runChild()` 的 ENOENT 那一行自报家门**：`[e2e-run] ✗ 起不了 Playwright（…）：失败码 ENOENT`
  既是真实跑法的失败取证，也是 `tests/e2e-run.test.ts` 那条负向用例**要的**出口 ——
  两者共用一条 stderr，于是 CI 日志里那一行长得和真故障一模一样。
  收掉它是错的（真起不来就没有任何线索），所以改成**让它自报家门**：
  新增 `spawnFailureLine()`（那一行的唯一出处），调用方声明 `origin`，
  判据侧声明 `origin: "test"` ⇒ 前缀换成 `[e2e-run/test]` 并追加一句
  「判据按设计造的失败」。真实跑法那一档的形态一个字都没变。
