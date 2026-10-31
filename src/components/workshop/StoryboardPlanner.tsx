"use client";

import { Hint } from "~/components/ui/hint";
import { Icon } from "~/components/ui/icon";
import { EmptyState } from "~/components/ui/empty-state";
import { Button } from "~/components/ui/button";
import { ExtractToolbar } from "~/components/workshop/ExtractToolbar";
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
            className="border-border text-primary hover:bg-subtle h-auto rounded-lg px-3 py-1.5"
            disabled={scenes.length === 0 || aiBusy}
            onClick={importFromScript}
            size="xs"
            variant="outline"
          >
            ↓ 从剧本导入
          </Button>
          <Button
            className="h-auto rounded-lg px-3 py-1.5"
            disabled={scenes.length === 0 || aiBusy}
            onClick={handleAISplit}
            size="xs"
            variant="primary-solid"
          >
            {aiBusy ? (
              "AI 拆镜中…"
            ) : (
              <>
                <Icon className="mr-1" data-icon="inline-start" name="sparkles" size={13} />
                AI 智能拆镜
              </>
            )}
          </Button>
          {shots.length > 0 && (
            <>
              <Hint label="用模型把模板提示词润色为更有画面感的生图提示词" wrap>
                <Button
                  className="h-auto rounded-lg px-3 py-1.5"
                  disabled={polishBusyAll || polishAnyBusy || aiBusy}
                  onClick={() => void polishAll()}
                  size="xs"
                  variant="primary-solid"
                >
                  {polishBusyAll ? (
                    "润色中…"
                  ) : (
                    <>
                      <Icon className="mr-1" data-icon="inline-start" name="sparkles" size={13} />
                      AI 润色提示词
                    </>
                  )}
                </Button>
              </Hint>
              <Button
                className="border-border text-muted-foreground hover:bg-subtle h-auto rounded-lg px-3 py-1.5"
                onClick={clearShots}
                size="xs"
                variant="outline"
              >
                清空
              </Button>
            </>
          )}
          <Button
            className="h-auto rounded-lg px-3 py-1.5"
            disabled={idleCount === 0 || generating}
            onClick={generateAll}
            size="xs"
            variant="primary-solid"
          >
            {generating ? "生成中…" : `批量生成 (${idleCount})`}
          </Button>
        </div>
      </div>

      {/* 从剧本提取分镜：分组下拉（工具/本地/远端）+ 提取 */}
      <ExtractToolbar
        busy={extractBusy}
        channelValue={extractChannelValue}
        errorText={extractError}
        executionLog={extractionLog}
        extractDisabled={!hasScript}
        extractDisabledReason="未获取到剧本文本(在「剧本」阶段编写后可提取)。仍可用「外部导入」载入分镜脚本或角色卡文件。"
        logStage="character"
        onChannelValueChange={setExtractChannelValue}
        onExtract={() => {
          void handleExtract();
        }}
        onImportFile={(file) => {
          void handleImportFile(file);
        }}
        progressText={extractProgress}
        statusText={extractStatus}
        title="从剧本提取分镜"
      />

      {scenes.length === 0 && (
        <EmptyState
          className="py-6 text-xs"
          description="先在「剧本」中创建场景，再点「从剧本导入」或「AI 智能拆镜」自动生成分镜。"
          variant="hint"
        />
      )}

      {(aiProgress || aiError) && (
        <div
          className={`rounded-lg px-3 py-2 text-xs ${
            aiError ? "bg-destructive/10 text-destructive" : "bg-primary-soft/40 text-primary"
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
        <EmptyState
          className="py-10 text-sm"
          description="暂无分镜。导入剧本后，每个场景会按建议镜头数拆分为多个镜头。"
          variant="hint"
        />
      ) : (
        <div className="flex flex-col gap-3">
          {shots.map((shot) => (
            <ShotRow
              characters={characters}
              generating={generating}
              key={shot.id}
              onGenerate={onGenerate}
              onPolish={() => void polishOne(shot)}
              onRemove={planner.removeShot}
              onUpdate={planner.updateShot}
              polishBusy={polishIsBusy(shot.id)}
              /* 润色错误挂在**这一条**上（规范 16 §16.2.4.33）。 */
              polishError={planner.polishErrors.get(shot.id)}
              progressByShot={progressByShot}
              shot={shot}
              styles={styles}
            />
          ))}
        </div>
      )}
    </div>
  );
}
