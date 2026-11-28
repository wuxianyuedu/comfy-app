/** 合同层的浏览器 / 客户端调用面。
 *
 * 这是 `codeFilm.*` 三个 procedure 的真实消费方（E3′）：P1 的合同编辑器与 Agent
 * 面板都从这里取数，避免各处直接拼 tRPC 路径。P0 只做薄封装，不含业务编排。 */
import { vanillaApi } from "~/trpc/vanilla";
import type { CodeFilmContract } from "./contract-schema";
import type { QaReport } from "./qa-rules";

/** 编译预览：校验 + 补默认值，返回规范化合同。 */
export async function compileContractPreview(contract: unknown): Promise<CodeFilmContract> {
  const res = await vanillaApi.codeFilm.compile.mutate(contract);
  return res.contract;
}

/** 静态 QA：返回逐条字段路径，不抛错。 */
export async function validateContract(contract: unknown): Promise<QaReport> {
  return vanillaApi.codeFilm.validate.query(contract);
}

/** 合同 → 镜头 / 运行入参预览（QA 不通过时服务端抛 BAD_REQUEST）。 */
export async function previewShots(
  contract: unknown,
  fps?: number,
): Promise<{
  runs: Array<{ index: number; shotId: string; values: { frames?: number } }>;
  shots: Array<{ duration: number; id: string; index: number }>;
}> {
  return vanillaApi.codeFilm.toShots.query({ contract, fps });
}
