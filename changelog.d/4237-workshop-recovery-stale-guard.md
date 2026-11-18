## Fixed

- 工坊「失联任务恢复 / 服务端草稿回填」两个异步 IIFE 无卸载守卫（同文件其它 effect 全部有 beginStaleRun 样板，唯这两处漏）：恢复结论 / notice 写进已卸载组件；更实际的坑是 `onAdopt` 在卸载后仍把服务端草稿灌回受管 state 并写 localStorage，与用户在另一视图的新编辑交叠（#4237）。两处按同文件样板补 `beginStaleRun` + `guard.commit`。用例：卸载后断言不落地。
