# 多检出共同制作一部剧集：操作指南（ISSUE #5207）

适用：同一台机器上启动多个检出 / 安装副本，共同完成同一个动漫剧集项目。**不需要登录。**

## 1. 拓扑

| 角色 | 进程 | 职责 |
| --- | --- | --- |
| 主控（唯一） | UI + executor-host + ComfyUI | 领取并执行生图 / 生视频 / 成片任务、监看、合成 |
| UI-only（可多个） | 仅 Next UI | 编辑剧集 / 镜头、看板、评审、查看产物 |

主控必须只有一个：执行分片只有 `inline` / `host` 两片，reaper 以「本进程没有在飞账 ⇒ 真孤儿」判死，前提是同一分片只有一个宿主。

## 2. 每个检出的环境变量

以共享目录 `<共享根>` 为例（放 `db.sqlite`、WAL/SHM、产物与心跳）：

| 变量 | 主控 | UI-only | 备注 |
| --- | --- | --- | --- |
| `DATABASE_URL` | `file:<共享根>/db.sqlite` | 同左 | **必须绝对 `file:` 形态**；Windows 裸盘符会被 libsql 当 scheme |
| `COMFY_EXECUTOR` | `host` | `host` | 任务写 host 归属，UI 进程不自己执行 |
| `COMFYAPP_SKIP_EXECUTOR_HOST` | 不设 | `1` | **进程环境变量**，写 `.env` 无效 |
| `COMFYAPP_HOST_HEARTBEAT` | `<共享根>/executor-host-heartbeat.json` | 同左 | 不同步会导致 reaper 误判主控在飞任务为孤儿 |
| `COMFYAPP_GENERATED_ROOT` | `<共享根>/generated` | 同左 | 产物根；URL 前缀 `/api/generated` 不变 |
| 应用端口 | 按检出推导链独立 | 同左 | 不同端口即不同浏览器源，偏好互不污染 |

启动示例（Windows PowerShell，UI-only）：

```powershell
$env:DATABASE_URL = 'file:G:/shared/comfy-series/db.sqlite'
$env:COMFY_EXECUTOR = 'host'
$env:COMFYAPP_SKIP_EXECUTOR_HOST = '1'
$env:COMFYAPP_HOST_HEARTBEAT = 'G:/shared/comfy-series/executor-host-heartbeat.json'
$env:COMFYAPP_GENERATED_ROOT = 'G:/shared/comfy-series/generated'
pnpm dev
```

主控不要设 `COMFYAPP_SKIP_EXECUTOR_HOST`；其余变量同值。

## 3. 启动顺序

1. **先在唯一主控上把 schema 同步到最新**：`pnpm db:push`（或用该检出的常规启动链完成同步）。
2. 等主控的宿主心跳文件出现并持续更新。
3. 再启动 UI-only 检出。多个 UI-only 检出不要同时从零做 schema 同步——`COMFYAPP_SKIP_SCHEMA_SYNC` 目前并非所有入口都认，并发写同一库有撞锁风险。

## 4. 常见故障与读数

| 现象 | 原因 | 处置 |
| --- | --- | --- |
| 看得到任务、看不到图 | 只共享了 DB，没共享产物根 | 各检出设同一个 `COMFYAPP_GENERATED_ROOT` |
| 主控正在跑的任务被判 FAILED、日志有「没有该任务的在飞执行」 | UI-only 检出读不到主控心跳，reaper 误判孤儿 | 各检出设同一个绝对 `COMFYAPP_HOST_HEARTBEAT` |
| 出现多个宿主、任务被互相撤 | UI-only 设了 `COMFY_EXECUTOR=host` 但没设 SKIP，或把 SKIP 写进了 `.env` | SKIP 必须作为进程环境变量给出 |
| DB 启动报 scheme / 打不开 | `DATABASE_URL` 用了 Windows 裸盘符 | 改成 `file:<绝对路径>` |
| 两个检出改同一镜头后互相覆盖 | 缺少编辑锁（P2 未落地） | 暂按集 / 镜头分工，避免同时编辑同一对象 |

## 5. 明确不支持

- 登录、成员 / 角色、产物按用户鉴权
- 多个主控同时执行（需要实例级分片与 DB 租约，见 P3 设计单）
- 跨机器 / 云端的协作（本机可信拓扑）

设计口径见 `docs/superpowers/specs/2026-11-27-multi-checkout-series-collaboration.md`。
