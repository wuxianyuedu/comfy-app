"use client";

// 工作流「说明」页签：列出 note 节点的正文，逐条翻译成中文（ISSUE #4963）。
// 纯展示 + 一个网络状态 hook（useWorkflowNoteTranslation 承载网络，这里只渲染）。

import { FolderOpen, Languages, RotateCw } from "lucide-react";

import { Button } from "~/components/ui/button";
import { Spinner } from "~/components/ui/spinner";
import { extractNoteTitle } from "~/components/studio/workflow-utils";
import type { WorkflowNote } from "~/components/studio/workflow-types";
import { useWorkflowNoteTranslation } from "../hooks/use-workflow-note-translation";

type WorkflowNotesTabProps = {
  notes: ReadonlyArray<WorkflowNote>;
};

/** 页签级空态：与「参考图装载」等轻页签同款形态。 */
function TabEmpty() {
  return (
    <div className="text-ink-fainter flex min-h-0 flex-1 flex-col items-center justify-center gap-3">
      <div className="border-border bg-subtle flex size-16 items-center justify-center rounded-2xl border">
        <FolderOpen className="size-7 opacity-40" />
      </div>
      <p className="text-sm">这条工作流没有说明（note）节点</p>
      <p className="text-muted-foreground/70 text-2xs">
        在工作流编辑器里加 note 节点写说明，这里就能查看并翻译成中文
      </p>
    </div>
  );
}

export function WorkflowNotesTab({ notes }: WorkflowNotesTabProps) {
  const { stateFor, translate } = useWorkflowNoteTranslation();

  if (notes.length === 0) {
    return <TabEmpty />;
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-muted-foreground text-2xs">
        工作流内 note 节点的说明正文（共 {notes.length} 条）。点「翻译成中文」用已配置的 LLM 翻译，
        节点名 / 参数名等技术词会原样保留。
      </p>
      <ul className="flex flex-col gap-3">
        {notes.map((note) => {
          const state = stateFor(note.id, note.text);
          const title = extractNoteTitle(note.text, note.title) || "说明";
          return (
            <li className="border-border/60 bg-surface rounded-xl border p-4" key={note.id}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span
                    aria-hidden="true"
                    className="size-2 shrink-0 rounded-full"
                    style={{ background: note.color || "var(--color-primary)" }}
                  />
                  <h3 className="text-ink text-sm font-medium">{title}</h3>
                </div>
                <Button
                  className="text-2xs h-auto shrink-0"
                  disabled={state.loading}
                  onClick={() => {
                    void translate(note.id, note.text);
                  }}
                  variant="outline"
                >
                  {state.loading ? (
                    <Spinner className="size-3" data-icon="inline-start" />
                  ) : state.text ? (
                    <RotateCw className="size-3" data-icon="inline-start" />
                  ) : (
                    <Languages className="size-3" data-icon="inline-start" />
                  )}
                  {state.loading ? "翻译中…" : state.text ? "重新翻译" : "翻译成中文"}
                </Button>
              </div>

              <div className="mt-3">
                <p className="text-muted-foreground text-2xs mb-1">原文</p>
                <pre className="text-ink-soft text-2xs bg-canvas-deep overflow-x-auto rounded-md p-3 leading-relaxed whitespace-pre-wrap">
                  {note.text || "（空说明）"}
                </pre>
              </div>

              {state.text && (
                <div className="mt-3">
                  <p className="text-muted-foreground text-2xs mb-1">中文译文</p>
                  <pre className="text-ink-soft text-2xs border-primary/30 bg-primary/5 overflow-x-auto rounded-md border p-3 leading-relaxed whitespace-pre-wrap">
                    {state.text}
                  </pre>
                </div>
              )}

              {state.error && (
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <p className="text-danger text-2xs">翻译失败：{state.error}</p>
                  <Button
                    className="text-2xs h-auto"
                    onClick={() => {
                      void translate(note.id, note.text);
                    }}
                    variant="ghost"
                  >
                    <RotateCw className="size-3" data-icon="inline-start" />
                    重试
                  </Button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
