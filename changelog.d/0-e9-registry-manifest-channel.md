## Fixed

- **自定义节点注册表整条灌入链是断的：`/api/custom-nodes/manifest` 没有 handler，客户端那两句 `fetch` 每天命中 404**（台账 E14，E9 点名留下的那一格补的时候才照到下游）。补回落点的同时把「有 / 没有」两相加回第三相：`missing`（还没解析过 → 404 + 稳定码，正常冷启动不写错误日志）/ `unreadable`（读盘故障 → 500 + errno，必须留痕）/ `ok`。**为什么要多这一相**：`0` 既是「解析器确实一个自定义节点都没找到」的合法结果，也是「没清单 / 没登录 / 读不到」的返回值，两类在界面上同形就是这次事故的全部 —— 注册表恒空、设置面板预览卡恒空，而唯一的痕迹是一句没人看的 `console.warn`。
  端点要登录（清单里带 `packages[*].path` 与 `sources`，那是机器画像，口径同台账 A13），响应 `private, no-store`（这条链的正确性就是「刚解析完必须拿到新的一份」，任何中间缓存把旧清单当新答案会原样复现本次事故），`runtime=nodejs` + `dynamic=force-dynamic`。「路径 + 指纹 + 读法」收进 `src/lib/comfyui/custom-nodes-manifest.server.ts` 一处，摘要端点与清单端点各写一遍会分叉（同 §12.12 记过的 `firstframe.ts` 学费）。
- **注册表刷新有了通知通道，两端同批落地**：`comfyapp:custom-nodes-updated` 的派发在 `src/config/custom-nodes.ts` 的 `recordRegistry`（结论没变不广播、失败档不涨版本号），订阅在 `src/components/studio/canvas/use-custom-nodes-registry.ts`，接在 `FlowNode` 上。`FlowNode` 是 `React.memo` 的，而它下面读的正是那两个**就地替换**的可变 map —— 于是「从设置面板解析出新节点后，视图要硬刷新才看见」是结构性的，不是偶发。订阅侧走 `useSyncExternalStore` 的快照读，补上「最早那次灌入发生在画布挂载的 effect 里、那一刻订阅还没建立」那一格。

## Tests

- **两条「判据在场但抓不到」的精确化**（这一族比缺判据更贵，因为它长得像有人守门）：
  - `tests/app-event-pairing.test.ts` 原来只要求「派发与订阅两处计数都非零」，于是**同一个文件里自己发自己听**也算两端齐全 —— 现场表现与「订阅方没了」一模一样，而静态上看不出。改成「存在一对**不同文件**的两端」，并留一条不误报的反证（派发方自己也订阅一条是常见形状，只要另有外部订阅者就不许报）。
  - `tests/rest-endpoint-targets.test.ts` 原来按语法豁免「前一位是 `}`」的地址，理由是「那是 ComfyUI / Ollama 的接口」。语法上说得通、语义上漏：`` `${base}/api/custom-nodes/manifest` `` 前一位也是 `}`，而它是**同源**地址，本次事故正是从这一格躲过去的。改成默认判、按整条规范地址登记放行，新增 `UPSTREAM_SERVICE_ADDRESS` 十条（本机 ComfyUI 的 prompt / history / view / upload / interrupt / object_info / models，Ollama 的 tags / version），吃与 `NON_REQUEST_ADDRESS` 同一套双向陈旧判据 —— 哪天本应用在同名路径上立了 handler，登记表自己红。
  - 变异证明：把补回的 `manifest/route.ts` 挪走再跑判据 → 「每条地址都要有落点」与新增那条「`}` 形态确实被判到了」双双红（旧判据下这一步全绿，这正是本批改动的收益本身）。
- 新增 60 条用例覆盖这一刀的四个出口：`src/app/api/custom-nodes/manifest/route.test.ts`（会话闸在碰磁盘之前、三相各自的状态码与稳定错误码、原文直出不经第二轮解析、`Cache-Control` 精确等于 `private, no-store`）、`src/lib/comfyui/custom-nodes-manifest.server.test.ts`（真读盘、按**相**分节钉住「每一相绝不能被读成另外两相」，含把清单位子做成目录触发 `EISDIR`、非法 JSON 照样是 `ok` 而不是故障）、`src/config/custom-nodes.test.ts`（灌入 / 三相失败 / 预览卡三路，逐档钉「哪一档该说话」：404 不写错误日志、401 与 500 必须留痕）、`src/components/studio/canvas/use-custom-nodes-registry.test.tsx`（挂载首读、多个订阅者各自被叫醒、去重传导到订阅侧、失败相不叫醒画布、订阅与退订一一成对）。
- 覆盖率：四个新出口 `lines/functions/statements/branches` 全部实测 100，`coverage.include` 与 `thresholds` **两处同批**登记。补到满档缺的那几支都是解析器版本漂移的真形态（整条为 `null` 的节点、没有端口的节点、没有 `nodes` 字段的清单、抛上来没有 `code` 的 Error），不是为凑分支数造夹具。

## Changed

- `AppEvents` 表里 `comfyapp:custom-nodes-updated` 的说明改为「有派发方也有订阅方」，并写清读侧为什么必须在挂载时先读一次表（本模块不排队重放）。
