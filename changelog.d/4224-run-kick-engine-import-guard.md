## Fixed

- run 引擎拉起入口 `kickEngine` 的动态 `import()` rejection 无兜底，模块加载失败即 unhandledRejection（#4224）：改走 `fireAndForget` 落带定位信息的 error 日志。用例：引擎模块工厂抛错，断言端点回执正常、error 日志带 projectId 且 rejection 不冒出。
