## Fixed

- `tests/scripts-typecheck-ratchet.test.ts` 的真 git 夹具改走 `gitSandboxEnv()`：
  此前它直接 `execFileSync("git", …)`，宿主全局开着 `commit.gpgsign` 时临时仓库
  造不出提交（`gpg failed to sign the data` / `failed to write commit object`），
  报错一个字都不指向夹具。
