## Added

- **`src/lib/core` 与 `src/lib/llm` 覆盖率继续爬坡（`core` 42.6% → 94.6%，`llm` 55.9% → 97.5%）**，两个子域门槛同步从 `40/35/40/35` 与 `55/55/55/50` 抬到 **`90/85/90/90`** 与 **`90/85/90/85`**（只升不降，见规范 §18.6）。本轮补的是两个此前**零覆盖**的关键模块与整个仓储层：
  - **仓储层 12 个模块**（`core/repository-*.ts`）接**内存 SQLite + 真 Drizzle** 夹具（`tests/helpers/test-db.ts`，新增 `remoteModel` / `workshopSession` / `workshopDraft` 三张表与 5 个唯一索引）—— 这一层的正确性全在 SQL 语义上，逐个 mock `db` 只能断言「调了什么方法」，断言不了「SQL 对不对」。用例覆盖 CRUD 基类、归属隔离（他人 id 命中 0 行）、`onConflictDoUpdate` 的 target 语义、`and()` 里 `undefined` 的短路、JSON 列的加解密顺序、五个状态机终态（`finalizeSuccess` 未传 `workflowSnapshot` 不覆盖等）。**「密钥落盘是密文」这类断言故意读 `$tables` 原始行** —— 只看解密后的返回值证明不了落盘不是明文。
  - **`llm/server.ts`（435 行的唯一 LLM 出口，曾 0）**：三层配置叠加（env → DB → 请求覆盖）与每个字段的优先级、`temperatureByTask` 压过全局温度、DB 读失败静默回落 env、`override.model` 命中带独立连接参数的远端条目时改走该条目、本地候选名 + `remoteModel` 表 + 遗留对象三来源合并、`getConfigForClient` 保留「字符串=本地 / 对象=远端」的类型区分、`ensureRemoteStorageMigrated` 幂等且把指向回环的「伪远端」折回本地候选；四条补全路径（一次性 / 流式 / 结构化 / tools）与网络层 `TypeError` 的六条翻译分支。
  - **`llm/usage-test.server.ts`（设置页「测试」弹窗的服务端共享实现，曾 0）**：连接参数的三级回落（弹窗 → 条目 → 全局）、`tools` 与流式的请求形状、残缺 `tool_call` 逐条丢弃而非整包失败、坏 JSON 回包不再拼出重复状态码。
  - **`llm/model-catalog-client.ts` / `llm/usage-test-client.ts`（均曾 0）**：探测失败一律降级为空清单而不是抛给页面、结果字段的类型收窄、`queryUsageTask` 只带查询入参（不含 `prompt`，不重复提交）。

- **`docs/standards/18-lib层规范.md` 新增 §18.11「仓储层怎么测」**：把「为什么不用 mock `db`」「为什么 DDL 必须含唯一索引」「为什么断言要读原始行」写成口径，并附本轮实测出的 3 处缺陷表。

## Fixed

- **仓储分页只给 `skip` 不给 `take` 时抛 SQL 语法错误（`near "offset": syntax error`）**：SQLite 的 `OFFSET` 必须跟在 `LIMIT` 后面，此前生成的是 `… offset ?`，于是「取第二页」这个动作直接变成一次 500。修法是补 `LIMIT -1` —— 但 **drizzle 的 `offset()` 会把链上的数字 `limit` 整个丢掉**（`limit(-1).offset(n)` 生成的 SQL 里根本没有 limit），必须传 `sql\`-1\`` 片段才留得住；relational query（`db.query.*.findMany`）更彻底，`limit: -1` 直接被忽略，因此 `includeImages` 那条路改为「先用普通 select 取页，再按 id 装载关联」，两条分支现在产出同一形状并**各有用例**。
- **短片列表里「没有镜头」的成片显示为 1 镜**：`FilmRepository.listByUser` 用 `count()`（=`COUNT(*)`）配 `leftJoin`，一个镜头都没有的行里 `filmShot` 侧全是 NULL，`COUNT(*)` 照样算作 1。改为 `count(filmShot.id)`。同一个坑在 `repository-model-tag.ts` 已踩过并留了注释 —— 说明注释拦不住第二次，这回把它钉进了用例。
- **上游返回非 JSON 错误体时，测试弹窗的提示是 `HTTP 503：HTTP 503`**：状态码说了两遍，而框架真正写的原因（网关的 HTML 错误页、反代的纯文本 502）一个字都没带上。`httpFailureDetail` 现在接收原始响应文本并截断 240 字符带出。
- **模型清单下拉里会出现全空白的条目**：`model-catalog-client` 只判 `m !== ""`，于是上游给出的 `"   "` 占位会被原样放进候选（选中后上行一个空白模型名）。改为 `trim` 后判空并顺手去空白。
