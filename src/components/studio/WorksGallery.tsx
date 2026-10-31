"use client";

// ── 「所有项目」屏（视图层，规范 17 §17.2 第③层）─────────────────────────
//
// 取数与删除都在 `works/hooks/use-works-gallery.ts`（§17.2 第②层），本文件只把
// 它接成卡片网格 + 确认弹窗。此前这一屏自己读 `listProjects()` / `deleteProject()`
//（本地索引那一侧），于是**「服务端有一行、索引里没有」的项目在这里既看不见、
// 也删不掉** —— 那是 ISSUE #1522 问的口子。
//
// 一行分三种出处，界面上如实标出来（见 `use-works-gallery` 的三条口径）：
//   · 服务端独有 —— 标「仅服务端」。这不是给人看的装饰：删它动的是服务端那一份，
//     本机没有副本可回退；
//   · 本地独有   —— 标「未同步」。它还没推上去（或推送被拒），删它动的是本地那一份；
//   · 两侧都有   —— 不标，正常行。
//
// 本组件只做一件事：把这一屏渲染出来，附带悬停删除 + 弹窗确认。

import { Trash2 } from "lucide-react";

import { useToast } from "./ToastProvider";
import { AuroraBackground } from "~/components/ui/aurora-background";
import { DocumentFrame } from "~/components/studio/ViewContainer";
import { ConfirmDialog } from "~/components/ui/confirm-dialog";
import { Button } from "~/components/ui/button";
import { EmptyState } from "~/components/ui/empty-state";
import { PageHeader } from "~/components/ui/page-header";
import { timeAgo } from "~/lib/time-format";
import type { ProjectOrigin } from "~/lib/project-canvas/canvas-store";
import { PROJECTS_ENTRY } from "./NavItems";
import { useWorksGallery } from "./works/hooks/use-works-gallery";

/* 作品/视频项目卡**类别装饰色**——cyan 在这套 UI 里代表"视频/作品"类别
 * (与 `MaterialLibraryPanel KIND_STYLE.video` 蓝调装饰一脉相承)。是"这一
 * 类内容"的视觉身份,不是状态、也不是 info(信息态)——两者会互相消解。
 * §3.6.1 例外块。 */
// p71-allow:start 视频/作品类别装饰色——与素材库"视频"标签同族,不是状态语义
const WORKS_CATEGORY_ICON_BG = "bg-cyan-400/12 text-cyan-700 dark:text-cyan-400";
// p71-allow:end

/* 「这一行从哪来」的界面上那半句。`both` 不给值（正常行不标）。 */
const ORIGIN_BADGE: Partial<Record<ProjectOrigin, string>> = {
  local: "未同步",
  server: "仅服务端",
};

const ORIGIN_HINT: Partial<Record<ProjectOrigin, string>> = {
  local: "还没推上服务端（或推送被拒）—— 换设备时看不到这一份",
  server: "服务端有这一行，本机没有副本 —— 删掉它只动服务端那一份",
};

/** 卡片上那一行「画布体量」。 */
function bodySummary(nodeCount: number, edgeCount: number): string {
  return nodeCount > 0 ? `${nodeCount} 节点 · ${edgeCount} 连线` : "空画布";
}

export type WorksGalleryProps = {
  /** 打开一个项目（设为活跃 + 跳到项目主页）。 */
  onOpenCanvasProject?: (id: string) => void;
  /** 「新建创作」按钮触发 —— 项目页保留它作为跳到生成器的入口。 */
  onOpenTask?: (id: string) => void;
};

