import "server-only";

// ── 风格试验的矩阵扇出（服务端唯一实现）───────────────────────────────
//
// 这一屏的「跑一批」= 把一次试验展开成一串任务、按格依次**入队**。物理事实是本机
// 执行链 `MAX_CONCURRENCY = 1`（`~/lib/comfyui/runner-state.ts`）：所谓一批其实是
// 串行排队，一次交互点下去可能挂几十格在队列前。因此这里承担的不仅是循环，还有
// 三条必须集中在一处的判断：
//   ① 预算闸 —— 超过硬上限就整批拒绝（拆成几次才是那批格子应有的形状）；
//   ② 判重 —— 已经有 `taskId` 的格子不再重复入队（重跑只补没跑过的座位）；
//   ③ 节拍 —— 整批只 `kickQueue()` 一次，逐格敲不会更正确，只会把派发器敲 N 遍。
//
// 三条都住在这一处而不是路由里，是因为它们必须与纯算式（`~/lib/style-lab/style-lab-matrix`）
// 吃同一份判据：界面预览报「K 格」、服务端展开成 M 格，用户就会看到「说好的 12 格只
// 出了 9 张」这类对不上的账。
//
// **入队本身不在这里重写**：逐格走 `createWorkflowRunTask`（工作流库执行的服务端唯一
// 入口，含契约口 → 端口的封装）。它内部 `createQueued` 写库那一行，本模块只负责
// 「按格算出该提交什么」与「把结果记回格子」。
import { TRPCError } from "@trpc/server";

import { styleLabRepository, taskRepository } from "~/lib/core/repository";
import { kickQueue } from "~/lib/comfyui/executor-continuation";
import { cancelTask as cancelExecutorTask } from "~/lib/comfyui/enqueue";
import { isActiveTaskStatus } from "~/lib/task-state";
import {
  MATRIX_HARD_LIMIT,
  batchBaseSeed,
  cellMatchKey,
  cellTaskSeed,
  planStyleLabSeats,
} from "~/lib/style-lab/style-lab-matrix";
import { createWorkflowRunTask } from "~/lib/workshop/workflow-run.server";
import type {
  StyleLabBatchOutcome,
  StyleLabTraits,
} from "~/lib/style-lab/style-lab-types";
import type { StyleExperimentRow } from "~/server/db/schema";

