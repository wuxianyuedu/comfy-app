## Fixed
- `pnpm worktree:add` 曾把 `".git"` 硬拼进 `path.join`，撞上 `git-dir-literal-scan` 的硬闸（链接工作树里 `.git` 是文件，硬拼本来就指不到真实检出目录）。现在落点判据改成由调用方问 `resolveGitDir()` 取 git 目录，纯函数只判形状；同批补固定结构判据的复跑读数。
