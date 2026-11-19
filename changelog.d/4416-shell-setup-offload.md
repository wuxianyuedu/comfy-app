## Fixed

- 壳：启动关键路径的两段同步重活挪出事件循环线程。残留回收（全系统进程枚举 +
  环境块认亲 + `reap_pid`，最坏 `REAPER_BUDGET`(10s)+drain）与 standalone sidecar
  拉起（成功路径固定睡满 `SIDECAR_START_GRACE` 1.5s、端口被占重试 4.5s）原先都在
  setup 闭包里同步执行——期间启动页的 IPC 轮询（拿进度 / 日志）被同一阻塞消耗，
  看门狗的 5s base-URL 预算也被吃掉。现在两段各自挪进后台线程；失败上报链
  （`report_standalone_setup_failure`）语义不变，签名随迁 `&AppHandle`。（#4416）
