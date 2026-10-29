## Fixed

- **一次 LLM 设置保存跨的两张表收进同一个事务**（ISSUE #2592，P2）：设置页那条 mutation
  此前是两个 await —— 先 `remoteModelRepository.replaceAll(...)` 写 `remoteModel` 全量清单，
  再 `llmConfigRepository.upsertSingleton(...)` 写 `llmConfig` 单例，**中间没有事务**。
  第二条失败（AES-GCM 抛错、`SQLITE_BUSY` 都落在它上面）时第一条已提交，表现是
  「远端模型列表已经换了、LLM 配置还是旧的」—— 两张表指向不同一套模型，而界面读的是
  `getConfigForClient()` 拼出来的合并结果，不一致会被直接呈现给用户。
  现在仓库层暴露唯一入口 `saveLlmSettings(input)`（`src/lib/core/repository-user.ts`）：
  它开一次 `db.transaction`，把 `tx` 同时传给远端同步与单例的 read-modify-write，
  重试预算沿用 #2586 选定的 `SETTINGS_DB_WRITE`（3 次、基数 40ms、封顶 200ms），
  **不另立第二个数字**。`llm.ts` 那侧只剩一句「存」，不再自己决定写入范围。
- **`upsertSingleton` 自己那次 read-modify-write 也落在同一个 executor 上**：它的
  `findSingleton()` 此前恒用模块级连接，被传进事务调用时会读到提交前的旧行、
  并按一份已经不存在的状态算补丁。新增的 executor 类型只定义一处
  （`src/lib/core/repository-executor-types.ts`，`TxExecutor` 从 `db.transaction` 的
  回调形参上派生，不手写 union），两个方法读同一份。
- **候选清单的拆分从路由收进仓库层**：「字符串 = 本地候选、对象 = 远端条目」是存储形状
  （option C）的决定，放在调用点就等于每条链各自决定事务范围。`extraModels` 缺键仍然
  是「本次不动 `remoteModel` 表」，不是按空清单覆盖（台账 A11 同族）；路由那两条用例
  因此改为断言**库里有什么**，而不是「哪个方法被调了」。
- `getConfigForClient()` 那次读**刻意留在事务外**：读侧一致性不是这条链的诉求，
  搬进去只会把持锁时间再拉长。用例把这条钉成一句可红的断言 ——
  一次保存的 `begin…commit` 之间语句整段相等（多一条读也红）。
  事务边界落在哪一层的口径新增规范 §18.10.1；用例在
  `src/lib/core/repository.test.ts` 的 `saveLlmSettings` 那一组（8 条，含两个方向的
  「第二写失败 ⇒ 第一写不残留」，失败一律由测试宿主的语句钩子造）。
  变异实测四组（改完都还原并 `cmp` 验过逐字相同）：拆成两个事务 ⇒ trace / 回滚 /
  重试范围三条红；把 executor 从 `upsertSingleton` 丢掉 ⇒ 只有那条按身份判的用例红；
  拆分改成无条件（缺键折成空清单）⇒ 只有 A11 那条红；事务内换顺序 ⇒ 只有 trace 红。
  **两处「这个宿主判不出来」记在案上**：① 测试宿主是一条 `:memory:` 连接，`db` 与 `tx`
  打的是同一个实例 ⇒「单例那次读用的是谁」在 SQL trace 上逐字相同，那一格改成按
  **对象身份**判（生产侧这个区别是实的：libsql 的连接池里事务绑其中一条连接，
  另一条只会读到提交前的旧行）；② 单子里那句「并发两次保存 ⇒ 终态等于后一次」
  在这里只能是**串行**，第二次 `begin` 会直接撞上第一条未提交的事务并报 SQLite 自己的错 ——
  那是测试的形状，不是生产的并发语义（libsql 每次事务绑连接池里的不同连接）。
