## Added
- `pnpm inspect:runtime [--json]`（#5169）：排查端口 / 进程 / 探活此前手敲 `Get-NetTCPConnection` / `Get-CimInstance` / `netstat -ano`，判不出归属（隔壁检出占同一端口）且容易误杀。现在只读输出「本检出解析端口（含 +1/+2 顺延位）→ 监听 PID → 归属 own/session/foreign → `/api/health` 四态」；全部复用 `resolveAppPort` / `scanPorts` / `listeningPidsOnPort` / `processCommandLines` / `classifyProbe`，foreign 只列不碰，探测失败落「没量到」而非「空闲」。补归属三分与命令行截断用例。
