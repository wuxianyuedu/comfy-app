"use client";

// 工坊中间列：按当前阶段分发内容。
// 纯展示 + 事件上抛：这里不持有任何业务规则，数据来自 controller。
//
// 性能治理：把各 stage 的重型子组件改为按 stage 懒加载，仅在对应 tab
// 激活时拉进模块图。Turbopack 的模块图被切成独立小块后，保存枢纽文件或
// 单个 stage 组件时，热更新的重编范围不再横跨整条工坊链路。

import React from "react";
import { Button } from "~/components/ui/button";
import { useFilePicker } from "~/components/ui/file-picker";
import { readFileAsText } from "~/lib/file-io";
import { Skeleton } from "~/components/ui/skeleton";
import { Icon } from "~/components/ui/icon";
import { markdownToHtml } from "~/lib/markdown";
import type { WorkshopPipelineController } from "~/components/workshop/hooks/use-workshop-pipeline";
import { SCROLLBAR_VISIBLE_CLASSES } from "~/components/workshop/ScriptMarkdownEditor.parts";
import { StageHint } from "~/components/workshop/StageHint";
import { DraftIntegrityHint } from "~/components/workshop/DraftIntegrityHint";
import { STAGE_DEFS } from "~/components/workshop/stage-config";

// ── 各 stage 组件按需懒加载（named-export → default 包装）──
const LazyCharacterDesigner = React.lazy(() =>
  import("~/components/workshop/CharacterDesigner").then((m) => ({
    default: m.CharacterDesigner,
  })),
);
const LazyScriptGenerator = React.lazy(() =>
  import("~/components/workshop/ScriptGenerator").then((m) => ({
    default: m.ScriptGenerator,
  })),
);
const LazyScriptMarkdownEditor = React.lazy(() =>
  import("~/components/workshop/ScriptMarkdownEditor").then((m) => ({
    default: m.ScriptMarkdownEditor,
  })),
);
const LazyStoryboardPlanner = React.lazy(() =>
  import("~/components/workshop/StoryboardPlanner").then((m) => ({
    default: m.StoryboardPlanner,
  })),
);
const LazyShotStudio = React.lazy(() =>
  import("~/components/workshop/ShotStudio").then((m) => ({
    default: m.ShotStudio,
  })),
);
const LazyVideoStudio = React.lazy(() =>
  import("~/components/workshop/VideoStudio").then((m) => ({
    default: m.VideoStudio,
  })),
);
const LazyFinalComposer = React.lazy(() =>
  import("~/components/workshop/FinalComposer").then((m) => ({
    default: m.FinalComposer,
  })),
);

/** 懒加载占位：保留版面高度，避免 stage 切换瞬间塌陷。 */
function StageFallback() {
  return (
    <Skeleton className="border-border bg-surface min-h-65 rounded-2xl border p-5" />
  );
}

interface WorkshopStageBodyProps {
  controller: WorkshopPipelineController;
}

