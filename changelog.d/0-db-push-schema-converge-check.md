## Fixed

- **`pnpm db:push` 现在会核对「表结构」而不只是「有没有表」**：此前的复核只看「库里的用户表数 > 0」，于是**库结构与 schema 漂移**（历史版本删过的列仍留在表上）一路绿灯 —— 实测现场是 `workflowTemplate` 上留着 `graph TEXT NOT NULL`，新建工作流直接 `NOT NULL constraint failed: workflowTemplate.graph`，而 `db:push` 与启动自检（`probeSchemaSync`）都说「已就绪」，用户只能看到一句数据库报错。现在多跑一次 drizzle 的 diff：**第二次必须报 `No changes detected`（收敛）**，否则非零退出并打印第二次输出的尾部与可行动作。

  这条判据补的正是本文件头注释里那条坑的**第二种形态**：无 TTY 时交互提示被静默吞掉，旧形态是「库被清空」（表数为 0，旧判据能抓到），新形态是「库原样不动」（旧判据抓不到）。
