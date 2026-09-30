## Fixed

- **删除任务现在真的会清磁盘：产物布局收成一处定义**（安全台账 A8 复算时照出的两处真缺陷）。
  「这个任务的产物目录在哪」这一句此前被三个调用点各拼一遍，而三处**已经分叉**：
  - `task.delete` 只拼 `public/generated/<taskId>`，可 `executor-finalize` 对**项目任务**落的是
    `projects/<projectId>/<taskId>` —— 在画布里删任务永远删不到产物目录，磁盘单调增长；
  - 同一函数里逐张 `unlink` 时把 `TaskImage.localPath`（`/api/generated/...`）解析成
    `public/api/generated/...`（多了一段 `api`）→ 每次 ENOENT，一张图都没删掉过；
  - 两条失败都被 `.catch(() => undefined)` 吞掉 —— 既没有日志、也没有任何数字会动，
    所以这个问题在代码里住了很久，表现只是「硬盘慢慢满」。
    现在布局只在 `src/lib/media/output-paths.ts` 定义一次（`taskOutputDir` 同时算目录与判越界，
    `taskOutputUrl` 与它同源），落盘 / 在文件夹里打开 / 删除三个调用点全部改吃它；逐张 `unlink`
    那条删掉 —— 每张产物都在目录内，整体删除才是这一层该做的，逐张删反而可能碰目录外的文件。
    越界（id 或 projectId 形状会把结果甩出产物根）时的处置留在调用点：打开 → `FORBIDDEN`、
    删除 → 只删库行并 warn、落盘 → 硬失败由 `complete()` 收口成任务失败（硬规则 4：
    失败路径必须有日志 + 用户可见出口）。
    顺带补上**落盘侧**一直缺的那半条判据：`projectId` 由客户端生成，一个 `../../x` 形状过去
    能把产物写到产物根之外，而 `/api/generated` 的白名单只认根内 —— 写出去等于文件永远读不到。
    判据：`src/lib/media/output-paths.test.ts`（16 条，含「解析结果就是根本身 → null」）与
    `src/server/api/routers/task.test.ts` 的三条 delete 用例。
    `/api/generated/[...path]` 的产物根与「仍在根内」判据也改吃同一处定义（它原本本地内联拼一份）。
    模块注释里**明确列出还没收进来的同族读者**（materials / film / workshop 的 media-source
    各有一份自己的子布局或地址映射），不冒充「全都收口了」。
