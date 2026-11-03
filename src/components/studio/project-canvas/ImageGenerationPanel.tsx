"use client";

import { upperToken } from "~/lib/upper-token";
import React, { useEffect, useRef } from "react";
import { Hint } from "~/components/ui/hint";
import { SelectMenu } from "~/components/ui/select-menu";
import { DynamicWorkflowForm } from "~/components/studio/workflow-form/DynamicWorkflowForm";
/* 直接引基础件与结果卡（不再经 CanvasNode 目录 barrel）：barrel 会 re-export
 *`CanvasNode`，而 CanvasNode.tsx 又渲染本组件 —— 经 barrel 就成了
 *`CanvasNode → ImageGenerationPanel → index → CanvasNode` 的循环（规范 12.7）。 */
import { Button } from "~/components/ui/button";
import { Field, btnCls } from "./CanvasNode/CanvasNodePrimitives";
import { ResultCard } from "./CanvasNode/ResultCard";
import type { WorkflowIOMap } from "~/components/studio/workflow-io";
import type { WorkflowModesState } from "./WorkflowNode";
import type { CanvasNodeData } from "~/lib/project-canvas/canvas-types";
import {
  IMAGE_WORKFLOW_TYPES,
  VIDEO_WORKFLOW_TYPES,
  normalizeTaskType,
} from "~/lib/workflow/workflow-types";
import { setActiveTaskId } from "./activeTask";
import { useCancelTask } from "./hooks/use-cancel-task";

/* 生成面板：生图 / 生成视频 / 图片资产共用（抽自 CanvasNode 的 image/video 分支）。
 * image/video 顶部渲染 ResultCard；picture 不渲染（结果显示在节点主体上）。
 * 步骤日志不在节点内展示（空间小、逐节点开关无法统一）：生成开始 setActiveTaskId() 交给
 * 底部 GlobalStepLogPanel。
 */

export type ImageGenerationPanelProps = {
  d: CanvasNodeData;
  /** image / video / picture —— 决定用哪套类型表（video 用 VIDEO_WORKFLOW_TYPES） */
  kind: "image" | "video" | "picture";
  modelTagLib: Array<{ count: number; id: string; name: string }>;
  onGenerate: () => void;
  /** 顶部 ResultCard 的「替换」回调（image/video 用；picture 忽略） */
  onReplaceResult?: () => void;
  patch: (p: Partial<CanvasNodeData>) => void;
  seededFor: React.MutableRefObject<string | null>;
  setWfModes: React.Dispatch<React.SetStateAction<WorkflowModesState | null>>;
  wfIO: WorkflowIOMap | null;
  wfIOLoading: boolean;
  wfList: Array<{
    id: string;
    modelTags?: Array<string>;
    name: string;
    sourcePath?: string | null;
    taskType?: string | null;
  }>;
  /** 工作流列表是否仍在加载。为 true 时工作流/模型选择区显示"加载中"而非空态。 */
  wfListLoading?: boolean;
};

