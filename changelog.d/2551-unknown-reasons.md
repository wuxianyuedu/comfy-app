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
