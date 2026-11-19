## Fixed

- 进程回收：taskkill / pkill 子进程等待补上墙钟预算（15s，测试可用
  `COMFYAPP_TREE_KILL_BUDGET_MS` 注小）。此前 spawn 后只等 `close` 事件——
  taskkill / pkill 自己不退出时 `reapAll` / `shutdown` 永不返回，Ctrl-C 收尾整个
  卡死（探活预算 3s 只在它**退出之后**才生效，罩不住它自己）。超时按「没量到
  结果」如实 ok:false 并在 via 注明，不冒充成功。close→结果映射收成纯函数
  `killCloseDispatch` 供测试钉口径。（#4422；git 归因 spawnSync 那一半已由
  ISSUE #4394 落地，本单只补 taskkill / pkill 一半）
