/**
 * `film-log.ts` —— 成片行日志的唯一写入口（ISSUE #1257 下沉出来的那一格）。
 *
 * 为什么单独一份：编排侧（`orchestrator.ts`：建片 / 逐镜提交 / 监看）与合成侧
 * （`compose-film.ts`）都要往 `filmProject.logs` 上追加行。它留在任何一侧，另一侧
 * 就得反向 import 过来 —— 而「编排引合成、合成引编排」正是 `check-circular-deps`
 * 拦的那条环（本刀要避开的就是它，判据看 AST 上的 import，`import type` 也不算安全）。
 */
import "server-only";

import { filmRepository } from "~/lib/core/repository";

/** 追加一行成片日志（整包覆盖式落库由仓储那边负责，这里只管一行）。 */
export async function appendFilmLog(
  id: string,
  level: "info" | "progress" | "warn" | "error" | "success",
  msg: string,
) {
  await filmRepository.appendLog(id, { t: Date.now(), level, msg });
}
