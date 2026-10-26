## Fixed

- **被轮询的日志路由不再用同步 fs IO**（ISSUE #2193，audit §C.5 M12）。原点写的是
  「`/api/logs/current` 被面板每 2s 打一遍」，两处复算之后面比那处大：
  - 轮询的是**六路**来源（`LogProvider` 的 `POLL_SOURCES`：launcher / shell-launch / shell /
    dev / app / app-runtime），不是台账旧话里的四路；
  - 按原登记那条检索式（`statSync|readFileSync|readdirSync`）在场的是**五份** route
    （`current` / `sessions` / `diagnostics` / `history` / `list`，台账只点了前两份）；
  - 改成**按目录现算**又抓到第六份 `export` —— 它用的是 `mkdirSync` + `writeFileSync`，
    根本不在那条 grep 的量程里。「清单点数」与「按目录现算」的差就是这么长出来的。
- 处置与边界：
  - 六份 route 的读写改 `fs.promises`；轮询链真正经过的四个读侧 helper 一并异步化
    （`fileMtimeMs` / `latestPanelLogFile` / `listRuntimeLogFiles` + `latestRuntimeLogFile` /
    `scanRunPacks`）。
  - **写侧刻意不动**（`appendFileSync` 落盘、`prune*` 的 `rmSync`、启动期 `mkdirSync`）：
    它们不在被轮询的那条链上，异步化会把整条 lifecycle 的签名拖进来 —— 那是另一轮，
    本轮不借机扩面。
  - `listRuntimeLogFiles` 拆成「**一份纯映射 + 两个 IO 载体**」（异步给轮询链、同步留给启动期
    的 `pruneRuntimeLogFiles` / `countRuntimeLogFiles`）：顺序判据只有一份，
    抄两份的漂移形态是静默的（某些项顺序不对）而两边各自都「看起来是对的」。
  - 单 `stat` 合并：`current` 原来每次请求打 `existsSync` + `statSync` 两趟，现在一次
    `fs.promises.stat` 同时回答「不存在 ⇒ 空切片」与「读不到 ⇒ 500」两档 ——
    这两档**没有被并成一个 catch-all**（`history` 的 ENOENT→400、其它错误→500 同口径），
    「读不到」不许冒充「没有日志」。
  - 台账点名的两处风险逐处过：`turbopackIgnore` **跟着调用点搬**，`current` 那 7 枚变 3 枚是
    合并系统调用的结果而不是漏搬；`history` / `list` 原本不带标记，也**没有**给它们补
    （加标记同样是改 tracing）。`scanRunPacks` 保持**逐包 await** 而不是 `Promise.all` ——
    输出顺序本身就是判据（并发完成顺序会把它打乱）。
- 判据：新增 `tests/log-routes-no-sync-fs.test.ts` —— 面**按目录取**（`src/app/api/logs/**/route.ts`，
  新加一份自动进面；目录空了先红，不让下一条悄悄恒真），匹配前先过
  `tests/helpers/strip-comments.ts`（注释里必须能出现 `statSync` 这个名字，那些文件正是要说明
  「为什么不再是它」）。它一落地就抓到 `export` 那份（第六处），即先红后修。
  另附两条负控制：真同步形态抓得到、`fs.promises.*` 不误伤。
- 验证（都是实跑，不是推断）：
  - 既有读取契约用例**一字未改**并全绿：`current/route.test.ts` 12 条、`sessions/route.test.ts` 23 条、
    四个 helper 的用例 39 条；连带 9 份相邻用例 307 条全绿；`pnpm typecheck` 与全量 `pnpm lint` 绿。
  - `pnpm run build` EXIT=0：`[standalone] ✓ 产物干净（共 3152 个文件…）`、bundle-budget 在预算内、
    packaged-host 冒烟起得来；路由表里六条 `/api/logs/*` 仍全为动态（ƒ）——
    这是 tracing 面没变的正面读数（漏搬标记的表现正是「构建期过、出厂件缺件」，硬规则 17 / 18）。
  - 真机 dev server（本机 3760）按面板的取数顺序逐条打：六路 `current` 各 200、
    `list` 22 份、`history` 正例 200 读到 1343 字 / 穿越形态与缺失形态各 400、
    `export` 正例 200 落盘 / 空正文 400、`diagnostics` 200（`bytes` 那格就是异步 `stat` 的结果）；
    游标增量成立：第二帧 `offset` = 第一帧 `size`（1157 → 1258，新增 101 字）。
    测试产生的两份导出件已删除。
  - **浏览器里那一轮没跑成，原因说清**：Qoder 内置浏览器无可见 surface（`visibilityState=hidden`），
    而 `LogProvider` 的文件轮询正是「不可见即暂停」——网络面里只见到每 30s 一拍的
    `/api/dev/build-id`（那条 `pauseWhenHidden: false`），六路 `logs/current` 一条没发。
    这是正确行为不是坏了；所以「面板开着切四次来源」那一格本轮由 HTTP 侧等价验证代替，
    **没有**声称在浏览器里点过。
  - 不主张毫秒收益：dev 模式首帧含按需编译，跨档不可比（六路一轮并发 189.4ms / 串行 145.3ms
    这类数在本仓不可引用为因果）。承重的是「请求路径上同步系统调用清零」这条可判的形状。
- 顺带（撞上但**不在本轮修**，已立案）：#2417 —— `isPanelSelfPollingLine` 的端点集合停在
  `logs/current` + `dev/server-id` 两个名字上，`/api/dev/build-id` 的回声行不滤；
  以及台账/注释里「4 路来源」那两处旧话（`log-analysis.ts:325`、`log-store.test.ts:1263`）由它处置。
- 文档：`docs/audits/2026-09-26-performance-audit.md` §C.5 的 M12 从 ⬜ 改成已闭环，
  把「六路 / 六份 / 第六处靠判据才现形」写回台账；L15 那句指向 M12 的 forward reference 同批改口径。
  该文件不在 `SCOPED_DOCS`（实测 `SCOPED_DOCS.includes(...) = false`）⇒ 无同批生成态镜像。