export function WorksGallery({ onOpenCanvasProject, onOpenTask }: WorksGalleryProps) {
  const toast = useToast();
  const controller = useWorksGallery(onOpenCanvasProject);
  const {
    cancelDelete,
    confirmDelete,
    deleting,
    loading,
    pendingDelete,
    projects,
    requestDelete,
    serverOk,
  } = controller;

  return (
    <DocumentFrame
      backdrop={<AuroraBackground />}
      className="px-4 pt-4 pb-8 sm:px-8 sm:pt-5 sm:pb-12"
      width="wide"
    >
      <PageHeader
        actions={
          <>
            <Button
              className="border-border text-ink-faint hover:text-ink-bright h-auto rounded-lg px-3 py-2"
              onClick={controller.refresh}
              variant="outline"
            >
              ↻ 刷新
            </Button>
            <Button
              className="h-auto rounded-lg px-4 py-2"
              onClick={() => onOpenTask?.("new")}
              variant="primary-solid"
            >
              新建创作
            </Button>
          </>
        }
        className="mb-8"
        /* 「服务端」这三个字要的是**视觉强调**，不是字面量星号：JSX 文本节点
           不解析 Markdown，裸写星号会把星号原样印到界面上（ISSUE #1522 收尾
           时撞到的排版 bug）。
           词边界也不能交给缩进：JSX 把换行处的空白当内容渲染，中文句子又不该
           有词间空格 —— 所以外层文本与 `<span>` 之间不留空白、也不把词切开，
           渲染出来才是「列表以服务端为准」。 */
        description={
          <>
            画布项目，按时间倒序排列。列表以
            <span className="text-ink-bright font-medium">服务端</span>
            为准，本地还没同步上去的也一并列出。
          </>
        }
        extra={
          !loading && !serverOk ? (
            /* 拉不到服务端那份时明说这一屏此刻是什么：不说的话，「服务端有行、
              这里看不见」与「本来就没有」在界面上长得一模一样（ISSUE #1522）。 */
            <p className="text-warning-strong mt-1 text-xs">
              服务端列表这一轮没拉到，下面只列出本机已有的项目；刷新可重试。
            </p>
          ) : null
        }
        title={`所有${PROJECTS_ENTRY.label}`}
      />

      {loading ? (
        <p className="text-ink-muted py-10 text-center text-sm">正在读取项目列表…</p>
      ) : projects.length > 0 ? (
        <section className="mb-10">
          <div className="mb-4 flex items-baseline justify-between">
            <h2 className="text-ink-strong text-sm font-semibold">
              画布项目{" "}
              <span className="text-ink-fainter ml-1 text-xs font-normal">({projects.length})</span>
            </h2>
            <span className="text-ink-fainter text-2xs">可继续编辑</span>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {projects.map((project) => {
              const nodeCount = project.nodes?.length ?? 0;
              const edgeCount = project.edges?.length ?? 0;
              const badge = ORIGIN_BADGE[project.origin];
              const hint = ORIGIN_HINT[project.origin];
              const displayName = project.name || "未命名项目";
              return (
                <div
                  className="group border-border-subtle bg-card relative rounded-2xl border transition-all hover:border-cyan-400/25 hover:bg-cyan-400/4"
                  key={project.id}
                >
                  <Button
                    className="flex h-auto w-full items-start gap-3 rounded-2xl p-3.5 text-left font-normal"
                    onClick={() => controller.openProject(project.id)}
                    variant="ghost"
                  >
                    <div
                      className={`mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-xl ${WORKS_CATEGORY_ICON_BG}`}
                    >
                      <svg
                        fill="none"
                        height="16"
                        stroke="currentColor"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth="2"
                        viewBox="0 0 24 24"
                        width="16"
                      >
                        <rect height="18" rx="2" width="18" x="3" y="3" />
                        <path d="M3 9h18M9 21V9" />
                        <circle cx="15" cy="15" r="2" />
                      </svg>
                    </div>
                    <div className="min-w-0 flex-1">
                      {/* 标题要让出右上角那颗悬停删除按钮的宽度。
                          删除按钮是**绝对定位**的，不参与 flex 分配 —— 标题若
                          铺满整行，长名字会径直压到「删除」两个字底下（用户看到
                          的是两段字叠在一起）。`pr-*` 在这里是给它的**让位**，
                          不是内边距：宽度不够时标题先截断，按钮始终完整。 */}
                      <p className="text-ink-bright group-hover:text-ink truncate pr-12 text-sm font-medium">
                        {displayName}
                      </p>
                      <p className="text-ink-muted text-2xs mt-1 truncate">
                        {bodySummary(nodeCount, edgeCount)}
                      </p>
                      <p className="text-ink-fainter text-2xs mt-0.5">
                        {timeAgo(project.updatedAt, { suffix: "修改" }) ?? "刚刚修改"}
                      </p>
                    </div>
                  </Button>

                  {/* 出处标：只给「只在一侧」的行。`both` 是正常行，标出来是噪声。 */}
                  {badge && (
                    <span
                      className="text-ink-fainter border-border-subtle bg-surface-2 text-3xs absolute bottom-2.5 left-3.5 rounded-md border px-1.5 py-0.5"
                      title={hint}
                    >
                      {badge}
                    </span>
                  )}

                  {/* 逐卡片删除：仅悬停显示，右上角。
                       阻断冒泡，好让父级卡片打开按钮不触发。
                       带不透明底 + `z-base`（规范 16 §16.2.5 刻度表里「卡片内
                       遮罩」那一档）：标题靠 `pr-12` 让位是**主**防线，这里是
                       **兜底** —— 万一别的文案更宽，按钮也不会被字透出来。 */}
                  <Button
                    aria-label={`删除项目「${displayName}」`}
                    className="text-ink-muted hover:bg-danger/15 hover:text-danger-strong text-2xs bg-card z-base absolute top-2 right-2 h-auto gap-1 rounded-md px-1.5 py-1 whitespace-nowrap opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                    onClick={(event) => {
                      event.stopPropagation();
                      requestDelete(project.id);
                    }}
                    size="xs"
                    variant="ghost"
                  >
                    <Trash2 data-icon="inline-start" size={12} />
                    <span>删除</span>
                  </Button>
                </div>
              );
            })}
          </div>
        </section>
      ) : (
        <section>
          <EmptyState
            description="点击右上角「新建创作」开始你的第一个工作流，或者在工作流库载入模板。"
            icon={
              <span
                className={`flex size-14 items-center justify-center rounded-2xl ${WORKS_CATEGORY_ICON_BG}`}
              >
                <svg
                  aria-hidden
                  fill="none"
                  height="22"
                  stroke="currentColor"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  viewBox="0 0 24 24"
                  width="22"
                >
                  <rect height="18" rx="2" width="18" x="3" y="3" />
                  <path d="M3 9h18M9 21V9" />
                  <circle cx="15" cy="15" r="2" />
                </svg>
              </span>
            }
            minHeightClass="min-h-90"
            title="还没有画布项目"
          />
        </section>
      )}

      {/* ── 删除确认 ─────────────────────────────────────
          文案按出处分叉：删「仅服务端」那一行动的是**服务端**的副本（本机没有
          可回退的东西），而删正常行两边一起动 —— 说成同一句会让用户在删完一个
          别处的画布之后才知道删的是什么。 */}
      <ConfirmDialog
        cancelLabel="取消"
        confirmLabel="删除项目"
        danger
        description={
          pendingDelete
            ? pendingDelete.origin === "server"
              ? `即将从服务端永久删除「${pendingDelete.name || "未命名项目"}」。\n` +
                `本机没有它的副本，删除后无法恢复。`
              : `即将永久删除「${pendingDelete.name || "未命名项目"}」。\n` +
                `该操作不可撤销，画布内的节点与连线将一并丢失。`
            : ""
        }
        onClose={cancelDelete}
        onConfirm={() => {
          void confirmDelete().then((name) => {
            if (name) {
              toast.success(`已删除项目「${name}」`);
            }
          });
        }}
        open={pendingDelete !== null}
        pending={deleting}
        title={pendingDelete?.origin === "server" ? "删除服务端上的这条项目？" : "删除此画布项目？"}
      />
    </DocumentFrame>
  );
}
