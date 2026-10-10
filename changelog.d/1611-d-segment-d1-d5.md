## Fixed

- **`app-runtime` 的跨进程补齐通道不再写固定名，改落「本次启动那一份」**（ISSUE #1611 阶段三 D 段 D1）。
  `scripts/dev-launcher.mjs` 的 `appendRuntimeWarning()`（壳过期 / pnpm 不匹配两条预检提醒，
  发生在 dev server 就绪**之前**、走不了 `POST /api/logs/app-runtime`）此前按固定名
  `app-runtime.log` 追加 —— 而读侧把固定名认作 `startedAt: null` =「迁移前的全部历史」、
  排序恒最前，保留策略删的却是**最旧的那几份**：于是它被当最旧的一份先删掉、再由下一次
  `appendFileSync` 重建，「删除 → 重建」交替，**正在写的那一份被轮转逻辑当垃圾清掉**
  （静默丢日志）；同来源不足保留份数时它又一直追加、没有上限。
  现在名字戳由 launcher 产出（它先于 dev server 存在）、经 `COMFYAPP_LAUNCH_STAMP` 透传，
  `app-runtime-log.ts` 的 `writerFor()` 走 `openRuntimeLogWriter(..., { reuse })` 续写**同一份**。

## Security

- **`/api/health` 的跨域放行从 `*` 收窄为「启动页那一族源」**（ISSUE #1611 阶段三 D 段 D5）。
  白名单在 `src/lib/shell/splash-origin.ts`（`tauri://localhost` / `http(s)://tauri.localhost`），
  放行时回显请求的源并带 `Vary: Origin`（只给前者时链路上的缓存会把第一个访问者的头复用给
  所有源 —— 白名单形同虚设且是静默的）。**不是直接删掉 `*`**：启动页与 dev server 不同源，
  必须走 `mode: "cors"` 才读得到真实状态码（no-cors 的 opaque 响应读不到，那是历史「过早导航」
  的根因），删掉会打坏启动页的就绪判定。
  同时 503 的 `hint` 摘掉**内部文档路径**（`docs/standards/launch-and-build.md §9.1`）—— 它此前
  经 `*` 回给任意源，而本端点的读者（本机用户 / 外部探针）没有一个是来读仓库文档的。新文案先
  说自己会好（桌包首启的常规形态是入口在零表时应用随包的 `schema.sql`），再给开发检出的
  `pnpm db:push`。

## Docs

- 规范 07 §7.13「启动期警告补录 app-runtime」纠偏：原描述说写方是
  `scripts/dev-launcher.ps1` 的 `Write-ShellStaleRuntimeLog` —— **该函数在代码里根本不存在**
  （`dev-launcher.ps1` 按硬规则 12 只剩「定位 → 调用 → 透传退出码」），照它去改会改错文件；
  并写明固定名那段「删除 → 重建」的失效形态。
- `PRODUCTION-GAPS.md` 的 D1 / D5 从待办改判为已闭合，逐条记下判据文件名（台账口径：
  勾销必须与判据同批）。

## Tests

- `tests/runtime-log-cross-language.test.ts`：launcher（`.mjs`）与 dev server（TS）的
  runtime 日志文件名**真跑对拍**，并反向钉住「launcher 不再出现 `"app-runtime.log"` 字面量」
  与 `COMFYAPP_LAUNCH_STAMP` 两侧同串（变异验证：还原固定名 → 该条即红）。
- `src/lib/shell/splash-origin.test.ts`（6 条）：三源放行、别的源**一个头都不给**、
  回别的值等于放行、`Vary` 必带、前缀 / 大小写宽容是最经典的失效形态。
- `src/app/api/health/route.test.ts` 增跨域面 4 条（含「无 `Origin` 的 Node 探针照常 200」
  与「503 的 hint 不含 `docs/`」）。
- `src/lib/log/runtime-log-pack.server.test.ts` 增 `reuse` 三条（续写同一份、不给 reuse
  时照旧另开、目录不存在也能建）；`src/lib/log/runtime-log-file.test.ts` 增
  `parseLaunchStamp` 三条（形态不符给 null，**不硬拼半个名字**）。
