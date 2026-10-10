#!/usr/bin/env sh
# 假 comfy-cli 的「解释器」入口（POSIX）。
#
# 本应用把 `comfyCliPython` 的值当成**解释器路径**直接 exec
# （`spawn(py, ["-m", "comfy_cli", "run", …])`，见 executor-cli.ts）。
# 所以给它一个包了 PYTHONPATH 的 shim 就行 —— 比让整个 dev server 进程
# 带上 PYTHONPATH 干净：后者会顺带影响 Next 自己的 import 解析。
#
# 目录用**本脚本所在位置**推，不依赖 cwd（webServer 的 cwd 是仓库根，
# 但把它写死等于把这份替身绑死在一种启动方式上）。
here=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
PYTHONPATH="$here${PYTHONPATH:+:$PYTHONPATH}" exec python3 "$@"
