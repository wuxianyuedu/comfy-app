"use client";

import { Icon } from "@/components/ui/icon";
import { ExtractToolbar } from "@/components/workshop/ExtractToolbar";
import { useStoryboardPlanner, type Props } from "./useStoryboardPlanner";
import { ShotRow } from "./StoryboardPlanner.parts";

export function StoryboardPlanner(props: Props) {
  const { shots, scenes, characters, styles, onGenerate, generating, progressByShot } = props;
  const planner = useStoryboardPlanner(props);
  const {
    aiBusy,
    aiProgress,
    aiError,
    config,
    extractChannelValue,
    setExtractChannelValue,
    extractBusy,
    extractProgress,
    extractStatus,
    extractError,
    extractionLog,
    hasScript,
    handleExtract,
    handleImportFile,
    importFromScript,
    handleAISplit,
    clearShots,
    generateAll,
    polishBusyId,
    polishBusyAll,
    polishError,
    polishOne,
    polishAll,
  } = planner;

  const idleCount = shots.filter((shot) => shot.status === "idle" || shot.status === "failed").length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="u-title">
          分镜规划 <span className="text-muted-foreground">({shots.length})</span>
        </h3>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={importFromScript}
            disabled={scenes.length === 0 || aiBusy}
            className="rounded-lg border border-border px-3 py-1.5 text-xs text-primary hover:bg-subtle disabled:opacity-40"
          >
            ↓ 从剧本导入
          </button>
          <button
            type="button"
            onClick={handleAISplit}
            disabled={scenes.length === 0 || aiBusy}
            className="rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-white transition-opacity disabled:opacity-40"
          >
            {aiBusy ? (
              "AI 拆镜中…"
            ) : (
              (
                <>
                  <Icon name="sparkles" size={13} className="mr-1 inline align-[-2px]" />
                  AI 智能拆镜
                </>
              )
            )}
          </button>
          {shots.length > 0 && (
            <>
              <button
                type="button"
                title="用模型把模板提示词润色为更有画面感的生图提示词"
                onClick={() => void polishAll()}
                disabled={polishBusyAll || polishBusyId != null || aiBusy}
                className="rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-white transition-opacity disabled:opacity-40"
              >
                {polishBusyAll ? "润色中…" : (
                  <>
                    <Icon name="sparkles" size={13} className="mr-1 inline align-[-2px]" />
                    AI 润色提示词
                  </>
                )}
              </button>
              <button
                type="button"
                onClick={clearShots}
                className="rounded-lg border border-border px-3 py-1.5 text-xs text-muted-foreground hover:bg-subtle"
              >
                清空
              </button>
            </>
          )}
          <button
            type="button"
            onClick={generateAll}
            disabled={idleCount === 0 || generating}
            className="rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-white transition-opacity disabled:opacity-40"
          >
            {generating ? "生成中…" : `批量生成 (${idleCount})`}
          </button>
        </div>
      </div>

      {/* 从剧本提取分镜：分组下拉（工具/本地/远端）+ 提取 */}
      <ExtractToolbar
        title="从剧本提取分镜"
        channelValue={extractChannelValue}
        onChannelValueChange={setExtractChannelValue}
        onExtract={() => {
          void handleExtract();
        }}
        onImportFile={(file) => {
          void handleImportFile(file);
        }}
        busy={extractBusy}
        progressText={extractProgress}
        statusText={extractStatus}
        errorText={extractError}
        executionLog={extractionLog}
        logStage="character"
        extractDisabled={!hasScript}
        extractDisabledReason="未获取到剧本文本(在「剧本」阶段编写后可提取)。仍可用「外部导入」载入分镜脚本或角色卡文件。"
      />

      {scenes.length === 0 && (
        <div className="rounded-xl border border-dashed border-border py-6 text-center text-xs text-muted-foreground">
          先在「剧本」中创建场景，再点「从剧本导入」或「AI 智能拆镜」自动生成分镜。
        </div>
      )}

      {polishError && (
        <div className="rounded-lg bg-red-100 px-3 py-2 text-xs text-red-700">
          {polishError}
        </div>
      )}

      {(aiProgress || aiError) && (
        <div
          className={`rounded-lg px-3 py-2 text-xs ${
            aiError ? "bg-red-100 text-red-700" : "bg-primary-soft/40 text-primary"
          }`}
        >
          {aiError || aiProgress}
        </div>
      )}

      {!config && scenes.length > 0 && (
        <div className="rounded-lg bg-subtle px-3 py-2 text-xs text-muted-foreground">
          未配置 LLM。「AI 智能拆镜」将不可用，可改用「从剧本导入」（按镜头数模板拆分），或在右上角「LLM 设置」接入本地/远端模型。
        </div>
      )}

      {shots.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border py-10 text-center text-sm text-muted-foreground">
          暂无分镜。导入剧本后，每个场景会按建议镜头数拆分为多个镜头。
        </div>
      ) : (
        <div className="space-y-3">
          {shots.map((shot) => (
            <ShotRow
              key={shot.id}
              shot={shot}
              characters={characters}
              styles={styles}
              progressByShot={progressByShot}
              generating={generating}
              polishBusy={polishBusyId === shot.id}
              onPolish={() => void polishOne(shot)}
              onUpdate={planner.updateShot}
              onRemove={planner.removeShot}
              onGenerate={onGenerate}
            />
          ))}
        </div>
      )}
    </div>
  );
}
