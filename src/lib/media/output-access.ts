/* 「这条产物能不能确定是属于别人的」—— 产物读取口（`/api/generated/[...path]`）
 * 的归属判据，与 `~/lib/media/output-paths`（布局）配成一对：那份管路径长什么样，
 * 这份管谁能读。
 *
 * 为什么需要它（台账 A13）：这个端点此前只有「解析后仍在 `public/generated` 之内」
 * 一条路径判据（那条有判据，#1260 补的），**既不认会话也不认归属** —— 而落点命名里
 * 就写着主人的身份：`projects/<项目 id>/<任务 id>/…`、`materials/<项目 id>/…`、
 * `<任务 id>/…`、`films/<成片 id>.mp4`。于是任何能访问这个端口的一方，都可以按路径
 * 直接把别人的出图、素材和成片拖走；素材列表那一层即便收紧了（A12），猜路径读仍然敞开。
 *
 * 判据只回答它**真知道**的事：返回值是「能确定属于别人」，不是「属于你」——
 * 库里查不到这一行（历史数据、任务已删、单用户模式下的演示 id 漂移）一律不算属于别人，
 * 否则会把自己的图判成 404。真正的默认放行清单写在下面 `UNSCOPED_PREFIXES` 里，
 * 让「还有哪些前缀判不了」是看得见的、而不是被 `return false` 悄悄吸收。
 *
 * 只在 `loginRequired` 打开时启用（理由在调用点与 A13 里）：关掉时每个请求都解析成
 * 同一个演示用户，归属判定在数学上不可能有不同结果，只可能因为历史行的 `userId`
 * 漂移把用户自己的产物打裂。 */
import "server-only";

import { filmRepository } from "~/lib/core/repository-film";
import { taskRepository } from "~/lib/core/repository";
import { materialScopeOwnership } from "~/lib/media/materials";

/** 判不了归属的前缀 —— 不是「暂时没写」，是**这一类本来就没有主人**：
 *  `films/bgm` 是按标签从公开曲库拉下来的背景音乐，与用户身份无关。
 *  新增落点时先问「它属于某个用户吗」；属于却没出现在这里的，就是漏了一条判据。 */
const UNSCOPED_PREFIXES = new Set(["films/bgm"]);

/** 从 `films/<id>.mp4` / `films/_tmp_<id>/…` 里取出成片 id。
 *  两处命名都带 id：收口写 `films/<id>.mp4`，合成前的中间目录写 `films/_tmp_<id>/`；
 *  cuid 里没有点与下划线前缀，所以按「去掉扩展名 + 去掉 `_tmp_`」还原是确定的。 */
function filmIdOf(segment: string): string {
  const bare = segment.replace(/\.[^.]*$/, "");
  return bare.startsWith("_tmp_") ? bare.slice("_tmp_".length) : bare;
}

/** 项目这一族的归属（素材格 `materials/<scope>` 与产物格 `projects/<pid>` 共用）：
 *  直接吃素材库那份三态判据（`~/lib/media/materials` 的 `materialScopeOwnership`），
 *  不在这里写第二份 —— 同一个「这个目录名是谁的」问两遍、两处答案不同，就是 A12
 *  修掉的那类形态。库里没有这一行 = 未登记的新画布，不算别人的。 */
async function isForeignProjectScope(scope: string, userId: string) {
  return (await materialScopeOwnership(userId, scope)) === "foreign";
}

/** 这条产物**能否被确定属于请求者之外的人**（`true` 就不该给读）。
 *  `segments` 是相对于 `public/generated` 的路径片段（已经过 URL 解码）。 */
export async function isForeignOwnedArtifact(
  segments: string[],
  userId: string,
): Promise<boolean> {
  const [first, second] = segments;
  if (!first) return false;

  if (first === "materials") {
    // materials/<scope>/<folder>/<file>：scope 就是项目 id（或 _shared）
    return second ? isForeignProjectScope(second, userId) : false;
  }
  if (first === "projects") {
    // projects/<项目 id>/<任务 id>/…
    return second ? isForeignProjectScope(second, userId) : false;
  }
  if (first === "films") {
    if (!second || UNSCOPED_PREFIXES.has(`films/${second}`)) return false;
    const row = await filmRepository.findById(filmIdOf(second));
    return !!row && row.userId !== userId;
  }
  // 其余落点是 `<任务 id>/…`（executor-finalize 的默认形状）
  const task = await taskRepository.findById(first);
  return !!task && task.userId !== userId;
}
