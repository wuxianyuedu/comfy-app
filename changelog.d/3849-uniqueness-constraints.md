## Fixed

- **唯一性全面检测与收口**（#3849）：对全库「业务唯一键 / 幂等写入」做了一轮审计，
  带唯一索引的表（标签 / 技能 / 远端模型 / 供应商 / 收藏 / 模型文件等）写入路径已全部收敛为
  单语句 upsert 或「冲突后复核」，本次补上缺约束的四组业务键与两处裸 500：
  - `workflowModelTag_workflowTemplate` 加 `(标签, 模板)` 唯一索引 —— 并发交错曾落下重复
    关联行、计数虚高（#3835 / #3870 的现场），此前只靠 immediate 事务串行化；
  - `character` 加 `(seriesId, name)` 唯一索引 —— 提升合并按 name 去重，同名两行只会命中其一；
    建角色 / 改名撞名现在回业务冲突（409），不再落重复行；
  - `season` 加 `(seriesId, seasonNumber)`、`episode` 加 `(seasonId, episodeNumber)` 唯一索引，
    且服务端按「现有最大号 +1」发号 —— 此前 UI 建季 / 建集一律落默认号 1，建第二个季与
    第一个同号是常态路径而非并发特例；
  - `episode.projectId` 的创建 / 更新 / 绑定路径撞唯一索引时由裸 500 改为 409
    「该项目已绑定到其他集」；
  - 单发生成（generate）对同一镜头的并发提交改为进程内互斥 + 锁内查重，重复提交回 409
    「该镜头已有进行中的生成任务」—— 重复扣款（重复出图）形态的入口闸；
  - 存量重复数据由 `scripts/db-unique-sweep.mjs` 在 `pnpm db:push` / `pnpm db:migrate`
    建索引前清洗：季 / 集重复序号重编号（内容不动）、同名角色与连接表纯重复删后到者、
    同镜头重复活动任务取消后到者（不删行）。
- **防复发约束**：新增 `tests/schema-uniqueness.test.ts` 唯一性契约 ——
  schema 与测试库 DDL 的唯一索引逐名同步（双向）、业务唯一键登记表
  （`REQUIRED_UNIQUE_KEYS`）与 schema 双向核对；规范 §1.10 补「业务唯一键必须落库层唯一约束」、
  §13.1 自查清单补对应条目。已知边界（实测）：drizzle-kit 0.31 的 SQLite diff 对部分索引 /
  表达式索引永不收敛，故 task 的「同镜头活动任务唯一」由应用层承（generate 的互斥查重 +
  series-generation 的占用集合），不设库级索引。
- 迁移 `drizzle/0004_*.sql` 随 schema 同批生成（四条 CREATE UNIQUE INDEX）；
  `pnpm db:migrate` 应用迁移前也跑同一份存量重复清洗（与 `pnpm db:push` 同一口径）。
