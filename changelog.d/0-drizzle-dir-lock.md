## Fixed

- `tests/db-migrate-equivalence.test.ts` 与 `tests/db-migrate-noninteractive.test.ts`
  现在串在同一把**跨进程独占锁**上（新增 `tests/helpers/repo-drizzle-lock.ts`）。
  后者的唯一造法是**把真 `drizzle/` 挪开**（被测脚本的迁移目录按 `root/drizzle` 写死），
  而前者两次真起 `db-migrate` 都**要靠那个目录在场** —— 两个 worker 并行时实测红法是：
  等价性那份**一条断言都没红**、整个文件在 `beforeAll` 里挂，话术写着
  「没有可应用的迁移：drizzle 下没有 .sql 文件」，读日志的人会先去查迁移集。
  这条一直存在，此前被「绝对 DATABASE_URL 被剥坏」那一条盖住（那份文件本来就在
  `beforeAll` 失败），修好地址之后才第一次露出调度面。
  锁的三条口径：按文件粒度取（`hookTimeout` 只有 45s，对面那份实测 ~80s，按用例取锁
  会先把钩子自己顶穿）；等不到就红并**点名占用者**（不许读成超时重跑）；
  只按 owner pid 判死才回收陈旧锁（不看锁的年龄）。取到锁之后任何失败都先放锁再抛。
