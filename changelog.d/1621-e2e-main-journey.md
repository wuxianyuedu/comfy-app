## Added

- **主链路 E2E：登录 → 建项目 → 出图（`e2e/main-journey.spec.ts`）**（ISSUE #1621 阶段二 2-2）。
  此前 `e2e/` 里 17 个 spec **没有一条走完这条主链路** —— `critical-flows.spec.ts` 的登录用例
  明写「不假装认证成功」，登录后的视图全靠 `route.fulfill` 桩，于是「壳起不来 / 会话过期 /
  中间件改写」这类**只在真实 HTTP 栈上成立**的缺陷没有执行者（台账 E3″）。新用例每一步都走真件：
  better-auth 真注册 + 真会话 cookie、`project.upsert` 真写库，出图那一跳由真执行器派出、
  真收口到 `SUCCEEDED`，产物真落盘（`generated/` 下的 PNG + `manifest.json`）。断言的是
  **链路产物**（DB 里的项目行、任务的终态 + `TaskImage` 行），不是「按钮点了」。
- **假 comfy-cli（`e2e/support/fake-comfyui/comfy_cli/`）**：本应用的任务**只经 comfy-cli 执行**
  （`executor-cli.ts` 起 `python -m comfy_cli run --workflow …`），提交、进度、收口判定全部读它的
  stdout 协议 —— `page.route` 一条都拦不到。替身只复刻**外部契约**（命令行 + 事件序列
  `converted → queued → executing/progress → execution_success → executed → envelope`），
  本仓库的执行器逻辑一行都没抄（§12.12 判的是仓库内两份同样实现，不是被替身掉的外部程序）。
  经 `COMFY_CLI_PYTHON` 注入（它是设置项 `comfyCliPython` 的默认值来源），对 CI 的要求只是
  `python3`，不是「装好 torch 的 ComfyUI 环境」。
- **假 ComfyUI 补上执行下游那几条口**（`e2e/support/fake-comfyui-server.mjs`）：原来只有
  `/`、`/system_stats`（ISSUE #310 的内嵌探测用），现在加 `/prompt`、`/api/history/{id}`、
  `/api/view`（产物字节）、`/queue` 与 WebSocket（`/ws` 与 `/api/ws` 两条都答，否则客户端会
  一直重连、把日志面板刷成重连流水），以及只服务 E2E 的登记口 `/e2e/record-history`。
- **失败路径同样有执行者**：第二条用例用假 comfy-cli 的**哨兵触发**（工作流里出现某个词 →
  回放失败序列），断言终态是 `FAILED` **且 error 里带着假 CLI 给的原因** —— 而不是
  「未收到 envelope」这类把矛头指向我们自己的兜底话术（ISSUE #1621 验收标准 3）。

## Tests

- 两条用例走真 `pnpm exec playwright test --grep @critical`，都过。**两条变异各红各的**：
  ① 摘掉假 CLI 的 `envelope` 事件（收口信号消失）→ 成功用例红（`comfy-cli 异常退出（code=0）`），
  失败用例照绿；② 把哨兵从工作流里删掉 → 失败用例红（跑成 `SUCCEEDED`），成功用例照绿。
  复位后两条全绿。
- 全套 `--grep @critical`（69 条）实跑：**67 过**。另有 2 条红
  （`project-context-refresh.spec.ts` 的两条、`critical-flows.spec.ts` 的虚拟滚动那条），
  **已用 `git stash` 在干净 `master` 上复算确认为 `baseline-red`** —— 与本笔无关，
  不属本笔范围。

## Docs

- `playwright.config.ts` 的 `webServer.env` 增加两处说明：为什么必须在这一层注入
  （执行器是**服务端**起的子进程，浏览器侧任何拦截都够不到），以及缺件时不该让全套 e2e 起不来。
