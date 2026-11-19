## Fixed

- **CP936 外壳不再被「已退子进程的管道」吊死（ISSUE #3412）**：子进程退出
  后若某个更长寿的孙进程（git 远端 helper / 凭据 helper 这一类）还持有
  stdout/stderr 管道的写端，`close`（= 进程结束且 stdio 全关）一直不来，
  外壳停在 `await` 上不退出，平台 15m 外框把一个结论已在手的绿格强杀记成
  error、后续承重格整片 skipped。本机已复现该形态（`exit` 132ms 到、
  `close` 在孙进程活着期间永不到来；`taskkill /PID <死根> /T /F` 实测够不着
  死根的后代，收树不是出口）。修法：exit 之后给 `close` 一份 45s 的**静默**
  预算（来数据就续期，只计静默不计总量），到点按 exit 已交出的结论交账，
  残余半行照发 —— 兜底交的账永远是 exit 那份，「不许把没判完洗成绿」在
  这一格的形状就是「timer 不早于 exit」。落点：`scripts/ci-cp936-exit.mjs`
  （`POST_EXIT_CLOSE_IDLE_MS` + `finalize` 收口），转码那一半按职责切到新家
  `scripts/ci-cp936-write.mjs`（原文件贴着 R5 的 900 行硬闸，切法与
  `ci-mirror-retry-policy.mjs` 同一纪律，导入面原样转出）。
