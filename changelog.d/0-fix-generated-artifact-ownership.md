## Fixed

- **产物读取口现在认会话也认归属：按路径猜别人的出图 / 素材 / 成片不再能读**（安全台账 A13）。
  `/api/generated/[...path]` 原本只做「解析后仍在 `public/generated` 之内」这一条路径判据，
  而落点命名里就写着主人的身份：`projects/<项目 id>/<任务 id>`、`materials/<项目 id>/…`、
  `<任务 id>/…`、`films/<成片 id>.mp4`。A12 把素材「列表」收紧之后，这一环是同一族的
  最后一公里 —— **列表看不见 ≠ 猜不到路径就读不到**。
  修法分两层，各判各的：入口改吃 REST 面唯一闸门 `requireRequestUser()`（无会话 401）；
  归属判定新增 `~/lib/media/output-access.ts` 作唯一判据，它回答的是
  「这条产物**能否被确定属于别人**」这半句 —— 项目两族直接吃 A12 那份
  `materialScopeOwnership`（不写第二份「目录名是谁的」），`films` 查出成片行，
  其余按 `<任务 id>` 查任务行。**库里查不到一律不算别人的**：判成别人的会把用户自己的
  历史产物打成 404 且毫无线索，判成自己的最多是被读到，代价不对称。
  拒绝发生在 `fs.readFile` **之前**，状态给 **404 而不是 403**（与「不存在」同形，
  这个端点不顺带回答「某个 id 存不存在」；口径同 A2 / A3 / A12）。
- **产物读取从两个入口收成一个：`/generated/**` 折进带闸门的 `/api/generated/**`**。
  上面两件做完自评已经「修好了」，实测当场推翻 —— 产物根是 `public/generated/`，
  而 `public/**` 由 Next **按静态文件直接发出、不经过任何 route handler**。同一个文件、
  两个 URL、两个答案（`loginRequired` 开着、无会话）：
  `/generated/<taskId>/img_0.png` → 200 带出 1154930 字节原图，
  `/api/generated/<taskId>/img_0.png` → 401。把 URL 里的 `api/` 去掉就整条绕过，
  dev 与桌包 standalone 两处一致。落点在 `src/proxy.ts`（Next 16 的 `middleware` 继任者，
  本仓库原本是一份刻意空转的落点），现在它有真活了。两个实测才知道的细节：
  · 配置层做不到：`next.config.js` 的 `rewrites()` 返回扁平数组时属于 `afterFiles`，
  压不过 `public/` 里的真文件（另起一份最小 Next 应用验过）；
  · `src/middleware.ts` 与 `src/proxy.ts` **不能并存** —— Next 16.3.5 直接抛
  `Both middleware file and proxy file are detected` 的 unhandledRejection，
  新加的那条一个字都不生效。
  折完之后在**桌包 standalone 形态**上按四档实测（会话来自临时隔离库，两种 URL 逐档同答案）：
  无会话 → 401；有会话但产物属于别人 → 404；属于自己 → 200；库里查不到这一行 → 200。
- **同一处响应的 `Cache-Control` 从 `public` 改 `private`**（长缓存与 `immutable` 保留）。
  这条不是顺手改的：那两个字面量在只判路径时是无辜的（内容对谁都一样），而响应一旦开始
  依赖「你是谁」，`public` 就等于授权共享缓存把 A 的产物回给 B —— 代码里那道闸写得再对
  也只剩形式。**判据的实际出口常在响应头里，不在 `if` 里。**

## Added

- **39 条判据，三层各一套**：`src/lib/media/output-access.test.ts` 19 条 +
  `src/app/api/generated/[...path]/route.test.ts` 11 条 + `src/proxy.test.ts` 9 条。
  判据层走**内存 SQLite + 真 Drizzle**（把仓储 mock 掉等于把要测的那一层换掉），
  逐族钉「我的 / 别人的 / 查不到」三档，并断言无主前缀**根本不去查库**；
  路由层钉 401、两种穿越形状（`../` 与兄弟目录前缀碰撞）、他人产物 404 且一次都不读盘、
  单用户跳过归属判定、`private` + `immutable`；接线层钉「改写只动 pathname、查询串保留、
  `/api/generated` 不二次改写」，并**直接断言 `config.matcher` 里有产物前缀那两条** ——
  因为 `matcher` 里沿用下来的那条通配把带点的路径整个排除，而产物 URL 个个带扩展名。
  反向验证八处，每处只红该管的那几条：归属闸整块摘掉 → 2 红；无条件判定（不分单/多用户）
  → 1 红；缓存退回 `public` → 1 红；无主前缀豁免摘掉 → 2 红；「查不到」改判成别人的 → 1 红；
  `projects` 一族漏判 → 1 红；`matcher` 漏掉产物前缀（`proxy()` 一个字不动）→ 真机回到
  静态口 200 / 带闸口 401 的分叉，且零报错；不设 rewrite、只留静态口 → 同一份图两处答案不同。
- **两个新入口按实测满档进覆盖率门槛**（§18.6，均 100/100/100/100）：
  `media/output-access.ts` 敢设满档是因为那六个分支真的各有用例，掉任何一支当场变红；
  `src/proxy.ts` 单列的理由见上 —— 它坏掉的形态是零报错，不数字盯着就等于没接。
- 两处刻意留下的边界写成**看得见的**，而不是被 `return false` 吸收：
  归属判定**只在 `loginRequired` 打开时启用**（关掉时每个请求都解析成同一个演示用户，
  判定在数学上不可能有不同结果，只会因历史行 `userId` 漂移把用户自己的产物打裂）；
  `films/bgm` 是**无主内容**（上传口落在全局单一目录、不记归属），显式列在
  `UNSCOPED_PREFIXES` 里 —— 新增落点时先问「它属于某个用户吗」，属于却没进这张表的，
  就是漏了一条判据。
- 规范 §11.2.1 补两条口径：「**加了属主判定就要回头审缓存指令**」与
  「**判据装在 handler 上 ≠ 请求会走到 handler**」（含 `public/**` 静态旁路、
  `afterFiles` 压不过真文件、`matcher` 排除带点路径这三档实测数据）。
- 规范 §11.13 记第三类红：**断言「某个竞态真的发生」的用例，在满载并行下不再发生**
  （全量跑撞到 `tests/sqlite-pragma-sites.test.ts` 的 8 进程抢锁量具红 1 条，
  隔离重跑 9/9 绿、该条 3624ms）。它报的是 `AssertionError` 而不是超时，抬预算无用 ——
  要收得改构造（同步屏障，或把断言换成「抛过即证明量具有效」）。本刀只记现象与定性，
  **未做 master 基线复算**，下一位撞到同一红时先按 §13.6.2 复算再定性。
