/**
 * 项目删除的**级联收口**（ISSUE #4737）。
 *
 * 此前 `project.delete` 只删 project 一行：production（全部镜头 / 角色 / 评审）、
 * 工坊会话、成片、任务行与 `generated/projects/<projectId>/**` 磁盘产物全部留存
 * 成孤儿，磁盘单调增长且没有任何清理路径。归属语义（本模块是唯一出处）：
 *
 * - **随删**：task（生成记录；taskImage / taskLog 显式同删，不依赖 FK pragma）、
 *   filmProject（从项目建的成片；filmShot 显式同删）、workshopSession（绑定项目
 *   的会话，内容是 production 的写时镜像）、production（id 即 proj_*，项目的
 *   内容面），以及磁盘上的 `generated/projects/<projectId>/` 与各成片
 *   `films/<filmId>.mp4`。判据一句话：**删项目 = 删掉它在库与盘上的全部痕迹**，
 *   历史 / 成片面板不再出现指向已删项目的孤儿行。
 * - **顺序**：先库（单事务，归属校验在先——他人 / 不存在的项目一行不动），
 *   后盘（尽力而为，失败只 warn 不回滚——盘上孤儿可再清，库行没了才不可恢复）。
 */
import "server-only";

import { rm as fsRm } from "node:fs/promises";
import path from "node:path";
import { and, eq, inArray } from "drizzle-orm";

import { db } from "~/lib/db";
import { logger } from "~/lib/core/logger";
import { errorMessage } from "~/lib/error-message";
import {
  PROJECTS_SUBDIR,
  filmsRoot,
  generatedRoot,
  isWithinGeneratedRoot,
} from "~/lib/media/output-paths";
import {
  filmProject,
  filmShot,
  production,
  project,
  task,
  taskImage,
  taskLog,
  workshopSession,
} from "~/server/db/schema";

/** 删除项目及其全部附属行与磁盘产物；项目不存在 / 不归属该用户时返回 false
 *  （一行不动）。磁盘清理失败不抛——记 warn 后继续（与 task.delete 同口径）。 */
export async function deleteProjectCascade(userId: string, projectId: string): Promise<boolean> {
  const filmIds: Array<string> = [];
  const deleted = await db.transaction(async (tx) => {
    /* 归属闸：id + userId 双条件，命中 0 行 = 他人项目或不存在，什么都不动。 */
    const rows = await tx
      .delete(project)
      .where(and(eq(project.id, projectId), eq(project.userId, userId)))
      .returning({ id: project.id });
    if (rows.length === 0) {
      return false;
    }
    const taskRows = await tx
      .select({ id: task.id })
      .from(task)
      .where(eq(task.projectId, projectId));
    const taskIds = taskRows.map((row) => row.id);
    if (taskIds.length > 0) {
      /* 子表显式删：测试库 foreign_keys=OFF，且不依赖「生产 pragma 一定开着」。 */
      await tx.delete(taskImage).where(inArray(taskImage.taskId, taskIds));
      await tx.delete(taskLog).where(inArray(taskLog.taskId, taskIds));
      await tx.delete(task).where(inArray(task.id, taskIds));
    }
    const filmRows = await tx
      .select({ id: filmProject.id })
      .from(filmProject)
      .where(eq(filmProject.projectId, projectId));
    for (const row of filmRows) {
      filmIds.push(row.id);
    }
    if (filmIds.length > 0) {
      await tx.delete(filmShot).where(inArray(filmShot.filmId, filmIds));
      await tx.delete(filmProject).where(inArray(filmProject.id, filmIds));
    }
    await tx.delete(workshopSession).where(eq(workshopSession.projectId, projectId));
    await tx.delete(production).where(eq(production.id, projectId));
    return true;
  });
  if (!deleted) {
    return false;
  }

  /* 磁盘收口（尽力而为）：项目产物整目录 + 各成片文件。projectId 由客户端生成、
   * 可能是坏形状 —— 解析结果不在产物根内就跳过（与 taskOutputDir 的越界口径一致）。 */
  const projectDir = path.resolve(generatedRoot(), PROJECTS_SUBDIR, projectId);
  if (isWithinGeneratedRoot(projectDir)) {
    await fsRm(projectDir, { recursive: true, force: true }).catch((error: unknown) => {
      logger.warn(
        `[project.delete] 项目产物目录没删掉（库行已删）：${projectDir} — ${errorMessage(error, String(error))}`,
      );
    });
  }
  await Promise.all(
    filmIds.map((filmId) => {
      const filmFile = path.join(filmsRoot(), `${filmId}.mp4`);
      return fsRm(filmFile, { force: true }).catch((error: unknown) => {
        logger.warn(
          `[project.delete] 成片文件没删掉（库行已删）：${filmFile} — ${errorMessage(error, String(error))}`,
        );
      });
    }),
  );
  return true;
}
