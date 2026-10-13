#!/bin/sh
# pre-commit 的毫秒墙钟与逐步计时（规范 §13.5.8.3）。
#
# **为什么要单独一份、而不是在钩子里写两遍**：D 组的每一步跑在 `sh -c '…'` 里，
# 那是一个**全新的 shell** —— 外层定义的 shell 函数它一个都看不到。于是同一个
# `now_ms` 在外层（A/B/C/D 四组的墙钟）与 D 内部（逐步的墙钟）各需要一次。
# 抄两份的漂移形态是静默的：一份用纳秒、一份退化到秒，两处的读数从此不在一个刻度上，
# 而账本只会把它们并排摆出来。
#
# 由 `.githooks/pre-commit` 在两处 `source`：外层直接 `. .githooks/timing.sh`；
# D 组经 `sh -c '. "$COMFY_TIMING_SH"; …'`（路径用环境变量传，`sh -c` 继承环境）。
#
# 时钟：GNU date（Linux / git-bash）的 `%N` 给纳秒；BSD/macOS 的 date **不认 `%N`**
# （原样吐出 `%N` 两个字），那时退化到「秒 × 1000」。探测一次，结果存 `_MS_CLOCK`。
# 精度只影响亚秒级步骤的读数，而账本要回答的是「哪一步最贵」—— 秒级足够。
_CLOCK_PROBE="$(date +%s%N 2>/dev/null)"
case "$_CLOCK_PROBE" in
  *[!0-9]*|"") _MS_CLOCK="" ;;
  *) [ "${#_CLOCK_PROBE}" -ge 16 ] && _MS_CLOCK=1 || _MS_CLOCK="" ;;
esac

now_ms() {
  if [ -n "$_MS_CLOCK" ]; then date +%s%3N; else echo "$(date +%s)000"; fi
}

# 逐步计时：把 `run "标签" <命令…>` 的墙钟追加到 `$1`（`<标签>=<ms>`，一行一条）。
# 给 D 组的 `run()` 用。标签**原样保留**（含空格）—— 它本身是给人读的，
# 而把空格换成别的字符会在报告里留下一串不好读的标签（第一版换成了 `_`，
# 读出来是 `jsx-a11y_规则开关⇄判据`）。传参那一侧的顾虑不成立：消费它的
# `set -- "$@" --step "$line"` 有引号，整行是**一个**参数（实测过）。
# 命令原样可省：调用方自己 `shift`，本函数只测自己那段。
timed_step() {
  _ts_label="$1"; shift
  _ts_log="$1"; shift
  _ts_start="$(now_ms)"
  "$@"
  _ts_rc=$?
  printf '%s=%s\n' "$_ts_label" "$(( $(now_ms) - _ts_start ))" >>"$_ts_log"
  return $_ts_rc
}
