"use client";

// 工坊中间列：按当前阶段分发内容。
// 纯展示 + 事件上抛：这里不持有任何业务规则，数据来自 controller。

import React from "react";
import { Button } from "~/components/ui/button";
import { Icon } from "~/components/ui/icon";
import { markdownToHtml } from "@/lib/comfyui/markdown";
import type { WorkshopPipelineController } from "~/components/workshop/hooks/use-workshop-pipeline";
import { CharacterDesigner } from "~/components/workshop/CharacterDesigner";
import { FinalComposer } from "~/components/workshop/FinalComposer";
import { LLMStatusChip } from "~/components/workshop/LLMContext";
import { ScriptGenerator } from "~/components/workshop/ScriptGenerator";
import { ScriptMarkdownEditor } from "~/components/workshop/ScriptMarkdownEditor";
import { SCROLLBAR_VISIBLE_CLASSES } from "~/components/workshop/ScriptMarkdownEditor.parts";
import { ShotStudio } from "~/components/workshop/ShotStudio";
import { StageHint } from "~/components/workshop/StageHint";
import { StoryboardPlanner } from "~/components/workshop/StoryboardPlanner";
import { VideoStudio } from "~/components/workshop/VideoStudio";
import { STAGE_DEFS } from "~/components/workshop/stage-config";

interface WorkshopStageBodyProps {
  controller: WorkshopPipelineController;
}

