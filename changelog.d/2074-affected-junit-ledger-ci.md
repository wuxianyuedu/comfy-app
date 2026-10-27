## Fixed

平台「受影响用例」那一格此前**拿不到第一遍的 junit 读数**：`$LOGD` 只有
`.githooks/pre-commit` 会 export，平台入口一个都没有，于是超时形态的复跑每次都退回
「整块串行」，「清单 ⇄ 实到」的对账也没做成。现在 `ci-affected-tests.mjs` 自己造一份
同布局的账本目录（`node_modules/.cache/comfy-affected-*`）经 `LOGD` 交给启动器，跑完
清理；收尾复述会念「分文件读数 N 份」，造不出目录时明说「没有落点」，不再让「拿不到
测量」长得像一次普通的复跑原因。

同批修掉一个连带缺陷：平台是 quiet 档（`--reporter=dot`），账本到位后若再叠
`--reporter=default`，同一跑会打印两遍、把 102400 字节的日志预算作废 —— 现在
`junitReportArgs` 在调用方已给 console reporter 时只叠 junit。

另订正规范里负载读数的口径：生产代码读 `os.loadavg()` 的只有等待层
（`waitForLoadToSettle`），它只决定「等不等」、不参与任何一档判决；Windows 上恒为 0，
所以日志里非零的「每核负载」不是这一格的实时读数。
