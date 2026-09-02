"use client";

// 工坊中间列：按当前阶段分发内容。
// 纯展示 + 事件上抛：这里不持有任何业务规则，数据来自 controller。

import { Button } from "~/components/ui/button";
import { Icon } from "~/components/ui/icon";
import { Textarea } from "~/components/ui/textarea";
import type { WorkshopPipelineController } from "~/components/workshop/hooks/use-workshop-pipeline";
import { CharacterDesigner } from "~/components/workshop/CharacterDesigner";
import { FinalComposer } from "~/components/workshop/FinalComposer";
import { LLMStatusChip } from "~/components/workshop/LLMContext";
import { ScriptGenerator } from "~/components/workshop/ScriptGenerator";
import { ScriptMarkdownEditor } from "~/components/workshop/ScriptMarkdownEditor";
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
    outline,
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
    draftSavedAt,
    editingOutline,
    draftOutline,
    isScriptEditorOpen,
    notice,
    rendered,
    generateShot,
    beginOutlineEdit,
    cancelOutlineEdit,
    saveOutline,
    setDraftOutline,
    openScriptEditor,
    closeScriptEditor,
    saveScriptEditor,
    openApiSettings,
    markRendered,
    dismissNotice,
  } = controller;

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
          <section className="border-border bg-surface rounded-2xl border p-5">
            <div className="mb-3 flex items-center justify-between">
              <span className="text-ink text-[13px] font-semibold">故事大纲</span>
              <div className="flex items-center gap-2">
                {draftSavedAt && !editingOutline && (
                  <span
                    className="text-[10px] text-muted-foreground"
                    title="剧本内容自动保存在本机浏览器，刷新/重启后仍在"
                  >
                    已自动保存{" "}
                    {draftSavedAt.toLocaleTimeString("zh-CN", {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                )}
                {!editingOutline ? (
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={beginOutlineEdit}
                    className="text-ink rounded-lg bg-white/4 px-4 py-1.5 text-xs font-medium hover:bg-white/8"
                  >
                    编辑
                  </Button>
                ) : (
                  <>
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={cancelOutlineEdit}
                      className="text-ink rounded-lg bg-white/4 px-4 py-1.5 text-xs font-medium hover:bg-white/8"
                    >
                      取消
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={saveOutline}
                      className="bg-primary/12 text-primary hover:bg-primary/18 rounded-lg px-4 py-1.5 text-[11px]"
                    >
                      保存
                    </Button>
                  </>
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
            {editingOutline ? (
              <Textarea
                value={draftOutline}
                onChange={(event) => setDraftOutline(event.target.value)}
                rows={4}
                className="border-border bg-bg text-ink ring-primary/30 min-h-24 w-full resize-none rounded-xl p-3 text-[12.5px] leading-relaxed transition outline-none focus:border-primary/50 focus:ring-2"
                placeholder="输入故事大纲……"
              />
            ) : outline ? (
              <p className="text-muted-foreground text-[12.5px] leading-relaxed">
                {outline}
              </p>
            ) : (
              <p className="text-muted-foreground/60 text-[12.5px] leading-relaxed italic">
                暂无大纲——点击「编辑」输入故事大纲，或在下方用一句话梗概 /
                智能辅助结构化开始。
              </p>
            )}
          </section>

          <section className="border-border bg-surface mt-5 rounded-2xl border p-5">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-ink text-[14px] font-semibold">剧本工具</h3>
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

      {/* ── Tab: Character ── */}
      {tab === "character" && (
        <>
          {prereq && (
            <StageHint text={prereq.text} onGo={() => setTab(prereq.go)} />
          )}
          <section className="border-border bg-surface mt-4 rounded-2xl border p-5">
            <h3 className="text-ink mb-3 text-[14px] font-semibold">角色工具</h3>
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
              <span className="text-ink text-[13px] font-semibold">分镜脚本</span>
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
            <h3 className="text-ink mb-3 text-[14px] font-semibold">分镜工具</h3>
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