/** 试验行里 JSON 列的窄化（库里是 `text(mode:"json")`，Drizzle 读回来是已解析的值）。 */
function asStyles(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((v): v is string => typeof v === "string")
    : [];
}
function asTraits(value: unknown): StyleLabTraits {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: StyleLabTraits = {};
  for (const [axisId, values] of Object.entries(value as Record<string, unknown>)) {
    out[axisId] = Array.isArray(values)
      ? values.filter((v): v is string => typeof v === "string")
      : [];
  }
  return out;
}
function asParams(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/**
 * 跑一批：展开座位 → 补登记缺的格子 → 逐格入队（跳过已绑任务的）→ 整批敲一次节拍。
 *
 * 失败语义（硬规则 4：失败路径要有用户可见出口）：**逐格入队中途出错就停**，已经
 * 入队的那些照常敲一次节拍（它们是真的在排队了，不能因为后面失败就把它们晾在库里
 * 等 2s 节拍），并把错误原样抛出 —— 界面上看到的是「跑到第 N 格失败：……」，
 * 而不是一个静默的半批。
 */
export async function runStyleLabBatch(args: {
  userId: string;
  experiment: StyleExperimentRow;
}): Promise<StyleLabBatchOutcome> {
  const { userId, experiment } = args;
  const params = asParams(experiment.params);
  const seats = planStyleLabSeats({
    experimentId: experiment.id,
    styles: asStyles(experiment.styles),
    traits: asTraits(experiment.traits),
    params,
  });

  /* 预算闸在**任何写入之前**：一批发出去就是几十次串行出图，落到队列里之后
     再劝退已经来不及了。软上限不在这里判 —— 它只是提示，用户想等就让他等。 */
  if (seats.length > MATRIX_HARD_LIMIT) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `一次最多跑 ${String(MATRIX_HARD_LIMIT)} 格，这套选择会展开成 ${String(
        seats.length,
      )} 格 —— 请减少风格或特征，或分几次跑`,
    });
  }

  /* 「存定义」与「跑一批」的分工：登记一条什么都没选的形状是合法的草稿（用户可能
     先把工作流与模式记下来），但**真跑**必须有内容 —— 整批 prompt 都是空串时，
     空值会照着作者连好的那个口写进去，出图用的是工作流图内的默认内容，用户在
     矩阵前看到「每张都差不多」而看不出原因（规范 10 §10.3.1：降级不许静默）。 */
  if (seats.every((seat) => seat.prompt.trim() === "")) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "这套选择拼不出任何提示词 —— 至少选一个风格或一组特征，再来跑这批",
    });
  }

  const existing = await styleLabRepository.findCellsByExperiment(
    experiment.id,
  );
  /** 座位键 → 那一格的行本体（`taskId` 为 null 表示这格还没跑过）。 */
  const seatRows = new Map<string, { id: string; taskId: string | null }>(
    existing.map((cell) => [
      cellMatchKey(cell.style, cell.traitKey),
      { id: cell.id, taskId: cell.taskId },
    ]),
  );

  /* 先把缺的座位登记上，再逐格入队：顺序反过来（先入队再落格子）在中途崩掉时会
     留下「任务在跑、格子里没有这一行」的矩阵 —— 用户看到的是少了几格，而实际
     产物已经在库里。格子行带着 `taskId: null` 落库则是一个如实的「这一格还没跑」。 */
  const missing = seats.filter((seat) => !seatRows.has(seat.seatKey));
  const inserted = await styleLabRepository.insertCells(
    missing.map((seat) => ({
      experimentId: experiment.id,
      style: seat.style,
      traitKey: seat.traitKey,
      prompt: seat.prompt,
      isRepresentative: seat.isRepresentative,
      taskId: null,
    })),
  );
  for (const row of inserted) {
    seatRows.set(cellMatchKey(row.style, row.traitKey), {
      id: row.id,
      taskId: row.taskId,
    });
  }

  /* 基准 seed 每批只定一次（在格内现算就把「共用基准」变成「每格各随机」）。 */
  const baseSeed = batchBaseSeed(params);
  const unmatched = new Set<string>();
  let enqueued = 0;
  let skipped = 0;

  try {
    for (const seat of seats) {
      const row = seatRows.get(seat.seatKey);
      if (!row) {
        /* 上面刚把每一枚座位都登记或读到过，这里拿不到行只可能是库被并发改写。
           如实抛而不是跳过：跳过会让这批静默少出一格，而屏幕上仍写着 K 格。 */
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "格子登记后读不回来，已中止这一批",
        });
      }
      if (row.taskId) {
        skipped += 1;
        continue;
      }
      const { taskId, unmatched: cellUnmatched } = await createWorkflowRunTask({
        userId,
        workflowId: experiment.workflowId,
        /* 用试验存的那个模式，而不是工作流的默认模式：这两个不一致时出图仍会成功，
         * 用户却看不出这批跑的其实不是他选的模式。 */
        mode: experiment.mode,
        values: {
          prompt: seat.prompt,
          seed: cellTaskSeed({ params, baseSeed, index: seat.index }),
        },
        /* 整批敲一次节拍，见文件头第 ③ 条。 */
        kick: false,
      });
      for (const id of cellUnmatched) unmatched.add(id);
      await styleLabRepository.setCellTask(row.id, taskId);
      row.taskId = taskId;
      enqueued += 1;
    }
  } finally {
    /* 半途失败也要把已经入队的那些踢一次：它们在库里是真实存在的排队行。 */
    if (enqueued > 0) kickQueue();
  }

  return {
    enqueued,
    skipped,
    planned: seats.length,
    baseSeed,
    unmatched: [...unmatched],
  };
}

/**
 * 停一批：把这一试验名下**仍在进行中**的格子任务逐条取消。
 *
 * 取消走执行侧那份 `cancelTask`（与 `task.cancel` 同一个出口，P3 §5 ADR §14 D2），
 * 而不是这里自己把状态写成 CANCELLED —— 区别对用户可感三件事：执行日志里有一行
 * 「用户取消任务」、正占着执行位的那条请求真的被中断、并发槽被归还。
 *
 * 归属在这条链上判两次：试验行已由路由按 `userId` 取到，格子引用的任务再按
 * `progress.userId` 核一次 —— 少核那一次时，一个被别的写入者塞进格子里的 taskId
 * 就能借这一屏取消别人的任务。
 */
export async function stopStyleLabBatch(args: {
  userId: string;
  experimentId: string;
}): Promise<{ cancelled: number; alreadyDone: number }> {
  const { userId, experimentId } = args;
  const cells = await styleLabRepository.findCellsByExperiment(experimentId);
  const taskIds = cells
    .map((cell) => cell.taskId)
    .filter((taskId): taskId is string => taskId !== null);
  if (taskIds.length === 0) return { cancelled: 0, alreadyDone: 0 };

  const rows = await taskRepository.findExecutionProgressMany(taskIds);
  let cancelled = 0;
  let alreadyDone = 0;
  for (const row of rows) {
    if (row.userId !== userId) continue;
    if (!isActiveTaskStatus(row.status)) {
      alreadyDone += 1;
      continue;
    }
    await cancelExecutorTask(row.id);
    cancelled += 1;
  }
  return { cancelled, alreadyDone };
}
