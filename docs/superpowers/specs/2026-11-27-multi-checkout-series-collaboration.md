# 多检出共同制作动漫剧集：拓扑与口径（ISSUE #5206）

> 本文只定「怎么部署、共享什么、不做什么」，不含实现细节。
> 实现分期见文末；代码落点只作可读性索引，不写死端口 / 具体路径数字。

## 1. 背景与判据

用户口径：**本机操作、不开登录**，但会同时启动多个检出，且这些检出要共同完成一部动漫剧集。

现状核对（2026-11-27）：

- 仓库已支持**不同检出各自启动**：端口按检出绝对路径稳定推导（`scripts/app-port.mjs`）、壳单实例按检出隔离（`src-tauri/src/single_instance.rs`）、端口回收只动自己（`scripts/launcher-core/port-reap.mjs`）、编排器会话锚点 `wx` 占坑（`scripts/dev-launcher-session.mjs`）。
- 各检出默认各自一份 `db.sqlite` 与各自的 `generated/` 产物根，因此**无法共同制作同一部剧**。
- DB 层已有 per-user 列与 `where userId` 过滤，但那解决的是「不同人」，本场景不需要——同一台机器、同一使用者。

## 2. 决定的拓扑

**一个主控 + 多个 UI-only 检出**：

| 角色 | 进程 | 职责 |
| --- | --- | --- |
| 主控（唯一） | UI + executor-host + ComfyUI | 领取任务、执行生图 / 成片、监看、合成 |
| UI-only（可多个） | 仅 Next UI | 看板、编辑剧集 / 镜头、评审结果、查看产物 |

关键决定：

1. **不开登录**：所有检出沿用同一演示用户；不引入成员表、角色、产物按用户鉴权、`userId` 隔离改造。本机可信，这些都是负担。
2. **主控唯一**：执行分片只有 `inline` / `host` 两片（`src/lib/core/repository-task-impl.ts`），且 reaper 以「本进程没有在飞账 ⇒ 真孤儿」判死，前提是同一分片只有一个宿主（`docs/guide-executor-host.md`）。多主控需实例级分片 + DB 租约，列入 P3，当前不做。
3. **暂停保持全局**：`generationControl` 是 DB 单例行，共享库下「一处暂停、处处暂停」符合直觉。
4. **剧集按集 / 镜头分工**，不按检出划分数据所有权——数据只有一份。

## 3. 共享范围

**必须共享**（全部落在同一份 DB）：

- 剧集域：`series` / `season` / `episode` / `character` / `episode_character` / `seriesAsset` / `episode_asset`（`src/server/db/schema-series.ts`；跨集资产库与视觉圣经也在这份 DB 里，ISSUE #5283）
- 生产域：`project` / `production`（脚本、角色、分镜、进度、run）
- 执行域：`task` / `taskImage` / `taskLog`、`filmProject` / `filmShot`
- 沉淀域：`asset`、`workflowTemplate`
- 控制域：`generationControl`

**不共享（本机事实）**：

- ComfyUI 实例地址 / comfy-cli 解释器（`data/app-settings.json`）
- 日志、运行期临时文件
- 浏览器偏好（`localStorage` / `sessionStorage` / 页签状态，按端口即按源隔离）

产物文件也必须共享：DB 里 `taskImage.localPath` 存的是 `/api/generated/...` URL，各检出若各自取 `generatedRoot()`（按进程 cwd）会出现「看得到任务、看不到图」。覆盖出口为 `COMFYAPP_GENERATED_ROOT`（`src/lib/media/output-paths.ts`），Windows 侧 `scripts/devtools/comfyapp-open-folder.ps1` 同步。

## 4. 必需配置（操作口径）

| 项 | 主控 | UI-only | 说明 |
| --- | --- | --- | --- |
| `DATABASE_URL` | 同一个绝对 `file:` 路径 | 同左 | Windows 不能裸盘符，会被 libsql 当 scheme |
| `COMFY_EXECUTOR` | `host` | `host` | 任务写 host 归属，UI 进程不自己执行 |
| `COMFYAPP_SKIP_EXECUTOR_HOST` | 不设 | `1` | **必须是进程环境变量**，写 `.env` 无效 |
| `COMFYAPP_HOST_HEARTBEAT` | 同一个绝对路径 | 同左 | 否则 reaper 按各自 cwd 找不到心跳，会误判在飞任务为孤儿 |
| `COMFYAPP_GENERATED_ROOT` | 同一个绝对路径 | 同左 | 产物根；URL 前缀不变，历史行照常读 |
| 应用端口 | 各检出按推导链独立 | 同左 | 不同端口即不同浏览器源，偏好互不污染 |

## 5. 明确不做

- 登录、账号体系、成员 / 角色、邀请与权限判定
- 产物按用户鉴权（`/api/generated` 维持现状）
- `userId` 隔离改造
- 多主控（P3 之前）

## 6. 风险登记

1. **schema 同步无跨检出协调**：`COMFYAPP_SKIP_SCHEMA_SYNC` 目前只被部分入口读取；多检出同时从零启动会并发写同一库。口径：先在唯一主控同步 schema，其余检出不要同时做从零启动 / `db:push`。
2. **心跳隔离**：reaper 按 owner 分片，心跳路径必须共享（见第 4 节）。
3. **产物根分叉**：只改 DB 不改产物根必然 404。
4. **桌包入口未认 SKIP**：`scripts/standalone-runtime.mjs` 曾直接拉宿主，UI-only 桌包会多起一个（P1 修复）。
5. **多主控**：见 P3，当前不支持。

## 7. 分期

| 阶段 | 内容 | Issue |
| --- | --- | --- |
| P0 | 本文与产品口径（不写实现） | #5206 |
| P1 | 产物根 env 覆盖 + ps1 同步、桌包 SKIP 接线、操作指南与启动校验 | #5207 |
| P2 | 按集 / 镜头乐观并发（用 `production.updatedAt` 做 CAS——表上**没有** rev 列，镜头 rev 只是 shots JSON 里的派生标记）、变更活动流（`auditLog`）、结果评审状态 | #5208 |
| P3 | 多主控：实例级分片、DB 租约、任务路由与中断收敛（仅在有多 GPU / 多机器时启动） | #5209 |
