## Added

- **AI 自主成片的画布 / 工坊操作台（Phase 6 · P6-3）**：run 现在是服务端在跑，画布和工坊都只是它的操纵台。新增中性的 `components/agent-run/`：
  - `run-client.ts`（`src/lib/production/`）：`tRPC run.*` 的薄封装（status/start/pause/resume/approve/cancel），统一返回归一后的 `{ run, action }`；IO 收在 lib 层，视图/hook 不碰 vanillaApi（§17）。
  - `use-agent-run.ts`：读活跃项目、拉一次 run 状态、`running/awaiting_approval` 时按 `useInterval` 轮询；初始取数用 `beginStaleRun` 作废守卫（§16.2.4.34）；暴露 start/pause/resume/approve/cancel 与目标/审批粒度，错误以字符串回给控制条就地展示（不硬绑 toast）。
  - `RunControlBar.tsx`：按 `run.status` 呈现——未启动=目标输入 + 确认粒度选择（每阶段/逐镜/全自动）+ 启动；执行中=下一步提示 + 暂停/取消；等待确认=「确认，继续」/暂停/取消；已暂停=继续/取消；完成/失败/取消=状态 + 重新开始。复用 `Button`/`Badge`/`Textarea` + `textHandler`，无自造原语。
  - 挂到工坊顶栏下方（`WorkshopPipeline`）与画布顶部浮层（`ProjectCanvas`），两处同一份 run 的实时视图（2.5s 轮询），实现「AI 在服务端自主跑，用户在任一视图随时暂停/审批/继续/取消」。

## 说明

per-shot「退回让 AI 重做」（对某镜 bump `rev`）作为下一步 P6-3b；本轮先交付暂停与审批这条主控路径。`advanceRunLoop`（#909）由 start/resume/approve 以 fire-and-forget 拉起。模型/ComfyUI 端到端仍需实机验证。
