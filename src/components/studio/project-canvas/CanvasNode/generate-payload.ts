/* ── 画布节点 → `generate.generate` 入参（纯构造，不读全局、不做 IO）──
 * 返回类型即 `GenerateInput`（与 `generateInputSchema` / 服务端 `.input()` 同一份 schema）。
 * 住在视图层：这里用到的三个助手读画布 IO 映射，而 lib 不许 import 视图（硬规则 22）。
 * `projectId` 由调用点注入（原为函数体内 `getActiveId()`），否则无法脱离人造上下文测试。
 */
import { toWorkflowInputsPayload, type WorkflowIOMap } from "~/components/studio/workflow-io";
import type { GenerateInput } from "~/lib/workflow/workflow-generate-input";
import {
  applyParamMapping,
  buildParamEntries,
  parseParamMapping,
} from "~/lib/workflow/workflow-param-mapping";
import type { CanvasNodeData } from "~/lib/project-canvas/canvas-types";

import { collectReferenceImages, seedModeOverrides } from "./helpers";

/** 构造一次生成请求所需的全部输入（都来自节点数据 + 该工作流的 IO 映射）。 */
export type CanvasGeneratePayloadArgs = {
  /** 发起生成的那个节点的数据（工作流 id、对外口的取值、种子控制模式、上游图）。 */
  d: CanvasNodeData;
  /** 项目级产出：归属到哪个画布项目（`getActiveId()` 的结果，由调用点传入）。 */
  projectId?: string | null;
  /** 该工作流的对外 IO 表；没有（还没加载完）时按「全部走工作流默认值」兜底。 */
  wfIO: WorkflowIOMap | null;
  /** 工作流当前生效的模式（落点覆盖按它归属，`source.mode:<模式>`）。 */
  wfMode?: string | null;
  /** 作者在工作流库配的「对外参数 → 节点端口」映射（`paramMap.source`）。 */
  wfParamMap?: Record<string, unknown> | null;
};

/** 把「这个节点要点一次生成」翻译成 tRPC 入参。 */
export function buildCanvasGeneratePayload({
  d,
  wfIO,
  wfParamMap,
  wfMode,
  projectId,
}: CanvasGeneratePayloadArgs): GenerateInput {
  /* 有映射表时按「对外参数 → 目标端口」解析：作者画过线的对外口只覆盖他连到的
   * 那个端口（不把该节点别的默认值也塞进去），没连线的对外口仍按工作流默认值
   * 兜底 —— 落点完全由作者画的线决定，运行期不做任何「猜一个端口」的推断。 */
  const mode = wfMode ?? null;
  /* 组合控件覆盖到的端口（宽/高、比例/像素/倍数）：一个「尺寸」口接到这几个
   * 端口上时，值要逐端口派生成各自认的形状 —— 不传这份集合，多端口只能按
   * 单端口处理，「尺寸」另外几条线就从外部拿不到值（ISSUE #355）。判定与
   * 表单同一份（`inferGroups`），不另算一遍避免漂移。 */
  const mapped = wfIO
    ? applyParamMapping({
        io: wfIO,
        entries: buildParamEntries(wfIO, undefined, { mode }),
        mapping: parseParamMapping(wfParamMap ?? d.paramMap),
        values: d.workflowInputs ?? {},
        mode,
      })
    : null;
  const baseInputs =
    mapped && mapped.inputs.length > 0
      ? mapped.inputs
      : toWorkflowInputsPayload(wfIO ?? undefined, d.workflowInputs ?? {});
  const cagInputs = seedModeOverrides(wfIO ?? null, d.seedModes);
  const referenceImages = collectReferenceImages(d);
  /* 暴露的引脚取值驱动工作流（不是旧的写死提示词/反向/参考图/步数/CFG/种子字段）。
   * 种子的「生成后控制」模式也并入同一数组（`name=control_after_generate`），
   * 执行点按此写进工作流原件的控件槽 —— 原本单独下发的 `seedModes` 字段会被
   * 入参判据剥掉、从未到达后端，所以必须并进来才生效。
   * 空的 `projectId` **不写成空串**：「没有归属」与「归属是空串」在库里必须能区分。 */
  return {
    workflow: d.workflowId ?? "",
    workflowInputs: [...baseInputs, ...cagInputs],
    ...(d.inputImage !== undefined && d.inputImage !== "" ? { inputImage: d.inputImage } : {}),
    ...(projectId !== undefined && projectId !== null && projectId !== "" ? { projectId } : {}),
    ...(referenceImages.length > 0 ? { referenceImages } : {}),
  };
}
