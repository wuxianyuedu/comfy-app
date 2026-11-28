"use client";

/* 漫剧推荐包面板（ISSUE #5265）：只读列出扫描到的漫剧工作流，显示模式 / 用途 / 缺件 /
 * 依赖模型与风险，命中且无缺件时可一键走既有导入口落库。业务逻辑在
 * hooks/use-anime-workflow-pack，本文件只做展示与动作触发。 */
import { fireAndForget } from "~/lib/async-action";

import { Button } from "~/components/ui/button";

import { useAnimeWorkflowPack } from "../hooks/use-anime-workflow-pack";

export function AnimeWorkflowPackPanel() {
  const { busyPath, candidates, importPack, isLoading } = useAnimeWorkflowPack();

  return (
    <div className="border-border-subtle flex flex-col gap-3 rounded-lg border p-4 text-sm">
      <div>
        <div className="font-medium">漫剧推荐工作流包</div>
        <p className="text-muted-foreground mt-1">
          只读扫描你已导入的 ComfyUI 工作流，按镜头模式标注用途与缺件；不内置模板、不自动下载模型。
        </p>
      </div>

      {isLoading ? (
        <div className="text-muted-foreground">扫描本地工作流…</div>
      ) : candidates.length === 0 ? (
        <div className="text-muted-foreground">
          未发现可识别的漫剧工作流。先把 .json 放进配置的工作流目录，再点「导入」重新扫描。
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {candidates.map((candidate) => (
            <li
              className="border-border-subtle flex flex-col gap-2 rounded-lg border p-3"
              key={candidate.path}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="font-medium">
                    {candidate.name}
                    <span className="text-muted-foreground"> · {candidate.analysis.mode}</span>
                  </div>
                  <div className="text-muted-foreground">{candidate.analysis.purpose}</div>
                </div>
                <Button
                  disabled={!candidate.analysis.ok || busyPath !== ""}
                  onClick={() => {
                    fireAndForget(importPack(candidate), () => undefined);
                  }}
                  size="sm"
                >
                  {busyPath === candidate.path
                    ? "导入中…"
                    : candidate.analysis.ok
                      ? "一键导入"
                      : "缺节点"}
                </Button>
              </div>
              {candidate.analysis.missingNodes.length > 0 && (
                <div className="text-destructive">
                  缺必需节点：{candidate.analysis.missingNodes.join("、")}
                </div>
              )}
              {candidate.analysis.dependencies.length > 0 && (
                <div className="text-muted-foreground">
                  依赖模型：{candidate.analysis.dependencies.join("、")}（请自行确认，不会自动下载）
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
