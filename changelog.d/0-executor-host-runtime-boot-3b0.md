## Added

- **P3 §5 第 2 期 · Phase 3-B0：executor-host 运行时地基（tsx 加载链 + DB 注入 + Q2 首扫，仍不领流量）**：摸底确认 2-B/2-C 交付的 host 是纯骨架（无 tsx / 无 libsql 客户端 / 无任何 configureXxx 调用，ADR §4 启动链一行未接），故把原「3-B 接流量」拆为 **3-B0 地基 / 3-B1 接流量**（分派已签字、记入设计文档 §13 实施增补 v3）。本 PR 零行为变化：`COMFY_EXECUTOR=host` 时 boot 跑「`tsx/esm/api` 加载 TS → libsql file 客户端（`DATABASE_URL` 优先级 = 进程 env → `.env` 回读（复用 `env-preflight.mjs` 的 `parseEnvFile`）→ 默认，对齐 Next 侧）→ `createTaskRepoImpl(drizzle(client))` → 注入 reaper/enqueue/trace 三条 seam → Q2 首扫（只扫 host 片）」；任何一步失败**大声 exit 1**（不退化成心跳假活，硬规则 4）。未设 env 时保持 2-B 骨架行为，原三条契约测一字不改仍绿。runner/executor-cli/executor-finalize/executor-ws 四条 seam 属 3-B1（缺的是 host 版执行依赖）。

## Changed

- **reaper 归属分片（自 3-B1 提前——代码事实倒逼）**：`reaper.ts` 在模块加载时就有一次 sweep（`startReaper()` 副作用），孤儿判决依赖**进程内**内存足迹；host 不分片会把 inline「QUEUED>30s 尚未进 ComfyUI」的在飞任务误判成孤儿杀掉。落地：`listStaleQueued/listStaleRunning` 加 `owner` 参数（缺省 `'inline'`，Next 侧签名与行为不变），归属谓词与 `claimNextQueued` 共用 impl 的单一定义 `ownedBy()`；`ReaperDeps` 加 `owner`（host 注入 `'host'`）。
- **reaper 未注入时的兜底从「server-only throw 炸 unhandled rejection」改为「跳过本轮 + 一次性 warn」**：实测纯 Node 进程 import reaper 即产两条 unhandled rejection（模块初扫走 Next barrel 兜底撞 `server-only`）；注入前跳过是安全的（回收幂等、下一轮重来），注入后永不再走这条。
- 测试：`repository-task-impl.test.ts` +2 条分片契约（QUEUED/RUNNING 片各一条：host 片只数 `'host'` 行、缺省参 = inline 片、与领取同一判据）；`tests/executor-host.test.ts` +2 条运行时契约——**golden 跨片零误杀**（临时库种 inline 片超时孤儿 → host `--once` boot 后仍 `QUEUED`、`hostShardQueued=0`、exit 0）+ 库不可达 → `runtime boot FAILED` + exit 1。已知既有 flake（非本 PR 引入，master 基线同样复现）：`executor-cli`/`cli-procs-singleton` 两条接缝测全量并跑偶发 5s 超时、单跑必绿，留作独立治理项。
