## Changed

- **ComfyUI 状态探测的两处系统查询换成更便宜的写法，「设置页打开要等几秒才显示运行中」的成因再少两条**：判定链上原本要起两次 PowerShell，一次枚举 `Win32_Process`（本机实测 ~2.5s，冷启动高负载下会顶到 10s 超时），一次 `Get-NetTCPConnection` 查监听端口（`-OwningProcess` 并不是服务端过滤，同样要枚举全部 TCP 连接，~2.5s）。现在 ①「找 main.py 的进程」把进程名过滤**下推到 WMI**（`-Filter` 在仓储层过滤，只有 `Name LIKE 'python%'` 的少数进程被物化），②「查 PID 的监听端口」改用系统自带的 `netstat -ano -p TCP`（原生程序，毫秒级，不付 PowerShell 的进程启动开销），与启动器侧 `listenerPidsOnPort` 同一口径。另外把「配置端口是否应答」的结论在快照内部传递，不再让失败路径把同一次探测重做一遍（探失败要等满 1.5s 超时）。
- **本地工作流目录的 checksum 加上 `mtime + size` 记忆，`workflow.list` 不再每趟轮询重读全部工作流文件**：`scanLocalWorkflowChecksums` 原先在**每一次** `workflow.list` 里把这个根目录下每个 `.json` / `.workflow` 完整读一遍再算 SHA-1（工作流 JSON 动辄几 MB，几十个文件并发 8），而文件在两次轮询之间根本没变 —— 这是该接口稳定 1s+ 的主因。现在按「路径 + mtime + size」三元组记忆上一趟的 checksum，三者都没变时连文件都不打开；文件真的改了（mtime 或 size 落在外）一律重算。记忆挂在 `globalThis`（HMR 安全）并有 512 条容量上限。

## Fixed

- **`workflowTemplate.listForUser` 的「列投影」一直没生效，列表把每个模板的整行大字段都查了出来**：该方法的 `select()` 不带列定义（迁移到 Drizzle 时留下的空 `_select` 参数），于是 `positions`（每个节点的坐标）这个大 JSON blob 白白跨过 SQLite → 驱动的边界。现在换成显式列投影，只少读 `positions`；`rawJson` **必须留**（可执行性判据与紧凑预览都以它为真值来源），列表页要用的其余列一个不少。
