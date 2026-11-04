#!/bin/sh
# pre-commit 的毫秒墙钟与逐步计时（规范 §13.5.8.3）。
#
# **为什么要单独一份、而不是在钩子里写两遍**：静态判据档的每一步跑在 `sh -c '…'` 里，
# 那是一个**全新的 shell** —— 外层定义的 shell 函数它一个都看不到。于是同一个
# `now_ms` 在外层（A/B/C/D 四组的墙钟）与组内（逐步的墙钟）各需要一次。
# 抄两份的漂移形态是静默的：一份用纳秒、一份退化到秒，两处的读数从此不在一个刻度上，
# 而账本只会把它们并排摆出来。
#
# 由 `.githooks/pre-commit` 在三处 `source`：外层直接 `. .githooks/timing.sh`；
# D0 与 D 两个 `sh -c` 块各 `. "$COMFY_TIMING_SH"`（路径用环境变量传，`sh -c` 继承环境）。
# 这两个块共用的不只是时钟，还有下面那个 `run()` —— 同一条理由。
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

# set_now_ms <变量名>：把毫秒读数**直接赋给那个变量**，而不是让调用方 `$(now_ms)` 取。
#
# 为什么值得多这一格（这不是微优化，是本轮量出来的）：钩子每一步要取两次时钟，而
# `$(date +%s%3N)` 在 MSYS 上**每次 fork 约 467ms**、即便换成内建也要为命令替换
# fork（约 163ms）。一组 51 步 = 102 次读数 ⇒ 实测每笔提交白付 15–45s 的**纯记账开销**
# （现场：一份 14 步的组墙钟 54.0s，而步之和只有 41.1s）。开销不改变任何判决，
# 却全额落在墙钟上 —— 尤其在新加的**串行**前置档里，它藏在 max() 后面的日子结束了。
#
# bash 5 的 `$EPOCHREALTIME`（内建，零 fork）走纯变量展开，连命令替换都不需要；
# 其余 shell（dash / macOS 的 bash 3.2）没有那个变量，自动退回上面那个 `now_ms()`。
# 判的是「变量在不在」而不是「是不是 bash」：POSIX 模式下 `BASH_VERSION` 可能被清掉，
# 而 `$EPOCHREALTIME` 不在就等于走不了这条路。
set_now_ms() {
  if [ -n "${EPOCHREALTIME:-}" ]; then
    _snm="${EPOCHREALTIME/./}"
    # 变量名来自本脚本的调用点（写死的几个），不是外部输入。
    eval "$1=\${_snm%???}"
  else
    eval "$1=\"\$(now_ms)\""
  fi
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
  set_now_ms _ts_start
  _ts_rc=0
  # 为什么是 `"$@" || _ts_rc=$?` 而不是裸跑那一行：调用方（D0 与 D 两个组）都带 `set -e`，
  # 裸跑时**失败那一步会当场把整个组截掉在下面的 printf 之前** —— 于是账本里「记到哪一条」
  # 是拦下者**前面**那一条，而「哪一步把我拦下了」这个唯一要回答的问题正好落在缺失的那一行
  # 上（实测：一份坏 changelog 碎片的红，账里只有它前面三步的读数，组的墙钟与步之和也差着
  # 那一条）。放进 `||` 的右侧就不触发 `set -e`；退出码照旧由下面的 `return` 带出去 ⇒
  # **阻断语义一字未变**，只是失败那一条自己也进了账。
  "$@" || _ts_rc=$?
  set_now_ms _ts_now
  printf '%s=%s\n' "$_ts_label" "$(( _ts_now - _ts_start ))" >>"$_ts_log"
  return $_ts_rc
}

# 组内单步的执行体：`run "<标签>" <命令…>` —— 先打一行 `── check: <标签>`（钩子收尾那段
# 靠这个前缀把「过了的判据」摘要出来），再走 `timed_step` 把墙钟落进账本。
#
# **为什么收在这份文件里，而不是让每个 `sh -c` 块各写一遍**：pre-commit 现在有两个这种
# 块（D0 形态前置档与 D 静态判据档），而它们与账本的约定是同一件事（标签原样、落
# `$LOGD/steps.ms`）。抄两份的漂移形态与上面那句「两份时钟必然漂成两个刻度」完全同款
# —— 比如后来有人只给其中一处加上「跳过时不打标签」，两组的逐步账就再也无法并排读，
# 而账本本身不会报错。
#
# `$LOGD` 由钩子 `export`（`sh -c` 继承环境）：读不到它时读数会落到一个空路径上，
# 静默丢掉整组逐步的账。
run() {
  _run_label="$1"; shift
  echo "── check: $_run_label"
  # 组 D 的进度线（ISSUE #3144）：D 组在后台串行跑、输出落组日志，某一步卡住时
  # 只有「已跑多久」这一行能区分「卡住」与「真就这么慢」。D0 是 16s 的快档，
  # 不付这层开销（开关由钩子在 D 块里显式导出）。
  if [ -n "$COMFY_STEP_PROGRESS" ]; then
    timed_step "$_run_label" "$LOGD/steps.ms" node scripts/progress-heartbeat.mjs --label "$_run_label" -- "$@"
  else
    timed_step "$_run_label" "$LOGD/steps.ms" "$@"
  fi
}
