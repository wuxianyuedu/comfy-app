"use client";

import { Icon } from "~/components/ui/icon";
import { Button } from "~/components/ui/button";
import { ExtractToolbar } from "~/components/workshop/ExtractToolbar";
import { useStoryboardPlanner, type Props } from "./useStoryboardPlanner";
import { ShotRow } from "./StoryboardPlanner.parts";

export function StoryboardPlanner(props: Props) {
  const {
    shots,
    scenes,
    characters,
    styles,
    onGenerate,
    generating,
    progressByShot,
  } = props;
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
    polishIsBusy,
    polishAnyBusy,
    polishBusyAll,
    polishOne,
    polishAll,
  } = planner;

  const idleCount = shots.filter(
    (shot) => shot.status === "idle" || shot.status === "failed",
  ).length;

  return (
    <div className="flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="u-title">
          分镜规划{""}
          <span className="text-muted-foreground">({shots.length})</span>
        </h3>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="xs"
            onClick={importFromScript}
            disabled={scenes.length === 0 || aiBusy}
            className="border-border text-primary hover:bg-subtle h-auto rounded-lg px-3 py-1.5"
          >
            ↓ 从剧本导入
          </Button>
          <Button
            variant="primary-solid"
            size="xs"
            onClick={handleAISplit}
            disabled={scenes.length === 0 || aiBusy}
            className="h-auto rounded-lg px-3 py-1.5"
          >
            {aiBusy ? (
              "AI 拆镜中…"
            ) : (
              <>
                <Icon
                  name="sparkles"
                  size={13}
                  className="mr-1 inline align-[-2px]"
                />
                AI 智能拆镜
              </>
            )}
          </Button>
          {shots.length > 0 && (
            <>
              <Button
                variant="primary-solid"
                size="xs"
                title="用模型把模板提示词润色为更有画面感的生图提示词"
                onClick={() => void polishAll()}
                disabled={polishBusyAll || polishAnyBusy || aiBusy}
                className="h-auto rounded-lg px-3 py-1.5"
              >
                {polishBusyAll ? (
                  "润色中…"
                ) : (
                  <>
                    <Icon
                      name="sparkles"
                      size={13}
                      className="mr-1 inline align-[-2px]"
                    />
                    AI 润色提示词
                  </>
                )}
              </Button>
              <Button
                variant="outline"
                size="xs"
                onClick={clearShots}
                className="border-border text-muted-foreground hover:bg-subtle h-auto rounded-lg px-3 py-1.5"
              >
                清空
              </Button>
            </>
          )}
          <Button
            variant="primary-solid"
            size="xs"
            onClick={generateAll}
            disabled={idleCount === 0 || generating}
            className="h-auto rounded-lg px-3 py-1.5"
          >
            {generating ? "生成中…" : `批量生成 (${idleCount})`}
          </Button>
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
        <div className="border-border text-muted-foreground rounded-xl border border-dashed py-6 text-center text-xs">
          先在「剧本」中创建场景，再点「从剧本导入」或「AI
          智能拆镜」自动生成分镜。
        </div>
      )}

      {(aiProgress || aiError) && (
        <div
          className={`rounded-lg px-3 py-2 text-xs ${
            aiError
              ? "bg-destructive/10 text-destructive"
              : "bg-primary-soft/40 text-primary"
          }`}
        >
          {aiError || aiProgress}
        </div>
      )}

      {!config && scenes.length > 0 && (
        <div className="bg-subtle text-muted-foreground rounded-lg px-3 py-2 text-xs">
          未配置 LLM。「AI
          智能拆镜」将不可用，可改用「从剧本导入」（按镜头数模板拆分），或在右上角「LLM
          设置」接入本地/远端模型。
        </div>
      )}

      {shots.length === 0 ? (
        <div className="border-border text-muted-foreground rounded-xl border border-dashed py-10 text-center text-sm">
          暂无分镜。导入剧本后，每个场景会按建议镜头数拆分为多个镜头。
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {shots.map((shot) => (
            <ShotRow
              key={shot.id}
              shot={shot}
              characters={characters}
              styles={styles}
              progressByShot={progressByShot}
              generating={generating}
              polishBusy={polishIsBusy(shot.id)}
              /* 润色错误挂在**这一条**上（规范 16 §16.2.4.33）。 */
              polishError={planner.polishErrors.get(shot.id)}
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