export function WorkshopStageBody({ controller }: WorkshopStageBodyProps) {
  const {
    /* 任务归属：这一屏的生成要落到哪个项目（镜头号在每条生成路径上现取） */
    activeProjectId,
    tab,
    setTab,
    stageIndex,
    stageTitle,
    stageDesc,
    prereq,
    meta,
    setMeta,
    scriptMarkdown,
    setScriptMarkdown,
    scenes,
    characters,
    setCharacters,
    shots,
    setShots,
    styles,
    workflowOptions,
    workflowId,
    videoWorkflowId,
    apiChannels,
    imageDoneCount,
    clipDoneCount,
    generating,
    shotProgress,
    characterExtract,
    characterExtractActions,
    storyboardExtract,
    storyboardExtractActions,
    characterPortrait,
    characterPortraitActions,
    isScriptEditorOpen,
    notice,
    integrity,
    rendered,
    generateShot,
    openScriptEditor,
    closeScriptEditor,
    saveScriptEditor,
    openApiSettings,
    markRendered,
    dismissNotice,
    showNotice,
    cancelShotTask,
  } = controller;

  /* 本地剧本文件导入：读取 .md / .txt 内容并写入 scriptMarkdown。
   *  隐藏 input 与「选完复位 value」的样板收进 `ui/file-picker`。 */
  const scriptPicker = useFilePicker({
    accept: ".md,.txt",
    onPick: (file) => {
      /* 读取统一走 `~/lib/file-io`（§16.2.4.27）：`file.text()` 的 rejection
       * 此前在这里被吞掉，「选了个读不了的文件」与「选了个空文件」在界面上
       * 长得一样。 */
      void readFileAsText(file)
        .then((text) => {
          if (text.trim()) {
            setScriptMarkdown(text);
          } else {
            showNotice(`「${file.name}」没有可导入的内容，已保留当前剧本`);
          }
        })
        .catch(() => {
          /* 读取失败不得清空已有剧本（旧实现把 scriptMarkdown 覆盖成空串，
           * 一次坏文件就毁掉整份剧本）。降级不得静默（规范 10 §10.3.1）：
           * 说清发生了什么、内容没有丢。 */
          showNotice(`「${file.name}」读取失败，已保留当前剧本内容`);
        });
    },
  });

  return (
    <div className="min-w-0">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="u-title-stage">{stageTitle}</h2>
          <p className="text-muted-foreground mt-1 text-xs">{stageDesc}</p>
        </div>
        <span className="text-muted-foreground bg-subtle text-2xs shrink-0 rounded-full px-3 py-1">
          阶段 {stageIndex} / {STAGE_DEFS.length}
        </span>
      </div>

      {notice && (
        <div className="border-destructive/30 bg-destructive/10 text-destructive mb-4 flex items-center gap-2 rounded-xl border px-4 py-2.5 text-xs">
          <Icon name="info" size={13} className="shrink-0" />
          <span className="flex-1">{notice}</span>
          <Button
            type="button"
            variant="ghost"
            size="xs"
            onClick={dismissNotice}
            className="hover:bg-destructive/15"
          >
            关闭
          </Button>
        </div>
      )}

      {/* 草稿里有「读不懂但仍要留着」的元素时常驻这一条（台账 F13″）：
       *  它不进 `notice` 那条通道 —— 那条是「刚发生了什么事」（新提示整条替换旧提示、
       *  可关闭），而这是**数据的当前状态**，关掉就等于把脏数据藏回地毯下。 */}
      <DraftIntegrityHint issues={integrity} onGoTo={setTab} />

      {/* ── Tab: Script ── */}
      {tab === "script" && (
        <>
          {/* 品牌渐变每屏只一处：下面「编辑剧本 / 新建剧本」两颗处在互斥分支上，同时只会渲染一个 —— 这个互斥是载荷性的，别在同一段再加第二颗。 */}
          {scriptMarkdown.trim() ? (
            /* ── 已有剧本内容：直接展示 ── */
            <section className="border-border bg-surface rounded-2xl border p-5">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-ink u-title">剧本内容</h3>
                <div className="flex items-center gap-2">
                  {scenes.length > 0 && (
                    <span className="text-muted-foreground bg-subtle text-2xs rounded-lg px-3 py-1">
                      场景 {scenes.length}
                    </span>
                  )}
                  <Button
                    type="button"
                    variant="gradient"
                    onClick={openScriptEditor}
                    className="text-2xs rounded-lg px-4 py-1.5 font-medium"
                  >
                    编辑剧本
                  </Button>
                </div>
              </div>
              <div
                className={`${SCROLLBAR_VISIBLE_CLASSES} bg-bg text-ink-subtle max-h-120 rounded-xl p-4 text-[13px] leading-7`}
                dangerouslySetInnerHTML={{
                  __html: markdownToHtml(scriptMarkdown),
                }}
              />
            </section>
          ) : (
            <>
              {/* ── 暂无剧本：提供新建/导入入口 ── */}
              <section className="border-border bg-surface rounded-2xl border p-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h3 className="text-ink u-title">新建剧本</h3>
                    <p className="text-muted-foreground mt-1 text-[11.5px]">
                      可直接编写 markdown 剧本，或导入本地 .md / .txt 文件。
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={scriptPicker.open}
                      className="text-ink bg-subtle hover:bg-surface-2 rounded-lg px-4 py-1.5 text-xs font-medium"
                    >
                      导入剧本
                    </Button>
                    <Button
                      type="button"
                      variant="gradient"
                      onClick={openScriptEditor}
                      className="text-2xs rounded-lg px-4 py-1.5 font-medium"
                    >
                      新建剧本
                    </Button>
                    <scriptPicker.Input />
                  </div>
                </div>
              </section>

              {/* ── 剧本工具（智能辅助）── */}
              <section className="border-border bg-surface mt-5 rounded-2xl border p-5">
                <h3 className="text-ink u-title mb-3">剧本工具</h3>
                <React.Suspense fallback={<StageFallback />}>
                  <LazyScriptGenerator
                    meta={meta}
                    onMetaChange={setMeta}
                    onScriptChange={setScriptMarkdown}
                  />
                </React.Suspense>
              </section>
            </>
          )}
        </>
      )}

      {/* ── Tab: Character ── */}
      {tab === "character" && (
        <>
          {prereq && (
            <StageHint text={prereq.text} onGo={() => setTab(prereq.go)} />
          )}
          <section className="border-border bg-surface mt-4 rounded-2xl border p-5">
            <h3 className="text-ink u-title mb-3">角色工具</h3>
            <React.Suspense fallback={<StageFallback />}>
              <LazyCharacterDesigner
                characters={characters}
                styles={styles}
                onCharactersChange={setCharacters}
                scriptMarkdown={scriptMarkdown}
                extract={{
                  session: characterExtract,
                  actions: characterExtractActions,
                }}
                portrait={{
                  session: characterPortrait,
                  actions: characterPortraitActions,
                  apiChannels,
                  workflows: workflowOptions,
                  onOpenApiSettings: openApiSettings,
                }}
              />
            </React.Suspense>
          </section>
        </>
      )}

      {/* ── Tab: Storyboard ── */}
      {tab === "storyboard" && (
        <>
          {prereq && (
            <StageHint text={prereq.text} onGo={() => setTab(prereq.go)} />
          )}
          <div className="mt-4 flex justify-end">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setTab("shots")}
              className="text-ink bg-subtle hover:bg-surface-2 h-auto rounded-xl px-6 py-3 text-[13px] font-semibold"
            >
              下一阶段 →
            </Button>
          </div>

          <section className="border-border bg-surface mt-5 rounded-2xl border p-5">
            <h3 className="text-ink u-title mb-3">分镜工具</h3>
            <React.Suspense fallback={<StageFallback />}>
              <LazyStoryboardPlanner
                scenes={scenes}
                characters={characters}
                styles={styles}
                shots={shots}
                onShotsChange={setShots}
                onGenerate={generateShot}
                generating={generating}
                progressByShot={shotProgress}
                scriptMarkdown={scriptMarkdown}
                onCharactersChange={setCharacters}
                extract={{
                  session: storyboardExtract,
                  actions: storyboardExtractActions,
                }}
              />
            </React.Suspense>
          </section>
        </>
      )}

      {/* ── Tab: Shot images (镜头生图) ── */}
      {tab === "shots" && (
        <>
          {prereq && (
            <StageHint text={prereq.text} onGo={() => setTab(prereq.go)} />
          )}
          <section className="border-border bg-surface mt-4 rounded-2xl border p-5">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-ink u-title">生图工具</h3>
              <span className="text-muted-foreground bg-subtle text-2xs rounded-lg px-3 py-1">
                图 {imageDoneCount}/{shots.length}
              </span>
            </div>
            <React.Suspense fallback={<StageFallback />}>
              <LazyShotStudio
                shots={shots}
                scenes={scenes}
                characters={characters}
                styles={styles}
                workflowId={workflowId}
                projectId={activeProjectId}
                apiChannels={apiChannels}
                onOpenApiSettings={openApiSettings}
                onShotsChange={setShots}
                onNotice={showNotice}
                onCancelShot={(shot) => void cancelShotTask(shot, "image")}
                onNextStage={() => setTab("video")}
              />
            </React.Suspense>
          </section>
        </>
      )}

      {/* ── Tab: Video generation (视频生成) ── */}
      {tab === "video" && (
        <>
          {prereq && (
            <StageHint text={prereq.text} onGo={() => setTab(prereq.go)} />
          )}
          <section className="border-border bg-surface mt-4 rounded-2xl border p-5">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-ink u-title">视频工具</h3>
              <span className="text-muted-foreground bg-subtle text-2xs rounded-lg px-3 py-1">
                片段 {clipDoneCount}/{shots.length}
              </span>
            </div>
            <React.Suspense fallback={<StageFallback />}>
              <LazyVideoStudio
                shots={shots}
                workflowId={videoWorkflowId}
                projectId={activeProjectId}
                apiChannels={apiChannels}
                onOpenApiSettings={openApiSettings}
                onShotsChange={setShots}
                onNotice={showNotice}
                onCancelShot={(shot) => void cancelShotTask(shot, "video")}
                onPrevStage={() => setTab("shots")}
                onNextStage={() => setTab("render")}
              />
            </React.Suspense>
          </section>
        </>
      )}

      {/* ── Tab: Final composition (成片合成) ── */}
      {tab === "render" && (
        <>
          {prereq && (
            <StageHint text={prereq.text} onGo={() => setTab(prereq.go)} />
          )}
          <section className="border-border bg-surface mt-4 rounded-2xl border p-5">
            <React.Suspense fallback={<StageFallback />}>
              <LazyFinalComposer
                shots={shots}
                title={meta.title || "未命名项目"}
                onShotsChange={setShots}
                rendered={rendered}
                onRendered={markRendered}
              />
            </React.Suspense>
          </section>
        </>
      )}

      {/* 全屏 markdown 剧本编辑器 */}
      {isScriptEditorOpen && (
        <React.Suspense fallback={<StageFallback />}>
          <LazyScriptMarkdownEditor
            title={meta.title || "编辑剧本"}
            value={scriptMarkdown}
            onChange={setScriptMarkdown}
            onSave={saveScriptEditor}
            onCancel={closeScriptEditor}
          />
        </React.Suspense>
      )}
    </div>
  );
}
