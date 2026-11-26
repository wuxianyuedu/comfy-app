import { upperToken } from "~/lib/upper-token";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, authedProcedure, rateLimitedProcedure } from "~/server/api/trpc";
import { taskRepository, workflowModelTagRepository } from "~/lib/core/repository";
import { logger } from "~/lib/core/logger";
import { errorMessage, errorText } from "~/lib/error-message";
import { asRecord } from "~/lib/is-record";
import { taskDirFromLocalPath } from "~/lib/media/output-paths";
import { cancelTask as cancelExecutorTask } from "~/lib/comfyui/enqueue";
import { isVideo, kindOf } from "~/lib/media/media-kind";

/* 扩展名判据已收敛到 `media-kind.ts`（ISSUE #571）。此前这里自带一份清单，
 * 且与 `lib/media.ts` 的注释**直接矛盾**——那边明确写「gif 不是视频，`<video>`
 * 解不了 GIF 会黑屏」，这边却把 gif 判成视频。 */
function inferMediaType(
  coverPath: string | null,
  coverMediaType: string | null,
  taskType: string,
): "image" | "video" | "audio" {
  /* 文件事实（扩展名）优先于元数据（mediaType），元数据优先于任务类型推断：
   * 越靠前的来源越接近「磁盘上到底是什么」。 */
  const byName = kindOf(coverPath);
  if (byName === "video" || byName === "audio") {
    return byName;
  }
  if (coverMediaType === "video") {
    return "video";
  }
  if (coverMediaType === "audio") {
    return "audio";
  }
  if (coverMediaType === "image") {
    return "image";
  }
  // `2VA$`：音视频档（T2VA / FLF2VA / R2VA，ISSUE #4999）——产物是含音频轨的视频。
  if (/video|2V$|2VA$|^T2V|^I2V|FLF/i.test(taskType)) {
    return "video";
  }
  if (/audio|tts|voice/i.test(taskType)) {
    return "audio";
  }
  return "image";
}

