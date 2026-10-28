## Fixed

**令牌权限读数改走平台 HTTP 接口，不再起 `cnb`**（ISSUE #2551，五跑读数换来的）。

前四跑在 PR 上都是一整片「没拿到答复」，而同一跑的 `PR 失败立案` 拿得到平台的真答复
（403 + `Missing required scopes: repo-cnb-history:r`）。把「没拿到答复」拆成四种成因
之后才看清根因：**自托管 runner 的宿主 PATH 上没有 `cnb`**（`Install dependencies`
那一格的日志里只有 node / pnpm / git），而 `PR 失败立案` 是在**装完依赖之后**由
`ship-exec.mjs` 的 `cnbSpawn()` 解析到包真身的 —— 这一格要在装依赖之前就能跑。

- 探针表从「子命令」改成**只读子路径**，取数走 `fetch`：
  `GET {CNB_API_ENDPOINT}/{repo}/-/{path}`，头是 `Authorization: Bearer <CNB_TOKEN>`
  与 `Accept: application/json`。两者都是平台**无条件注入**的东西（官方 build-in-env.md），
  加宿主 Node 自带的 `fetch` ⇒ 零额外工具链、能在流水线任何一步之前跑。
- `classifyReply()` 的三档不变，但「没量到」那一路**四种成因各念一句**
  （起不来 / 没有响应正文 / 响应里既没信封也没 errmsg / 平台回了 NNN：`<errmsg 原文>`）——
  上一版把它们印成同一句，等于把「不知道什么原因」写成了「没有权限」的形状。
- 业务层「对象不存在」认两族码（`errcode 5` 与 `errcode 4xx`），都读成「平台认了这次请求」：
  PR #1 不存在走的是后者，而它不是权限问题。
- 平台那一跳仍然**不带 `--strict`**：PR 那一族的令牌连 `repo-cnb-history:r` 都没有，
  这不是这一格坏了，那正是它要量的东西。

### 第五跑：撞上 2m 预算

读数在 PR 上第一次跑通了（`repo-code` / `repo-issue` / `repo-pr` / `repo-cnb-history`
全部「获授权」，`repo-manage` / `repo-security` 被平台点名缺），但它**整格被判超时**
（`任务超过最大执行时间而被强制关闭：2m0s`）—— 十四条探针串行跑，一次慢请求被乘成十四次。

- 改成**有界并发**（6 路）：探针之间互不依赖，串行只是把一次慢请求乘上条数；
- 预算是「卡死要早报」的量级，**不按那次读数调**：并发之后单条慢请求已经被掩盖掉，
  剩下的风险是平台整体慢 ⇒ 三处 `timeout` 从 2m 提到 5m（与每日档其余读数列同量级）；
- 读数末尾加一行**耗时**（合计 + 最慢三条）：下一跑就不用猜时间花在哪。
