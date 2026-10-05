## Removed

- **清掉 Prisma 期留下的死写法与说明文字**（ISSUE #1501 的后续）。数据层换 Drizzle 之后，仓库里还留着几处「只在 Prisma 那个时代才成立」的东西 —— 它们不报错，只是让读的人按已经不存在的机制去理解代码：
  - `workflow.update` 的入参 schema 里那个 `thumb` 字段：`WorkflowTemplate` 从来没有 `thumb` 列（注释自己写着「旧遗留字段」），`...rest` 解构把它带进来、又不透传进 `set()`，全库没有任何调用方发它 ⇒ 删掉（含那行注释）。同一个函数的 patch 构造注释里同一句写了两遍，一并收成一处。
  - `use-workspace-tabs` 里读 `comfyapp:workspace-view-v1`（只存单个视图的旧键）再组装成一个页签的迁移分支：那是**一次性迁移**，`sessionStorage` 出不了本会话，迁移窗口早关了，而它一直挂在恢复路径上 ⇒ 删掉 `LEGACY_WS_VIEW_KEY` 与那个分支，`readTabsState` 现在只读当前键。
  - `ensureRemoteStorageMigrated`（把混在 `llmConfig.extraModels` 里的远端对象搬进 `remoteModel` 表的存量迁移）：全库唯一的非测试调用方就是 `configGet` / `configSave` 两处「顺手跑一下」，而那两个写口早就不再产出对象形态，`splitExtraModels` 的 `remoteEntries` 恒为空 ⇒ 函数体只剩空转。按 §12.15 第三条（「以后可能会用」不构成保留理由）整体删除，连同它的三组单测与路由测试里的 mock 断言。**读侧的兜底归并留着**：`getConfigForClient` 仍会把 `remoteModel` 表里指向回环、无密钥的条目折回本地候选 —— 那挡的是库里的存量数据，不是代码路径。
  - 模式覆盖层在同一个 JSON 列里被读两次（`parseWorkflowIOMap` 认 `modeOverrides`，`enrichWorkflowIO` 又认一遍 `modes`）。两种读法必须收在一处 ⇒ 归一挪到**列边界**（`workflow-detail.ts` 读 `tpl.workflowIO` 那一步调 `parseWorkflowIOMap`），`enrichWorkflowIO` 只认 `modeOverrides`。`workflow-detail.ts` 此前是**直读列**、绕过这道归一 —— 也就是说删掉 `enrichWorkflowIO` 里那份回退会让历史行的覆盖层整片丢失，所以两件事是一起做的。
    顺带修掉 `parseWorkflowIOMap` 归一后**没删旧键**：旧键靠 `.loose()` 一路透传回写库，同一份覆盖层以两个名字在列里往返（`enrichWorkflowIO` 的用例原本就在断言「旧键不应原样下发」，只是没人核对过）。现在旧键在归一时删掉。
  - 散在注释里的 Prisma 名词（「Prisma Json 列」「prisma.generate 后类型会自动包含」「task.error 在 Prisma 里类型是 `String?`」等 30 余处）改成按现在的事实说话（「任务表的 JSON 列」「json 列读出来是 unknown」）；`src/lib/db.ts` 那句「原 `prisma` 别名已移除」的兼容垫片说明、`repository.ts` 模块划分里两个已不存在的类型名也一并改掉。主规范 §2.3 仍是「Prisma 数据层规范」（写着 `prisma migrate dev`）、§10.1 的 `pnpm install` 还注着「postinstall 自动 prisma generate」，一并改成 Drizzle + `pnpm db:push` 的现状。
  - `tests/dist-artifact-hygiene.test.ts` 里那条假路径样例用的是 `prisma/db.sqlite` —— 它测的是「藏在子目录里的开发库要被剥掉」，路径本身只是一份取样，改成 `legacy-dir/db.sqlite` 以免读者以为仓库里还有那个目录。

## Added

- **历史时间戳写法的一次性归一**：`createdAt` / `updatedAt` 在 `project` 表里混着两种形态 —— 裸毫秒串（`1787379642808`）与 ISO 串，同一列两种格式。写入侧早已只有 ISO（`schema.ts` 的 `dateNotNull`），所以前者是**读进来就得挡着**的历史沉积：`dateNotNull.fromDriver` 拿 `new Date("1787379642808")` 得到 Invalid Date，任何按它算时间的地方都会拿到 NaN。
  - `scripts/db-legacy-sweep.mjs` 只归一、不删行（那些行的 id 是客户端画布 id，删掉等于把用户的画布从服务端抹掉）。形状判据是「整串十进制数字」——刻意不用 `Number.isFinite(Number(v))`（它会把 `" 12 "`、`"1e3"` 也认成数字，那样列里真出现第三种形状就再也报不出来）；解不出合法时间的值**原样保留并打出来交人看**。
  - 挂在 `pnpm db:push` 收尾，**不进启动链路**：这是数据改写而不是 DDL，而启动链路连「会丢数据的 DDL」都不替用户决定，更不会顺手改数据。清洗失败 / 打不开库都不拦命令（它是整理，不是这一趟的目的）。
  - `tests/db-legacy-sweep.test.ts` 7 条：形状判据（含「看起来像数字但不是整串十进制」那三个反例）、两列各归一次、解析不了的值原样保留并出现在汇总里、库不存在 / 没有 `project` 表时空操作、以及**幂等**（第二次跑是空操作 —— 它每次 `db:push` 都会跑到）。
