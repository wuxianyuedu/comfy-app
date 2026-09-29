## Added

- **闸门类 API 路由第一批用例（体检清单 ⑦ 的第一刀）：5 个端点 / 34 条用例**，并全部进
  覆盖率门槛。选它们而不是按字母顺序铺：这些端点的正确性**全部**落在闸门上，而闸门是
  「改坏了不会报错、只会静默放行」的那类逻辑 —— 此前 40 个 `route.ts` 只有 7 个带测试。
  - `GET /api/generated/[...path]` —— 任务产物文件流（按调用方给的路径读盘）。穿越出根 403、
    **兄弟目录前缀碰撞**（`generated-evil`）也 403、解析回根不去 `readFile` 目录、
    读不到 404 且不回 fs 原文、命中时 `Content-Type` 走唯一出口 `contentTypeForPath`
    且带 `immutable`。反向验证过：把 `startsWith(root + path.sep)` 简化成
    `startsWith(root)`，恰好那条兄弟目录用例变红。
  - `GET /api/debug/source` —— 画布调试模式读源码。未登录 401 且一次都不读盘（401 走
    `~/server/lib/error-response` 的唯一信封形态，不在路由里手抄，§10.9 / ISSUE #573）、
    缺参数 / NUL / 白名单外扩展名各给**不同**的 400 原因、`../` 与绝对路径 403、
    **项目根内的 `.env` 也读不到**（挡它的是 src 包含判据而不是 `../` 检查）、404 不回原文。
  - `POST /api/comfy/ensure` —— ISSUE #345 那条三态契约（200 可用 / 202 正在启动 /
    503 启动失败）逐态钉住，外加三条容易在重构里丢的性质：**已在运行就不重复拉起**、
    单次请求只等短窗口（整段冷启动交给前端轮）、拉起过程必须 `onLog` 留痕（硬规则 4）。
  - `GET /api/comfy/stats` 与 `GET /api/comfy/queue` —— 状态栏两个轮询格：降级形状
    （`null → { online: false }`）与「离线折叠归采集器、路由不再兜一层」的分工，
    以及 `force-dynamic` 不许掉（GET 被缓存 = 进度停在第一次的快照）。
- **`coverage.include` 里动态段目录名必须转义**（实测撞到的第三种静默失效，规范 §11.7）：
  `src/app/api/generated/[...path]/route.ts` 按字面量写进 `include` 时，`[...path]` 被 glob
  当成**字符类**，条目匹配不到任何文件 —— 路由被加载、34 条用例全过，报告里却查无此文件，
  `thresholds` 成了一条空挂的登记。写成 `\\[...path\\]` 后条目立刻出现。给 `[id]` /
  `[[...slug]]` 这类路由加门槛时同理；核对办法是**去报告里找这一条在不在**，不是看用例绿不绿。
- 配套文档：`docs/guides/TESTING.md` 的「测试栈与配方」加一行 API 路由的写法
  （mock 依赖 → `await import("./route")` → 断状态码与信封；只测正常路径等于没测），
  「已知边界」那条按实测改成 `route.ts` 12/40。
