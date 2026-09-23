// 画布镜头节点「生成态」回写客户端（Phase 3c-2b）。
//
// 画布上对某镜头节点（data.shotId）触发生图并落定（done/error）后，把生成态
// （status / taskId / 结果 url）回写进对应的 Shot，闭合「画布上跑的镜头工坊认得」这条
// 回路（统一生产模型设计 §6.2 的画布 → 工坊方向）。与 3c-2a 的「挂载物化」互补：
// 2a 做 production → 画布的单向投影，2b 补上生成态的画布 → production 回写。
//
// 落点两处（都因画布 / 工坊互斥挂载，不会互相 clobber）：
//   1) 共享工坊草稿（localStorage，按 active proj_*）+ workshopDraft 表镜像 —— 工坊
//      重挂载即读到，看到画布产出的镜头图；
//   2) production 表镜像（读-改-写，保留 progress 等其它字段）—— 画布重挂载 fetchProduction
//      再物化时不回退成旧态。
//
// 单一写入者（§6.4）：只写生成态字段，编辑面（prompt/negative）仍是工坊写入面，这里不碰。
// 放 src/lib/<domain>-client 层，视图/hook 不经手 fetch（对齐 §17 / 硬规则 10）。
import {
  fetchProduction,
  pushProduction,
} from "~/lib/production/production-client";
import {
  applyShotGeneration,
  applyShotRedo,
  type ShotGenerationPatch,
} from "~/lib/production/sync";
import {
  readWorkshopDraft,
  writeWorkshopDraft,
} from "~/lib/workshop/draft-store";
import { pushServerDraft } from "~/lib/workshop/draft-sync-client";
import { fireAndForget } from "~/lib/async-action";
import type { Shot } from "~/lib/workshop/types";

function asShots(raw: unknown): Shot[] {
  return Array.isArray(raw) ? (raw as Shot[]) : [];
}

/** 把某镜头的生成态补丁回写进该项目（草稿 + 两张服务端镜像）。静默失败、不阻塞画布。 */
export async function recordCanvasShotGeneration(
  projectId: string,
  shotId: string,
  patch: ShotGenerationPatch,
): Promise<void> {
  if (!projectId || !shotId) return;

  // 1) 共享工坊草稿（即时缓存）+ workshopDraft 表镜像。
  const draft = readWorkshopDraft(projectId);
  const nextShots = applyShotGeneration(draft.shots, shotId, patch);
  if (nextShots !== draft.shots) {
    const nextDraft = { ...draft, shots: nextShots };
    writeWorkshopDraft(projectId, nextDraft);
    // pushServerDraft 内部已 catch 静默降级；这里刻意「发完即忘」，用 fireAndForget 显式命名。
    fireAndForget(pushServerDraft(projectId, nextDraft), () => {
      /* 静默：pushServerDraft 自带 catch，失败已由草稿本地缓存兜底 */
    });
  }

  // 2) production 表镜像：读-改-写，只替换命中镜头，保留 progress / 其它镜头字段。
  try {
    const prod = await fetchProduction(projectId);
    if (!prod) return;
    const prodShots = asShots(prod.shots);
    const patched = applyShotGeneration(prodShots, shotId, patch);
    if (patched === prodShots) return;
    await pushProduction(projectId, { ...prod, shots: patched });
  } catch {
    /* 服务不可用时静默降级：草稿已更新，工坊侧下次自动保存会补推 production 镜像 */
  }
}

/** 单镜「退回让 AI 重做」（Phase 6 · P6-3b）：清空该镜产出、状态回 idle、rev 自增，
 *  作为「用户改过」的显式信号 —— run 规划器据此把该镜重新纳入待办。同样落草稿 + production 两处。 */
export async function requestShotRedo(
  projectId: string,
  shotId: string,
): Promise<void> {
  if (!projectId || !shotId) return;

  const draft = readWorkshopDraft(projectId);
  const nextShots = applyShotRedo(draft.shots, shotId);
  if (nextShots !== draft.shots) {
    const nextDraft = { ...draft, shots: nextShots as Shot[] };
    writeWorkshopDraft(projectId, nextDraft);
    fireAndForget(pushServerDraft(projectId, nextDraft), () => {
      /* 静默：pushServerDraft 自带 catch，草稿本地缓存已兜底 */
    });
  }

  try {
    const prod = await fetchProduction(projectId);
    if (!prod) return;
    const prodShots = Array.isArray(prod.shots) ? prod.shots : [];
    const patched = applyShotRedo(prodShots, shotId);
    if (patched === prodShots) return;
    await pushProduction(projectId, { ...prod, shots: patched });
  } catch {
    /* 服务不可用静默：草稿已退回，工坊下次自动保存会补推 production */
  }
}
