## Fixed

- **ISSUE #1900 的 e2e 尾巴：`critical-flows.spec.ts` 那三条「应用页签与全屏视图 @critical」在 `origin/master` 上就是红的**，
  本次合并进来后当场复现（`3 failed / 77 passed`）。定性与本仓 §13.6.2 的 `baseline-red` 同形，
  不是这次改动引入的 —— 两条证据：① 这三条用例所在的 1690-1800 行与 `origin/master` **逐字一致**
  （`git diff origin/master HEAD -- e2e/critical-flows.spec.ts` 只命中「流程 → 工作流库」那几行标签，
  在另一个 describe 里）；② 本分支三笔提交没有一个字节落在
  `src/components/studio/comfyui/**` 或 `src/app/(main)/settings/**` 上。
  上游当天的 e2e 档记的是**写明理由的豁免**而不是跑绿 —— 与这族红正好对得上。
- **成因一：用例还在按搬家前的路线走。** `openComfyFromSettings()` 进的是「设置 → 创作后端」，
  而 #1900 把运行态整块搬成了独立全局页签「ComfyUI」，设置那一屏只剩配置。
  「ComfyUI 运行中」这句话的两个产地（`comfyStatusText` / `comfyDotTitle`）现在**只有**
  `ComfyuiControlView` 用（`grep -rln` 当场数过），设置页只 import 了 `StatusButton` 那颗按钮 ——
  也就是说用例等的那句文案在那一屏根本渲染不出来，红是必然，与负载无关。
  现在改为 `gotoWorkspaceView(page, "ComfyUI")`，并按 #1693 之后的实际形状重认「仍在这屏」
  （页头可见标题已收掉，改用这一屏唯一的 `刷新 ComfyUI 状态` 出口）。
- **成因二：那条桩的响应信封早就不是真协议了，而且它卡住的是最后一跳。**
  旧 `stubComfyTrpc` 用 `route.fulfill({ result: { data } })` 回三格，而客户端是
  `httpBatchStreamLink` —— 它按 **JSON Lines** 读响应，喂旧信封时**不抛错、只是解不出数据**
  （`e2e/support/trpc-stub.ts` 文件头把这件事连同 ISSUE #1442 写得很清楚）。
  以前没暴露是因为那三条 `url.includes(...)` 命中的是设置页那批过程名；#1900 之后这一屏走
  `setting.comfyStatus`，桩对该页**一格都不命中**，于是「在浏览器打开」那条
  （`openComfyInBrowser` 先 `comfyStatusQ.refetch()` 再 `comfyOpen` 变异）卡在**永不 settle** 的
  refetch 上：按钮停在「打开中…」、`setting.comfyOpen` 一次都没发出、计数的 `poll` 干等到超时 ——
  红的形状与「功能坏了」逐字同形，而它其实是桩自己没被读到。
  现在把这一屏的三个过程一次登记给 `stubTrpc`（JSONL 形状，仓库里唯一的实现），
  计次改成 `page.on("request")`：**同一个 URL 只能有一个处理器**，路由位归了 `stubTrpc` 之后再挂
  第二条会把它整个遮蔽（那条注释里的「实测计数恒 0」正是这个坑的另一个方向）。

## 刻意没做的事（写清楚，别当成已完成）

- **没有**把其余几处「形状喂不进 `httpBatchStreamLink`」的 `page.route("**/api/trpc/**")` 一并改写。
  本次只改这条红路上的那一处。当场数过的存量（`grep -c 'page.route("\*\*/api/trpc' e2e/*.spec.ts`
  与逐处读正文）：**3 处想注入数据而形状不可读** —— `critical-flows.spec.ts` 的 `stubBackend()`
  回 `body: "[]"`、同文件任务详情那一处回 `JSON.stringify({ result: { data: … } })`、
  `project-context-refresh.spec.ts` 的回 `{ json: [] }`；另有 **1 处是刻意不回应**
  （60s 拖住 `workflow.list` 来造加载态，那是它的正确语义，不算债）。
  这 3 处是否真的依赖被桩住的数据，**没有逐处判过** —— 它们目前绿，而「绿」在这里只说明
  断言没用到那个槽位，**不说明信封是对的**。收它应当各自按「哪条判据在依赖哪一格数据」来定，
  不该塞进一条修红的提交里。
- 没有动 `setting.comfyStatus` 的服务端形状，也没有为桩补 `comfyInstance`：
  未登记的过程按 `stubTrpc` 的既有语义继续打到真实服务端（本档自带假 ComfyUI，端口由
  `fake-comfyui-endpoint.mjs` 给），这是设计而不是漏网。
- 没有为了让这三条过而放宽任何等待预算：`timeout: 60_000` 与 `factor: 2` 一个字节没动。

## 验证

- 定向复跑该 describe：`17 passed (53.7s)`，三条原本红的各归位 ——
  「打开查看」9.4s、「内嵌探测结论」8.1s、「在浏览器打开」**2.1s**（这一条改前是停在
  「打开中…」+ 计数恒 0 的超时形态，读数在案）。
- 全量 `pnpm test:e2e` 见同批 `0-e2e-stable-reds-batch.md` 的读数（合并 `origin/master` 之后重跑）。
- 归因用的两条静态证据都在上面（逐字一致的范围 + 三笔提交的文件面）。