export function WorkshopStageBody({ controller }: WorkshopStageBodyProps) {
  const {
    tab,
    setTab,
    stageIndex,
    stageTitle,
    stageDesc,
    prereq,
    gridShots,
    meta,
    setMeta,
    scriptMarkdown,
    setScriptMarkdown,
    scenes,
    setScenes,
    characters,
    setCharacters,
    shots,
    setShots,
    styles,
    checkpoints,
    checkpoint,
    setCheckpoint,
    apiChannels,
    imageDoneCount,
    clipDoneCount,
    generating,
    shotProgress,
    isScriptEditorOpen,
    notice,
    rendered,
    generateShot,
    openScriptEditor,
    closeScriptEditor,
    saveScriptEditor,
    openApiSettings,
    markRendered,
    dismissNotice,
  } = controller;

  /* 本地剧本文件导入：读取 .md / .txt 内容并写入 scriptMarkdown */
  const scriptFileRef = React.useRef<HTMLInputElement>(null);
  const handleScriptImport = React.useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (file) {
        const text = await file.text();
        if (text.trim()) setScriptMarkdown(text);
      }
      // 允许重复选择同一文件
      event.target.value = "";
    },
    [setScriptMarkdown],
  );

  return (
    <div className="min-w-0">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-ink text-[17px] font-semibold">{stageTitle}</h2>
          <p className="text-muted-foreground mt-1 text-[12px]">{stageDesc}</p>
        </div>
        <span className="text-muted-foreground shrink-0 rounded-full bg-white/4 px-3 py-1 text-[11px]">
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

      {/* ── Tab: Script ── */}
      {tab === "script" && (
        <>
          {scriptMarkdown.trim() ? (
            /* ── 已有剧本内容：直接展示 ── */
            <section className="border-border bg-surface rounded-2xl border p-5">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-ink text-[14px] font-semibold">剧本内容</h3>
                <div className="flex items-center gap-2">
                  {scenes.length > 0 && (
                    <span className="text-muted-foreground rounded-lg bg-white/4 px-3 py-1 text-[11px]">
                      场景 {scenes.length}
                    </span>
                  )}
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={openScriptEditor}
                    className="btn-gradient rounded-lg px-4 py-1.5 text-[11px] font-medium text-white shadow-lg shadow-purple-900/20"
                  >
                    编辑剧本
                  </Button>
                </div>
              </div>
              <div
                className={`${SCROLLBAR_VISIBLE_CLASSES} bg-bg max-h-[480px] rounded-xl p-4 text-[13px] leading-7 text-[#d4d4d8]`}
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
                    <h3 className="text-ink text-[14px] font-semibold">
                      新建剧本
                    </h3>
                    <p className="text-muted-foreground mt-1 text-[11.5px]">
                      可直接编写 markdown 剧本，或导入本地 .md / .txt 文件。
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => scriptFileRef.current?.click()}
                      className="text-ink rounded-lg bg-white/4 px-4 py-1.5 text-xs font-medium hover:bg-white/8"
                    >
                      导入剧本
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={openScriptEditor}
                      className="btn-gradient rounded-lg px-4 py-1.5 text-[11px] font-medium text-white shadow-lg shadow-purple-900/20"
                    >
                      新建剧本
                    </Button>
                    <input
                      ref={scriptFileRef}
                      type="file"
                      accept=".md,.txt"
                      className="hidden"
                      onChange={handleScriptImport}
                    />
                  </div>
                </div>
              </section>

              {/* ── 剧本工具（智能辅助）── */}
              <section className="border-border bg-surface mt-5 rounded-2xl border p-5">
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="text-ink text-[14px] font-semibold">
                    剧本工具
                  </h3>
                  <LLMStatusChip />
                </div>
                <ScriptGenerator
                  meta={meta}
                  scenes={scenes}
                  onMetaChange={setMeta}
                  onScenesChange={setScenes}
                />
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
            <h3 className="text-ink mb-3 text-[14px] font-semibold">
              角色工具
            </h3>
            <CharacterDesigner
              characters={characters}
              styles={styles}
              onCharactersChange={setCharacters}
              scriptMarkdown={scriptMarkdown}
            />
          </section>
        </>
      )}

      {/* ── Tab: Storyboard ── */}
      {tab === "storyboard" && (
        <>
          {prereq && (
            <StageHint text={prereq.text} onGo={() => setTab(prereq.go)} />
          )}
          <div className="mt-4 flex gap-3">
            <Button
              type="button"
              onClick={() => setTab("storyboard")}
              className="h-auto rounded-xl px-6 py-3 text-[13px] font-semibold"
            >
              从剧本生成 16 镜
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setTab("script")}
              className="text-ink h-auto rounded-xl bg-white/4 px-6 py-3 text-[13px] font-semibold hover:bg-white/8"
            >
              导入剧本
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setTab("shots")}
              className="text-ink ml-auto h-auto rounded-xl bg-white/4 px-6 py-3 text-[13px] font-semibold hover:bg-white/8"
            >
              下一阶段 →
            </Button>
          </div>

          <section className="border-border bg-surface mt-5 rounded-2xl border p-5">
            <div className="mb-3 flex items-center justify-between">
              <span className="text-ink text-[13px] font-semibold">
                分镜脚本
              </span>
              <span className="bg-primary/12 text-primary rounded-lg px-4 py-1.5 text-[11px]">
                {gridShots.length} 镜
              </span>
            </div>
            <div className="grid grid-cols-4 gap-4">
              {gridShots.map((gridShot) => (
                <div
                  key={gridShot.idx}
                  className="bg-elevated relative h-[86px] rounded-[11px] p-3"
                >
                  <span
                    className="absolute top-3 right-3 h-2 w-2 rounded-full"
                    style={{ background: gridShot.color }}
                  />
                  <div className="text-muted-foreground truncate pr-6 text-[10.5px]">
                    {gridShot.heading}
                  </div>
                  <div className="text-ink mt-5 text-xs font-medium">
                    镜 {String(gridShot.idx + 1).padStart(2, "0")}
                  </div>
                  <div className="absolute top-1/2 right-2 h-11 w-[54px] -translate-y-1/2 rounded-md bg-white/3" />
                  <div className="absolute top-1/2 right-[22px] h-4 w-4 -translate-y-1/2 rounded-full bg-white/6" />
                </div>
              ))}
            </div>
          </section>

          <section className="border-border bg-surface mt-5 rounded-2xl border p-5">
            <h3 className="text-ink mb-3 text-[14px] font-semibold">
              分镜工具
            </h3>
            <StoryboardPlanner
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
            />
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
              <h3 className="text-ink text-[14px] font-semibold">生图工具</h3>
              <span className="text-muted-foreground rounded-lg bg-white/4 px-3 py-1 text-[11px]">
                图 {imageDoneCount}/{shots.length}
              </span>
            </div>
            <ShotStudio
              shots={shots}
              scenes={scenes}
              characters={characters}
              styles={styles}
              checkpoints={checkpoints}
              checkpoint={checkpoint}
              onCheckpointChange={setCheckpoint}
              apiChannels={apiChannels}
              onOpenApiSettings={openApiSettings}
              onShotsChange={setShots}
              onNextStage={() => setTab("video")}
            />
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
              <h3 className="text-ink text-[14px] font-semibold">视频工具</h3>
              <span className="text-muted-foreground rounded-lg bg-white/4 px-3 py-1 text-[11px]">
                片段 {clipDoneCount}/{shots.length}
              </span>
            </div>
            <VideoStudio
              shots={shots}
              checkpoints={checkpoints}
              checkpoint={checkpoint}
              onCheckpointChange={setCheckpoint}
              apiChannels={apiChannels}
              onOpenApiSettings={openApiSettings}
              onShotsChange={setShots}
              onPrevStage={() => setTab("shots")}
              onNextStage={() => setTab("render")}
            />
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
            <FinalComposer
              shots={shots}
              title={meta.title || "未命名项目"}
              onShotsChange={setShots}
              rendered={rendered}
              onRendered={markRendered}
            />
          </section>
        </>
      )}

      {/* Full-screen markdown script editor */}
      {isScriptEditorOpen && (
        <ScriptMarkdownEditor
          title={meta.title || "编辑剧本"}
          value={scriptMarkdown}
          onChange={setScriptMarkdown}
          onSave={saveScriptEditor}
          onCancel={closeScriptEditor}
        />
      )}
    </div>
  );
}
