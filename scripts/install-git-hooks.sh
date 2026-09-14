#!/bin/sh
# 把仓库自带的提交门槛接上:core.hooksPath 指向版本控制里的 .githooks/。
#
# 为什么需要它:git 不会自动采用仓库内的钩子,新克隆的检出默认没有任何提交门槛
# (`.git/hooks/` 只有 .sample)。把它绑成 package.json 的 postinstall,新检出
# 装完依赖即自动生效,不再依赖「README 里那句记得执行 git config」。
#
# 幂等:已指向 .githooks 时直接退出;任何一步失败都不阻断安装(钩子是**开发体验**
# 兜底,不是依赖安装的必要条件,不该让 pnpm install 因为它整体失败)。
set -u

repo_root=$(cd "$(dirname "$0")/.." && pwd)
cd "$repo_root" || exit 0

# 不在 git 检出里(如从 tarball 解包)时无事可做
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || exit 0

current=$(git config --local --get core.hooksPath 2>/dev/null || true)
if [ "$current" = ".githooks" ]; then
  echo "[hooks] core.hooksPath 已指向 .githooks(提交门槛已生效)"
  exit 0
fi

if git config --local core.hooksPath .githooks; then
  echo "[hooks] 已启用提交门槛:core.hooksPath=.githooks(见 docs/standards/13-提交与-code-review.md §13.5)"
else
  echo "[hooks] 警告:设置 core.hooksPath 失败,提交门槛未生效(可手动执行 git config core.hooksPath .githooks)"
fi
exit 0