export function ImageGenerationPanel({
  kind,
  d,
  patch,
  wfList,
  modelTagLib,
  wfIO,
  wfIOLoading,
  wfListLoading = false,
  seededFor,
  setWfModes,
  onGenerate,
  onReplaceResult,
}: ImageGenerationPanelProps) {
  /* 执行步骤日志迁移到独立 GlobalStepLogPanel。
   * 本组件只负责生成交互；生成开始（d.taskId 就绪）时通过 setActiveTaskId()
   * 把当前任务交给全局面板，由其统一订阅 SSE、展示日志与结构化校验错误。 */

  /* stuck-task cancel affordance —— 按钮的
   * 「取消中…」态与失败回滚都在 useCancelTask 里（视图零 IO）。 */
  const { cancelling, cancel: onCancel } = useCancelTask({
    taskId: d.taskId,
    onFailed: (reason) => {
      patchRef.current({ status: "error", error: reason });
    },
  });

  // 把`patch` 放在 ref 里，好让取消处理器（由异步
  // 回调触发）总能读到最新的值，而不必被重建。
  const patchRef = useRef(patch);
  // oxlint-disable-next-line react/refs -- 渲染期把最新 props 写入 ref，供异步取消回调读取最新值（刻意模式）
  patchRef.current = patch;

  /* 节点拿到 taskId（生成开始）时，设为全局面板活跃
   * 任务，使 GlobalStepLogPanel 自动跟随。ImageGenerationPanel 仅在选中节点时
   * 挂载，而用户点「生成」时必然选中，故 taskId 一旦就绪即可被捕获。 */
  useEffect(() => {
    if (d.taskId !== undefined && d.taskId !== "") {
      setActiveTaskId(d.taskId);
    }
  }, [d.taskId]);

  const isVideo = kind === "video";
  const typeList = isVideo ? VIDEO_WORKFLOW_TYPES : IMAGE_WORKFLOW_TYPES;
  /* 启发式兜底分类：早期导入的旧工作流 taskType 可能为空或误判（把 I2V 混进文生图），
   * 故按 wf.name 关键字补最可能的类型（含中文「图生视频」/「文生视频」，无英文 marker 也能识别）；
   * 推断不出返回空串，由上层 drop。 */
  const inferTypeByName = (rawName: string): string => {
    const up = upperToken(rawName);
    // ── VIDEO 类（更具体优先；Chinese"图生视频" 出现在 I2V 之前，
    // 因为中文"图生视频" 后面可能不带"I2V" 字样）
    if (/图生视频|IMG2VIDEO/.test(rawName)) {
      return "I2V";
    }
    if (/文生视频|TXT2VIDEO/.test(rawName)) {
      return "T2V";
    }
    if (/首尾帧视频|FLFVIDEO|FLF2V|FL2V/.test(up)) {
      return "FLF2V";
    }
    if (/视频转视频|V2V/.test(up)) {
      return "V2V";
    }
    if (rawName.includes("图生视频") || up.includes("I2V")) {
      return "I2V";
    }
    if (up.includes("FMF2V")) {
      return "FMF2V";
    }
    if (up.includes("T2V")) {
      return "T2V";
    }
    if (up.includes("S2V")) {
      return "S2V";
    }
    if (up.includes("R2V")) {
      return "R2V";
    }
    if (/VR2V|VRC2V/.test(up)) {
      return "VR2V";
    }
    if (/视频|VIDEO/.test(rawName) || up.includes("VIDEO")) {
      return "T2V";
    } // 中文"视频"或VIDEO兜底
    // ── IMAGE 类
    if (/文生图|T2I|TXT2IMG/.test(rawName) || /T2I|TXT2IMG/.test(up)) {
      return "T2I";
    }
    if (/图生图|局部重绘|I2I|IMG2IMG/.test(rawName) || /I2I|IMG2IMG/.test(up)) {
      return "I2I";
    }
    if (up.includes("INPAINT")) {
      return "Inpaint";
    }
    if (up.includes("OUTPAINT")) {
      return "Outpaint";
    }
    if (up.includes("UPSCAL")) {
      return "Upscale";
    }
    if (up.includes("C2I")) {
      return "C2I";
    }
    if (up.includes("IMAGE")) {
      return "T2I";
    } // 兜底归 T2I
    return "";
  };
  /* name 推断优先于 DB。
   * 此前，老的 inferWorkflowTypeFromGraph 把 WanVideoSampler+LoadImage
   * 误判为 T2I 落库；name 现在能正确识别为 I2V，必须以 name 为准避免泄漏。 */
  const effectiveTaskType = (w: {
    id?: string | null;
    name?: string | null;
    taskType?: string | null;
  }): string => {
    const fromName = inferTypeByName(w.name ?? "");
    if (fromName) {
      return fromName;
    }
    const fromDb = normalizeTaskType(w.taskType ?? "");
    if (fromDb) {
      return fromDb;
    }
    return inferTypeByName(w.id ?? "");
  };
  // Q3=B：列出全部类型，但隐藏无对应工作流的页签
  const typeOptions = typeList.filter((typeOption) =>
    wfList.some((wfList) => effectiveTaskType(wfList) === typeOption.code),
  );
  const typeKnown = typeOptions.some((typeOption) => typeOption.code === d.mode);
  const genTag = d.genModelTag ?? "";
  /* 模型 dropdown 列表只受「类型」影响，不受当前
   * 已选 genModelTag 影响 —— 否则选了 z-Anime 后下拉只剩一项。 */
  const typeFilteredWorkflows = wfList.filter((workflow) => effectiveTaskType(workflow) === d.mode);
  // Q2=A：工作流同时按 taskType + 模型标签 严格匹配
  const workflowOptions = typeFilteredWorkflows.filter((workflow) =>
    genTag ? (workflow.modelTags ?? []).includes(genTag) : true,
  );
  /* 模型 dropdown 按当前选中类型过滤 —
   * 源必须是 typeFilteredWorkflows（与 genTag 解耦）。 */
  const availableModelTags = new Set<string>();
  for (const w of typeFilteredWorkflows) {
    for (const tag of w.modelTags ?? []) {
      availableModelTags.add(tag);
    }
  }
  const modelTagOptions = modelTagLib.filter((modelTagLib) =>
    availableModelTags.has(modelTagLib.name),
  );

  const selectType = (code: string) => {
    // eslint-disable-next-line react-hooks/immutability -- seededFor 为 useRef，重选类型时清空种子标记
    seededFor.current = null;
    setWfModes(null);
    /* 切类型时若当前模型标签在新类型下没有工作流
     * 也清掉，避免 SelectMenu 残留「幽灵选项」。如仍匹配则保留。 */
    const newTypeWfs = wfList.filter((wfList) => effectiveTaskType(wfList) === code);
    const newAvailTags = new Set<string>();
    for (const w of newTypeWfs) {
      for (const tag of w.modelTags ?? []) {
        newAvailTags.add(tag);
      }
    }
    const keepTag = genTag && newAvailTags.has(genTag) ? genTag : "";
    patch({
      mode: code,
      genModelTag: keepTag,
      workflowId: undefined,
      workflowName: undefined,
      workflowTaskType: undefined,
      workflowInputs: {},
      paramMap: undefined,
      workflowSinkId: undefined,
    });
  };
  const selectModelTag = (name: string) => {
    // eslint-disable-next-line react-hooks/immutability -- 同上，重选模型标签时重置种子
    seededFor.current = null;
    setWfModes(null);
    // 该模型下若只剩 1 个工作流，就直接选它，避免
    // 「选模型 → 再选工作流」两步。用户既然没歧义（只有 1 个），就不再让人
    // 多点一次。注意保持与显式换工作流等同的清空（workflowInputs/sinkId），
    // 并与下面 selectWorkflow 的字段集合完全一致；否则会出现「自动选的 wf
    // 比用户手动选的 wf 字段少一截」的诡异状态。
    const newTypeWfs = wfList.filter((wfList) => effectiveTaskType(wfList) === d.mode);
    const candidateWfs = newTypeWfs.filter((workflow) =>
      name ? (workflow.modelTags ?? []).includes(name) : true,
    );
    const onlyWf = candidateWfs.length === 1 ? candidateWfs[0] : null;
    if (onlyWf) {
      patch({
        genModelTag: name,
        workflowId: onlyWf.id,
        workflowName: onlyWf.name,
        workflowTaskType: onlyWf.taskType ?? undefined,
        workflowInputs: {},
        paramMap: undefined,
        workflowSinkId: undefined,
      });
    } else {
      patch({
        genModelTag: name,
        workflowId: undefined,
        workflowName: undefined,
        workflowTaskType: undefined,
        workflowInputs: {},
        paramMap: undefined,
        workflowSinkId: undefined,
      });
    }
  };
  const selectWorkflow = (wfId: string) => {
    const wf = wfList.find((wfList) => wfList.id === wfId);
    // eslint-disable-next-line react-hooks/immutability -- 重选工作流时重置种子
    seededFor.current = null;
    patch({
      workflowId: wfId,
      workflowName: wf?.name,
      workflowTaskType: wf?.taskType ?? undefined,
      workflowInputs: {},
      paramMap: undefined,
      workflowSinkId: undefined,
    });
  };

  return (
    <div className="flex flex-col gap-2">
      {/* 生成结果预览（image/video 顶部常驻；picture 由节点主体承载，不重复渲染） */}
      {kind !== "picture" && d.resultPath !== undefined && d.resultPath !== "" ? (
        <ResultCard
          kind={kind}
          mediaType={d.resultMediaType}
          name={d.workflowName}
          onReplace={onReplaceResult ?? (() => undefined)}
          path={d.resultPath}
          status={d.status}
        />
      ) : null}

      {/* 步骤 1：类型（chip 列已改为 dropdown） */}
      <Field label="类型">
        {typeOptions.length ? (
          <SelectMenu
            labels={Object.fromEntries(
              typeOptions.map((typeOption) => [typeOption.code, typeOption.label]),
            )}
            onChange={selectType}
            options={typeOptions.map((typeOption) => typeOption.code)}
            placeholder="选择类型"
            value={typeKnown ? d.mode : ""}
          />
        ) : (
          <div className="text-ink-muted text-2xs">暂无可用工作流类型</div>
        )}
      </Field>

      {typeKnown ? (
        <>
          {/* 步骤 2：模型（按模型标签，与 workflow 筛选同源；空值 = 全部）
 只显示当前 type 下有工作流的模型标签，避免「文生图」下出现
 DaSiwaWan22 这种 video 模型。 */}
          <Field label="模型">
            {modelTagOptions.length ? (
              <SelectMenu
                labels={{
                  "": <span className="text-ink-muted">全部模型</span>,
                  ...Object.fromEntries(
                    modelTagOptions.map((modelTagOption) => [
                      modelTagOption.name,
                      modelTagOption.name,
                    ]),
                  ),
                }}
                onChange={selectModelTag}
                options={["", ...modelTagOptions.map((modelTagOption) => modelTagOption.name)]}
                placeholder="选择模型"
                value={genTag}
              />
            ) : (
              <div className="text-ink-muted text-2xs">
                {wfListLoading ? "加载中…" : genTag ? "当前模型下无工作流" : "该类型暂无工作流"}
              </div>
            )}
          </Field>

          {/* 步骤 3：工作流（chip 列已改为 dropdown） */}
          <Field label="工作流">
            {workflowOptions.length ? (
              <SelectMenu
                labels={Object.fromEntries(
                  workflowOptions.map((workflowOption) => [workflowOption.id, workflowOption.name]),
                )}
                onChange={selectWorkflow}
                options={workflowOptions.map((workflowOption) => workflowOption.id)}
                placeholder="选择工作流"
                value={d.workflowId ?? ""}
              />
            ) : (
              <div className="text-ink-muted text-2xs">
                {wfListLoading ? "加载中…" : genTag ? `模型「${genTag}」下` : ""}
                {wfListLoading ? "" : "暂无该类型工作流"}
              </div>
            )}
          </Field>
        </>
      ) : null}

      {/* 选完工作流：按自定义工作流样式渲染参数 + CTA（Q1=B 必须选工作流）*/}
      {d.workflowId !== undefined && d.workflowId !== "" ? (
        <>
          <DynamicWorkflowForm
            compact
            io={wfIO ?? undefined}
            loading={wfIOLoading}
            onChange={(next) => {
              patch({ workflowInputs: next });
            }}
            onSeedModeChange={(ioKey, mode) => {
              patch({ seedModes: { ...d.seedModes, [ioKey]: mode } });
            }}
            seedModes={d.seedModes}
            showOutputs={false}
            values={d.workflowInputs ?? {}}
            workflowId={d.workflowId}
          />
          <div className="flex items-center justify-center gap-2">
            <Button
              className={`${btnCls} h-auto px-6`}
              disabled={d.status === "running" || cancelling}
              onClick={onGenerate}
              variant="primary-solid"
            >
              {d.status === "running"
                ? "生成中…"
                : d.status === "error"
                  ? "↻ 重新执行"
                  : "▶ 用此工作流生成"}
            </Button>
            {/* 卡住任务的逃生通道：raw 路径占着在飞槽位时节点会永远停在「生成中…」。
                调用 POST /api/tasks/{id}/cancel 标 CANCELLED 并释放活跃槽位，
                SSE error 事件随后经普通失败路径把 d.status patch 成 "error"。 */}
            {d.status === "running" && d.taskId !== undefined && d.taskId !== "" ? (
              <Hint label="强制终止当前任务并释放活动槽位" wrap>
                <Button
                  className="border-destructive/30 bg-destructive/8 text-destructive/90 hover:bg-destructive/15 text-2xs h-auto rounded border px-2.5 py-1"
                  disabled={cancelling}
                  onClick={onCancel}
                  variant="outline"
                >
                  {cancelling ? "× 取消中…" : "× 强制取消"}
                </Button>
              </Hint>
            ) : null}
          </div>
          {/* 执行步骤日志不再在此节点内渲染——
           * 节点空间太小，且逐节点开关无法统一。请打开「调试模式」
           * （设置抽屉）+ 底部 GlobalStepLogPanel 查看每节点执行步骤、
           * 结构化校验错误与每条日志的调用来源。 */}
        </>
      ) : (
        <Button
          className={`${btnCls} mx-auto block h-auto w-auto px-6 opacity-40`}
          disabled
          variant="primary-solid"
        >
          请先选择工作流
        </Button>
      )}
    </div>
  );
}
