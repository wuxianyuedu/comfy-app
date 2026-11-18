## Fixed

- dev 热重载不再泄漏 SQLite 连接：`server/db` 与 `server/workshop/db` 的连接（及 workshop 的 drizzle 实例）改为 globalThis 单例复用。此前每次热重载都会新开一个 `DatabaseSync` 连接且无人关闭——句柄与内存单调增长，Windows 上残留打开句柄还会锁住 db.sqlite、使后续删改失败。（#4284）
