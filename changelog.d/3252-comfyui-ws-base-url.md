## Fixed

**每日档 `全量E2E` 的两条 `@critical` 主链路不再卡 60s「任务没有到终态」**（ISSUE #3252）：

- `src/lib/comfyui/client.ts` 的 `toWsBase()` —— 原来写成
  `httpBase.replace(/^http(?<s>s?):\/\//i, (_m, { s }) => …)`。`String#replace`
  回调的第二个参数是**第一个捕获组字符串**（`""` 或 `"s"`），命名组对象在**最后一个**
  参数，所以 `{ s }` 从字符串上解构得到 `undefined` ⇒ 拼出
  `wsundefined://127.0.0.1:18188/api/ws`。`new WebSocket()` 当场抛
  `The URL's protocol must be one of "ws:", "wss:", …`，而那个 catch 静默重试：
  每条路径都拼错 ⇒ WS **永不 OPEN** ⇒ `claimAndDispatchOnce()` 的就绪门控
  （`s.ws?.readyState !== WebSocket.OPEN`）永不领行 ⇒ 任务停在 `QUEUED`、
  `claimedAt=null` ⇒ 用例 60s 轮询后报「任务没有到终态：出图这一跳断了」。
- 修法：改成只换协议头的分支写法（`http:` → `ws:`、`https:` → `wss:`，其余逐字返回），
  不再用带捕获组的替换回调。
- `src/lib/comfyui/executor-ws.ts` —— 给 `new WebSocket()` 那个同步 catch 补一条
  `logger.warn`（URL 非法时不会走 `error` 事件，此前整条失败链在日志里只剩
  两次「Connected on configured port」）。
- 用例：新增 `tests/comfyui-ws-base.test.ts`（http / https / 大小写 / 非 http 前缀
  四种形态）。本机读数：`e2e/main-journey.spec.ts` 修前 2 failed（各 60s 超时），
  修后 `2 passed (24.3s)`。
