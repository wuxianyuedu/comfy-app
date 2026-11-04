## Fixed

- **补上两处「读 git 路径」漏掉的 `core.quotePath=false` 守卫**（ISSUE #3118）：`base-check` 合并态冲突清单（`git diff --name-only --diff-filter=U`）与 `worktree:remove` 的 `git worktree list --porcelain` 在 runner 的默认 `core.quotePath=true` 下会把中文路径转义加引号，与真实路径对不上；静态守卫用例（`tests/git-path-quoting.test.ts`，口径见 ISSUE #2272）当场红。两处各补 `-c core.quotePath=false`，不改判据、不加豁免。