export const taskRouter = createTRPCRouter({
  /* GET /api/tasks —— 读：list tasks */
  list: authedProcedure
    .input(
      z
        .object({
          take: z.number().int().min(1).max(200).optional().default(60),
          /* 真分页（#4044）：cursor 由 tRPC 的无限查询自动带入（= 已拉取的行数，
           * 即仓储层的 skip）；响应带 hasMore / scanned，media 过滤的截断对
           * 调用方可见。 */
          cursor: z.number().int().min(0).optional().default(0),
          projectId: z.string().optional(),
          media: z.enum(["image", "video", "audio"]).optional(),
          status: z.string().optional(),
          /** 计数口径（#5076）：与行过滤解耦。历史页按状态筛选时行只取该状态，
           *  角标仍需各档全量 —— 传终态全集；不传则与 `status` 同口径（既有调用方不变）。 */
          countStatus: z.string().optional(),
        })
        .default({ take: 60, cursor: 0 }),
    )
    .query(async ({ ctx, input }) => {
      const statusList =
        input.status !== undefined && input.status !== ""
          ? input.status
              .split(",")
              .map((status) => upperToken(status))
              .filter(Boolean)
          : undefined;

      const countStatusList =
        input.countStatus !== undefined && input.countStatus !== ""
          ? input.countStatus
              .split(",")
              .map((status) => upperToken(status))
              .filter(Boolean)
          : statusList;

      const PAGE = input.take;
      /* media 过滤的判据（`inferMediaType`）依赖首图扩展名等应用层解析，
       * 纯 SQL 复刻不了，内存过滤保留；但把原先「固定 ×4（最多 400 行，
       * 含大 JSON 关联）」改成**迭代补页**——大多数请求第 1 页就凑满，
       * 不再无条件把 400 行拉回来。扫描行数上限与旧版对齐（400）。 */
      const MAX_ROUNDS = Math.ceil(400 / PAGE);

      const scanOnce = async (skip: number, take: number) => {
        const tasks = await taskRepository.listByUser(ctx.user.id, {
          projectId: input.projectId ?? undefined,
          take,
          skip,
          statusList: statusList ?? undefined,
          includeImages: true,
        });
        /* 模型名称（ISSUE #4619）：任务行不存模型，工作流上挂的模型标签才是
         * 权威来源。按本页任务引用的模板 id 批量取「模板 → 标签名」映射，
         * 一页一次查询；没挂标签 / 模板引用缺失的行如实给 null，前端回落。 */
        const templateIds = [
          ...new Set(
            tasks
              .map((t) => asRecord(t.params)?.workflow)
              .filter((id): id is string => typeof id === "string" && id !== ""),
          ),
        ];
        const tagRows = await workflowModelTagRepository.getTemplateTagRows(templateIds);
        const modelNameByTemplate = new Map(tagRows.map((row) => [row.templateId, row.name]));
        return tasks.map((task) => {
          const p = asRecord(task.params) ?? {};
          const checkpoint = typeof p.checkpoint === "string" ? p.checkpoint : null;
          const templateId = typeof p.workflow === "string" ? p.workflow : null;
          const cover = task.images[0]?.localPath ?? null;
          const coverMediaType = task.images[0]?.mediaType ?? null;
          /* 视频落点只有服务端答得了：封面（`images[0]`）通常是预览图，成片不在首位（执行侧
           * 「先 images 后 videos」）。判据按磁盘事实：扩展名（`isVideo`）**或**产物子表 `mediaType`
           * —— 后者管住「落盘名不带视频扩展名、但记了是视频」那档，只看扩展名会漏成 `null`。 */
          const videoPath =
            task.images.find((image) => isVideo(image.localPath) || image.mediaType === "video")
              ?.localPath ?? null;
          return {
            id: task.id,
            type: task.type,
            workflowName: task.workflowName,
            modelName: templateId === null ? null : (modelNameByTemplate.get(templateId) ?? null),
            status: task.status,
            prompt: task.prompt,
            createdAt: task.createdAt,
            /* 最近活动时刻（#5076）：终态任务的 finishedAt 才是「刚跑完」的时间，
             * 只有提交时刻会停在几小时前。claimedAt 供老行 / 中断行回落。 */
            finishedAt: task.finishedAt ?? null,
            claimedAt: task.claimedAt ?? null,
            cover,
            checkpoint,
            mediaType: inferMediaType(cover, coverMediaType, task.type),
            videoPath,
            projectId: task.projectId ?? null,
            progress: task.progress,
            error: task.error ?? null,
          };
        });
      };

      /* hasMore 的语义（#4044）：「这一页之外还可能有更多」——只要扫描没有
       * 触到表尾（exhausted）就为 true；精确与否由调用方的下一页兜底
       * （下一页拉回 0 行时 hasMore 自然变 false）。 */
      /* 总数与各状态计数（历史页「已加载 X / 总数 Y」与状态筛选枚上的真实
       * 计数）：与列表同一套过滤（状态 / 项目），只数行数不拉行。media 过滤
       * 是内存判据，不进这个 SQL 计数——带 media 筛选时前端的总数显示退回
       * 「已加载」口径。 */
      const countFilter = { projectId: input.projectId, statusList: countStatusList };
      /* 今日零点按本机时区算，与队列页卡片此前用 `createdAt.toDateString()` 的
       * 「今天」同一口径。按状态分组的服务端计数不受 take 截断影响。 */
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      const [total, statusCounts, todayCounts] = await Promise.all([
        taskRepository.countByUser(ctx.user.id, countFilter),
        taskRepository.countByStatusByUser(ctx.user.id, countFilter),
        taskRepository.countByStatusByUser(ctx.user.id, countFilter, todayStart),
      ]);
      if (!input.media) {
        /* 多取一行判 hasMore（#4594）：请求 PAGE+1 行，返回行数超过 PAGE = 还有下一页。
         * 此前 scanOnce 只取 PAGE 行，`rows.length > PAGE` 恒假 ⇒ hasMore 恒 false，
         * 历史列表在第一页之后永远翻不下去。 */
        const rows = await scanOnce(input.cursor, PAGE + 1);
        const hasMore = rows.length > PAGE;
        /* nextScanCursor（#4741）：本次的**扫描前沿**，供客户端原样透传 ——
         * cursor 的语义是「全量行的 skip」，不是「过滤后已命中数」。 */
        return {
          tasks: rows.slice(0, PAGE),
          hasMore,
          scanned: rows.length,
          nextScanCursor: input.cursor + Math.min(rows.length, PAGE),
          total,
          statusCounts,
          todayCounts,
        };
      }

      type Card = Awaited<ReturnType<typeof scanOnce>>[number];
      const matched: Array<Card> = [];
      let scanned = 0;
      let exhausted = false;
      for (let round = 0; round < MAX_ROUNDS; round += 1) {
        // oxlint-disable-next-line no-await-in-loop -- 顺序依赖：后一步要用前一步的结果（既有串行路径）
        const page = await scanOnce(input.cursor + round * PAGE, PAGE);
        scanned += page.length;
        if (page.length < PAGE) {
          exhausted = true;
        }
        for (const card of page) {
          if (card.mediaType === input.media) {
            matched.push(card);
          }
          if (matched.length >= PAGE) {
            break;
          }
        }
        if (matched.length >= PAGE || exhausted) {
          break;
        }
      }
      /* nextScanCursor（#4741）：扫描前沿 = 起点加上本次实际扫过的行数。
       * media 过滤时它与「命中数」是两回事 —— 客户端按命中数推进会让下一页
       * 从已扫过的位置重扫（重复返回已见行、读放大），按前沿推进才不重不漏。 */
      return {
        tasks: matched,
        hasMore: !exhausted,
        scanned,
        nextScanCursor: input.cursor + scanned,
        total,
        statusCounts,
        todayCounts,
      };
    }),

  /* GET /api/tasks/[id] —— 读 */
  detail: authedProcedure.input(z.object({ id: z.string() })).query(async ({ ctx, input }) => {
    const task = await taskRepository.findByIdWithImages(input.id);
    if (task?.userId !== ctx.user.id) {
      throw new TRPCError({ code: "NOT_FOUND", message: "任务不存在" });
    }
    /* 模型名（ISSUE #4855，与 list 同一口径）：任务行不存模型，工作流上挂的
     * 模型标签才是权威来源 —— 详情弹窗头部要与历史列表卡显示同一个名字。
     * 没挂标签 / 模板引用缺失时如实给 null，前端回落工作流名。 */
    const workflowId = asRecord(task.params)?.workflow;
    const templateId = typeof workflowId === "string" && workflowId !== "" ? workflowId : null;
    const tagRows =
      templateId === null ? [] : await workflowModelTagRepository.getTemplateTagRows([templateId]);
    const modelNameByTemplate = new Map(tagRows.map((row) => [row.templateId, row.name]));
    return {
      ...task,
      modelName: templateId === null ? null : (modelNameByTemplate.get(templateId) ?? null),
    };
  }),

  /* POST /api/tasks/[id]/cancel —— 新建 */
  cancel: authedProcedure.input(z.object({ id: z.string() })).mutation(async ({ ctx, input }) => {
    // 越权修复:与 detail/openFolder/delete 一致,cancel 必须校验
    // 任务归属——此前任意登录用户可用任意 taskId 取消他人任务。
    const task = await taskRepository.findByIdWithImages(input.id);
    if (task?.userId !== ctx.user.id) {
      throw new TRPCError({ code: "NOT_FOUND", message: "任务不存在" });
    }
    /* 取消统一出口（P3 §5 ADR §14 D2）：走执行侧 `cancelTask` 而非只把行写成 CANCELLED ——
     * ① 执行日志落「用户取消任务」；② 正占 ComfyUI 执行位时请求中断，不再「按了还继续出图」；
     * ③ 归还本进程并发槽并清理记账。host 归属下同样有效，在飞子进程 kill 仍由 host 的 tick
     * 负责（`executor-host.mjs` 的 reconcileCancelled）。 */
    await cancelExecutorTask(input.id);
    return { ok: true };
  }),

  /**
   * 取消当前用户全部未结束任务（ISSUE #5064）：候选由仓储层按归属 + 终态过滤，
   * 逐个走与单条取消同一个执行层出口 `cancelExecutorTask` —— 在飞的会中断 comfy-cli、
   * 归还槽位，排队的行只翻状态，不会出现「按了取消还在出图」。
   *
   * 部分失败语义（规范 05「批量必答部分成功」）：单条失败不中断其余（每条自己记
   * warn 日志），返回 `failed` 让 UI 如实报「取消了几条、几条没取消掉」—— 近千条
   * 队列里一条脏行不该让剩下九百九十九条继续跑。重复点幂等：第二轮的候选里已经
   * 没有上一轮取消掉的行。
   */
  cancelAll: authedProcedure.mutation(async ({ ctx }) => {
    const ids = await taskRepository.listActiveIdsForUser(ctx.user.id);
    let cancelled = 0;
    let failed = 0;
    for (const id of ids) {
      try {
        // oxlint-disable-next-line no-await-in-loop -- 顺序依赖：每条各自收口，串行避免与派发循环抢同一个槽
        await cancelExecutorTask(id);
        cancelled += 1;
      } catch (error) {
        failed += 1;
        /* 错因文案走 errorText（P42）：动作前缀与详情由同一个出口拼，不在这里手拼。 */
        logger.warn(`[task.cancelAll] ${errorText(error, `取消 ${id} 失败`)}`);
      }
    }
    return { cancelled, failed, total: ids.length };
  }),

  /**
   * 把一条排队任务提前到队首：只认归属用户 + QUEUED，不叠 owner（host 片的行
   * 也要能排）。单条条件 UPDATE 与领取语句在 SQLite 上原子互斥，行若在请求
   * 期间已被领走则影响 0 行 —— 如实回 ok:false + 人话原因，不假装调整成功。
   * 运行中 / 终态一律不动。
   */
  reorder: authedProcedure.input(z.object({ id: z.string() })).mutation(async ({ ctx, input }) => {
    const outcome = await taskRepository.reorderQueuedToFrontForUser(ctx.user.id, input.id);
    if (outcome === "moved") {
      return { ok: true, detail: "已提前到队首，下一轮就轮到它" };
    }
    if (outcome === "already-first") {
      return { ok: true, detail: "这条已经在队首了" };
    }
    logger.warn(
      `[task.reorder] 未能调整顺序（已开跑 / 不属于当前用户 / 不存在）：taskId=${input.id}`,
    );
    return { ok: false, detail: "这条已开跑或已结束，无法调整顺序" };
  }),

  /** 打开产物目录：返回 comfyapp:// 深链（协议未注册时的引导见 openTaskFolder）。 */
  openFolder: authedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      // 返回该任务的产物目录路径
      const task = await taskRepository.findByIdWithImages(input.id);
      if (task?.userId !== ctx.user.id) {
        throw new TRPCError({ code: "NOT_FOUND", message: "任务不存在" });
      }
      const fsPromises = await import("node:fs/promises");
      /* 目录从库里这条任务的 `localPath` 反推（`taskDirFromLocalPath`）：它正是
       * 写侧当时落盘的形状，三级分类或迁移前的旧平铺都认得，不必在打开侧再
       * 拼一遍布局。解析不出 / 越界返回 null → 这里按越界处置。 */
      const dir = taskDirFromLocalPath(task.images[0]?.localPath);
      if (dir === null) {
        logger.warn(
          `[task.openFolder] 产物目录越界，已拒绝：taskId=${input.id} projectId=${task.projectId}`,
        );
        throw new TRPCError({ code: "FORBIDDEN", message: "forbidden" });
      }
      let exists;
      try {
        const st = await fsPromises.stat(dir);
        exists = st.isDirectory();
      } catch {
        exists = false;
      }
      if (!exists) {
        /* 未打开的原因放 `reason`（#4048）：`error` 是全库约定的失败文案键，
         * 成功（200）载荷不该挂它；文案直接给中文，不再走英文短码。 */
        return { opened: false, reason: "该任务尚未生成文件目录", absolutePath: dir };
      }
      return {
        opened: true,
        absolutePath: dir,
        comfyappUrl: `comfyapp://open?path=${encodeURIComponent(dir)}`,
      };
    }),

  /* GET /api/tasks/[id]/workflow —— 读：returns the workflow snapshot */
  workflow: authedProcedure.input(z.object({ id: z.string() })).query(async ({ ctx, input }) => {
    const owner = await taskRepository.findByIdWithImages(input.id);
    if (owner?.userId !== ctx.user.id) {
      throw new TRPCError({ code: "NOT_FOUND", message: "任务不存在" });
    }
    const task = await taskRepository.findSnapshotById(input.id);
    if (!task) {
      throw new TRPCError({ code: "NOT_FOUND", message: "任务不存在" });
    }
    /* 快照列是外来 JSON：只判「是对象」这一层，字符串字段带 typeof 收口
     * （损坏行按缺省回落，不再把垃圾值原样透传）。 */
    const snap = asRecord(task.workflowSnapshot);
    return {
      workflow: snap?.workflow ?? null,
      source: typeof snap?.source === "string" ? snap.source : null,
      capturedAt: typeof snap?.capturedAt === "string" ? snap.capturedAt : null,
    };
  }),

  /* DELETE /api/tasks/[id] —— 删除：delete task + its generated files on disk */
  delete: rateLimitedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const task = await taskRepository.findByIdWithImages(input.id);
      if (task?.userId !== ctx.user.id) {
        throw new TRPCError({ code: "NOT_FOUND", message: "任务不存在" });
      }
      const fsPromises = await import("node:fs/promises");
      /* 产物目录从库里的 `localPath` 反推，与落盘侧同源（旧写法两处各拼一遍，
       * 一条漏掉项目子层、一条把 `/api/generated` 解析成 `public/api/generated`，
       * 都被 `.catch(() => undefined)` 吞掉 → 磁盘只涨不删、日志空白）。解析不出
       * 或越界时只删库行并记原因，不把根外路径交给 rm。 */
      const dir = taskDirFromLocalPath(task.images[0]?.localPath);
      /* 先删库行、后清磁盘（ISSUE #3872）：原先先 rm（fire-and-forget）再删行，
       * 一旦删行失败，行还指向已不存在的目录（封面/视频 404 且不可恢复）。
       * 先删行则失败即止、文件保留；行删掉之后磁盘清理失败最多留孤儿文件，可再清。 */
      await taskRepository.delete(input.id);
      if (dir === null) {
        logger.warn(
          `[task.delete] 产物目录越界，只删库行不动磁盘：taskId=${input.id} projectId=${task.projectId}`,
        );
      } else {
        fsPromises.rm(dir, { recursive: true, force: true }).catch((error: unknown) => {
          logger.warn(
            `[task.delete] 产物目录没删掉（库行已删）：${dir} — ${errorMessage(error, String(error))}`,
          );
        });
      }
      return { ok: true };
    }),
});
