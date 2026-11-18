## Fixed

- **schema 同步子进程入回收账本**（#4344）：后台 schema 同步的 drizzle 子进程
  此前不入编排器的 `spawned` 账本——web 模式（无 Job Object）下 launcher 退出后
  它成孤儿继续跑（自身预算 600s），期间握着 db.sqlite：紧接的依赖补装 EPERM、
  两次 schema 同步并发写同一个库。现在拉起后即登记进账本，退出回收照常收它。
