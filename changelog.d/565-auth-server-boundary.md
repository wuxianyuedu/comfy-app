## Changed

- **`src/lib/auth-server.ts` 不再直接读 better-auth 会话**（`lib → server` 越界清单
  的最后一条，`tests/lib-server-imports.test.ts` 的 `REGISTERED` 现在是**空的**）。
  改法是「消息与判决分离」：
  - `src/lib/auth-server.ts` 只做判决 —— `getServerUser(session)` /
    `requireServerUser(session)` 把会话作**入参**，依赖只剩 `lib` 内部；
  - 读会话的唯一落点搬到新增的 **`src/server/auth/request-user.ts`**
    （`currentServerUser()` / `requireRequestUser()`）；
  - 24 个 REST Route Handler 的导入从 `~/lib/auth-server` 改为
    `~/server/auth/request-user`。

  这条边挡住的**不只是分层，还有测试**：`getSession` 内部是 `await headers()`，
  脱离 Next 请求上下文直接抛 `` `headers` was called outside a request scope ``，
  于是「已登录 / 未登录回落演示用户 / `loginRequired` 唯一开关」这套判决一直写不出
  用例。会话入参之后补上了 `src/lib/auth-server.test.ts`（12 例）。

## Fixed

- **演示用户缓存越过数据库，会返回一个库里不存在的 user id**（补测试时实测发现）：
  原实现把**解析结果**记在模块级变量里，命中即返回且不再查库。而 `user` 表会被重建
  （`drizzle-kit push` 的 `__new_X` 重建流程，见 `scripts/heal-db.cjs`），此时缓存里的
  id 在库中已不存在 —— 下游每处按 userId 的写入（任务 / 工作流 / 素材）都会外键失败或
  留下孤儿行，而报错指向的是写入语句，看不出「这个用户是虚构的」。
  现在 memo 的只是 **email**、实体每行都查库（命中路径依然只有一次 `findByEmail`），
  「缓存里有没有」不再与「库里有没有」分叉。用例断言「清空表后必须返回库里真实存在的
  id」而不是「和上次一样」，并已反向验证过会咬。

## Docs

- 规范 §18.10.2 新增（这条边怎么消除 + 缓存不得越过数据库的通用口径），
  §18.10 / §18.7 / §18.12 与 `docs/README.md` 索引同步。
