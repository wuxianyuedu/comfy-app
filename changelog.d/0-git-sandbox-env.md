## Fixed

- **测试 worker 会把调用方的 git 环境继承进临时仓库夹具，污染的是真仓库的索引**。
  `git commit` 给它触发的钩子进程导出 `GIT_DIR` / `GIT_INDEX_FILE` / `GIT_WORK_TREE`，
  而 pre-commit 的 C 组正是在钩子里跑 `vitest` —— 于是这份环境一路进测试 worker、
  再进 worker spawn 的子进程。本仓库实测有 **20 份**用例文件自己 `git init` 一个临时
  仓库，它们里的 `git add -A` 带着那份环境时，操作对象**不是**临时仓库而是调用方的检出：
  探针文件被写进真索引，下一次提交报 `invalid object ... + Error building trees`，
  而报错一个字都不指向那条测试（谁提交都提不动）。
  现在收在一处：`tests/helpers/git-sandbox-env.ts` 定义「必须剥掉的键」这份清单，
  `tests/setup.ts` 在 worker 启动时从 `process.env` 里删掉它们（同时覆盖这些用例
  spawn 的子进程，含被测判据脚本内部再起的 git），`tests/helpers/gate-repo.ts`
  作为共享夹具再显式传一次 —— 夹具自带隔离，不假定调用它之前有人做过全局清理。

## 刻意没做的事（写清楚，别当成已完成）

- 没有逐个去改那 20 份用例文件里的 `execFileSync("git", …)`：一处全局剥离覆盖它们全部，
  而 20 处各写一份剔除清单正是本仓库反的那件事（规范 §12.18 / 硬规则 24）。
- 判据脚本自身（`scripts/**` 里跑 git 的那些）没有改动：它们被钩子直接调用时
  `GIT_DIR` 指向的就是它们该操作的那份仓库，那是正确行为，不是污染。

## 验证

- `tests/git-sandbox-env.test.ts`（新增 4 条）两向都钉：① 带着 `GIT_DIR` 时**确实**能
  把探针写进目标仓库索引（机制成立，不是臆测；用的夹具是本用例自己 `mkdtemp` 的仓库，
  不碰调用方检出）；② 换成清理后的环境则目标索引一字不多、探针落在自己索引里
  （清理没有把命令变成空操作，只是换了归属）；另两条钉清单完整性与 `tests/setup.ts`
  的接线（那一档被删时行为用例仍绿，所以只能正面判接线本身）。
- 回归面：`shell-gate` / `check-reformat-only` / `ast-gates-aggregate` /
  `merge-changelog-anchor` / `daily-tracks` / `base-check` / `premerge-check` /
  `premerge-push-trigger` / `postinstall-cross-platform` / `check-branch-guard` /
  `check-merge-parents` / `check-commit-claims` / `check-allow-builds` 共 13 份自起
  git 仓库的用例全绿（273 条）。
- 本仓库的规范条目：AGENTS 硬规则 24（复用优先、不造第二轮子）、
  规范 §12.18（写之前先查有无现成实现）。
