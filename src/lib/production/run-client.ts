// 统一项目 AI 自主执行 run 的前端读写客户端（Phase 6 · P6-3）。
//
// 薄封装 tRPC `run.*`：status / start / pause / resume / approve / cancel，统一返回归一后的
// `{ run, action }`（run 经 `normalizeProductionRun` 宽容服务端任意 JSON，action 是纯规划器的
// 「下一步动作」）。放 src/lib/<domain>-client 层，视图/hook 不经手 vanillaApi（对齐 §17）。
import { vanillaApi } from "~/trpc/vanilla";
import {
  normalizeProductionRun,
  type ApprovalMode,
  type ProductionRun,
  type RunAction,
} from "~/lib/production/run-types";

export interface RunSnapshot {
  run: ProductionRun;
  action: RunAction;
}

const IDLE_SNAPSHOT: RunSnapshot = {
  run: normalizeProductionRun(null),
  action: { kind: "idle" },
};

/** 归一 tRPC 回包（run/action 已是服务端类型，这里只兜 run 的脏 JSON）。 */
function toSnapshot(res: {
  run: ProductionRun;
  action: RunAction;
}): RunSnapshot {
  return { run: normalizeProductionRun(res.run), action: res.action };
}

/** 读当前 run + 下一步动作；无活跃项目 → idle。 */
export async function fetchRunStatus(projectId: string): Promise<RunSnapshot> {
  if (!projectId) return IDLE_SNAPSHOT;
  const res = await vanillaApi.run.status.query({ projectId });
  return toSnapshot(res);
}

export interface StartRunInput {
  goal?: string;
  approvalMode?: ApprovalMode;
  imageWorkflowId?: string;
  videoWorkflowId?: string;
}

/** 启动 / 重启自主执行（引擎会在服务端 fire-and-forget 推进到下一个停点）。 */
export async function startRun(
  projectId: string,
  input: StartRunInput,
): Promise<RunSnapshot> {
  const res = await vanillaApi.run.start.mutate({ projectId, ...input });
  return toSnapshot(res);
}

export async function pauseRun(projectId: string): Promise<RunSnapshot> {
  const res = await vanillaApi.run.pause.mutate({ projectId });
  return toSnapshot(res);
}

export async function resumeRun(projectId: string): Promise<RunSnapshot> {
  const res = await vanillaApi.run.resume.mutate({ projectId });
  return toSnapshot(res);
}

export async function approveRun(projectId: string): Promise<RunSnapshot> {
  const res = await vanillaApi.run.approve.mutate({ projectId });
  return toSnapshot(res);
}

export async function cancelRun(projectId: string): Promise<RunSnapshot> {
  const res = await vanillaApi.run.cancel.mutate({ projectId });
  return toSnapshot(res);
}
