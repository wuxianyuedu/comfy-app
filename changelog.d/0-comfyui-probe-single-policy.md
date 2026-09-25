## Fixed

- **ComfyUI 存活探测三处统一为「连上即存活」唯一口径（行为分叉修复）**：#685 把单点探测 `probeBaseOnce` 的判据从 `res.ok` 改为「连上即存活」（GPU 显存爆掉时 `/system_stats` 返回 HTTP 500 也算进程活着），但另有两处绕行未收口——`client.ts` 的端口扫描 `probePort` 仍要求 `res.ok`（同一 OOM 实例「单点判活、扫描判死」，设置页状态行与偏移扫描结论互相矛盾），`server/workshop/comfyui.ts`（MCP 通道）整段内联「+0..+5 扫描 + r.ok + 800ms」。现在三处一律走 `probeBaseOnce`：超时改为其可注入参数（扫描 300ms / MCP 800ms / 单点默认 1500ms），判据全库只有一份。附回归用例锁死超时透传与 500-判活语义。
