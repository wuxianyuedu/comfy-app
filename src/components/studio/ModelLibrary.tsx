"use client";

import { useState, type CSSProperties } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { AuroraBackground } from "~/components/ui/aurora-background";
import { textHandler } from "~/lib/form-props";
import { Icon } from "~/components/ui/icon";
import { InputGroup, InputGroupAddon, InputGroupInput } from "~/components/ui/input-group";
import { Button, ButtonLink } from "~/components/ui/button";
import { Spinner } from "~/components/ui/spinner";
import { EmptyState } from "~/components/ui/empty-state";
import { PageHeader } from "~/components/ui/page-header";
import { Skeleton } from "~/components/ui/skeleton";
import { pageHeaderTitle } from "./NavItems";
import { cn } from "~/lib/utils";

import { DocumentFrame } from "./ViewContainer";
import { ViewActions } from "./ViewActions";
import { useModelLibrary } from "./hooks/use-model-library";
import { type ModelFolder, type ModelRow, fmtSize } from "./model-library-config";
import { EMBEDDED_SCROLL_MAX_HEIGHT } from "~/components/ui/overlay-max-height";

/**
 * 工作室模型库 —— 视图层（规范 17 §17.2 第③层）。
 * 列表拉取与目录选择在 hooks/use-model-library.ts，派生计算与常量在
 * model-library-config.ts。本文件只渲染；对外导出名与 props 保持不变。
 *
 * 布局（ISSUE #3368）：左侧一列目录、右侧是该目录的紧凑模型列表。
 * 所有 ComfyUI 目录默认启用，不再提供「模型目录配置」与类型筛选 chip。
 */
export function ModelLibrary() {
  const c = useModelLibrary();

  return (
    <DocumentFrame
      backdrop={<AuroraBackground />}
      className="px-4 pt-4 pb-6 sm:px-8 sm:pt-5 sm:pb-8"
      width="wide"
    >
      {/* 页头的名字走 `pageHeaderTitle("models")` —— 与侧栏 / 页签同一个出处
          （注册表 `NavItems.tsx`）。 */}
      <PageHeader srTitle={pageHeaderTitle("models")} />

      {/* 搜索挂到顶栏（`ViewActions`）：留在屏内就是「左边一整行空气 + 右边一颗控件」
          （ISSUE #1871）。搜索框在顶栏里收窄了宽度档（`sm:w-64` → `w-56`）。 */}
      <ViewActions>
        <InputGroup className="w-40 shrink-0 sm:w-56">
          <InputGroupAddon>
            <Icon aria-hidden className="opacity-60" name="search" />
          </InputGroupAddon>
          <InputGroupInput
            aria-label="搜索模型名称"
            onChange={textHandler(c.setQ)}
            placeholder="搜索模型名称…"
            value={c.q}
          />
        </InputGroup>
        {/* 后台同步指示：sync 在首屏之后重扫全部目录，这里只报「在同步」，
            不挡内容（首屏数据已经是上一轮的存量）。 */}
        {!c.loading && c.refreshing && (
          <span className="text-ink-faint flex items-center gap-1.5 text-xs">
            <Spinner className="size-3.5" />
            同步中…
          </span>
        )}
      </ViewActions>

      {c.loading ? (
        <ModelListSkeleton />
      ) : c.models.length === 0 ? (
        <EmptyState
          action={
            c.comfyuiPathConfigured ? undefined : (
              <ButtonLink
                className="h-auto gap-1.5 px-4 py-2"
                href="/settings"
                variant="primary-solid"
              >
                <Icon data-icon="inline-start" name="settings" size={16} />
                去设置
              </ButtonLink>
            )
          }
          description={
            c.comfyuiPathConfigured
              ? "把模型文件放进 ComfyUI 的模型目录后，重新扫描即可在此查看。"
              : "还没有配置 ComfyUI 安装路径。在「设置」里填写路径后，模型库会自动扫描所有目录。"
          }
          minHeightClass="min-h-75"
          title={c.comfyuiPathConfigured ? "模型库里还没有模型" : "ComfyUI 还没有配置"}
        />
      ) : (
        <div className="flex gap-4">
          <ModelFolderNav
            activeFolder={c.activeFolder}
            folders={c.folders}
            onSelect={c.setActiveFolder}
          />
          <div className="min-w-0 flex-1">
            {c.filtered.length === 0 ? (
              <EmptyState
                description={`当前目录里没有匹配「${c.q}」的模型。`}
                minHeightClass="min-h-40"
                title="没有匹配的模型"
              />
            ) : (
              <ModelList items={c.filtered} />
            )}
          </div>
        </div>
      )}
    </DocumentFrame>
  );
}

/**
 * 左侧目录列 —— 目录清单由已同步的模型派生（目录名即模型类型，行内是展示名 + 数量）。
 * 选中态走 `aria-current`，与设置页左侧分区导航同一条契约。
 */
function ModelFolderNav({
  folders,
  activeFolder,
  onSelect,
}: {
  activeFolder: string | null;
  folders: Array<ModelFolder>;
  onSelect: (folder: string) => void;
}) {
  return (
    <nav
      aria-label="模型目录"
      className={`custom-scrollbar w-44 shrink-0 overflow-y-auto pb-2 ${EMBEDDED_SCROLL_MAX_HEIGHT}`}
    >
      <div className="flex flex-col gap-0.5">
        {folders.map((folder) => {
          const active = folder.type === activeFolder;
          return (
            <Button
              aria-current={active ? "true" : undefined}
              className={cn(
                "h-auto w-full justify-between gap-2 rounded-lg px-3 py-1.5 text-sm font-medium",
                active
                  ? "bg-primary-soft text-primary-strong hover:bg-primary-soft hover:text-primary-strong"
                  : "text-ink-muted hover:text-ink",
              )}
              key={folder.type}
              onClick={() => {
                onSelect(folder.type);
              }}
              size="sm"
              variant="ghost"
            >
              <span className="truncate">{folder.label}</span>
              <span className="text-ink-faint shrink-0 text-xs tabular-nums">{folder.count}</span>
            </Button>
          );
        })}
      </div>
    </nav>
  );
}

const MODEL_ROW_H = 29; // px，单行（truncate 不换行）：py-1.5 + text-xs 行高 + 1px 分隔

/**
 * 首屏骨架 —— 与真实行同形的占位（文件名 + 大小）。不是一行「加载中…」：那行小字之外是大片空白，读者既不知要等多久、也不知等出来长什么样（反馈原话「一打开就是这个丑的加载界面」）。
 * 骨架给出**最终形态的预览**，且 list 回包即替换 —— 首屏只等 DB 存量（ms 级），后台的目录同步不再挡在它前面。
 * `role="status"` 让读屏播报「正在加载模型列表」；条块本身无文字，不会被念成一串噪音。
 */
function ModelListSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <div
      aria-label="正在加载模型列表"
      className={`border-border-subtle bg-card ${EMBEDDED_SCROLL_MAX_HEIGHT} overflow-auto rounded-xl border`}
      role="status"
    >
      {Array.from({ length: rows }, (_, i) => (
        <div
          className={`flex items-center gap-3 px-3 py-1.5 ${
            i === rows - 1 ? "" : "border-border-subtle border-b"
          }`}
          key={i}
        >
          <Skeleton className="h-4 flex-1" style={{ maxWidth: `${64 - i * 5}%` }} />
          <Skeleton className="h-3 w-12 shrink-0" />
        </div>
      ))}
    </div>
  );
}

/**
 * 模型文件列表 —— 定高虚拟滚动（规范 §2.6）。行数上探三位数时只渲染视口内的
 * 一段，DOM 数量恒定；量不到视口高度（jsdom 不做布局 / 首帧未测量）时退回
 * 整页渲染 —— 虚拟化是性能优化，绝不能变成「内容看不见」（同 LogPanel 口径）。
 */
function ModelList({ items }: { items: Array<ModelRow> }) {
  const [scrollEl, setScrollEl] = useState<HTMLDivElement | null>(null);
  // virtualizer 的读数（getVirtualItems/getTotalSize）只在本组件 render 内消费，
  // 不外传给被 memo 的子组件，不存在该规则担心的「跨组件陈旧 UI」风险，此告警对本用法是误报。
  // oxlint-disable-next-line react/incompatible-library
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollEl,
    estimateSize: () => MODEL_ROW_H,
    overscan: 12,
  });
  const measured = (scrollEl?.clientHeight ?? 0) > 0;

  return (
    <div
      aria-label="模型文件列表"
      className={`border-border-subtle bg-card ${EMBEDDED_SCROLL_MAX_HEIGHT} overflow-auto rounded-xl border`}
      ref={setScrollEl}
      role="list"
    >
      {measured ? (
        <div
          style={{
            height: virtualizer.getTotalSize(),
            position: "relative",
            width: "100%",
          }}
        >
          {virtualizer.getVirtualItems().map((vi) => {
            const m = items[vi.index];
            if (!m) {
              return null;
            }
            return (
              <ModelRowLine
                isLast={vi.index === items.length - 1}
                key={vi.key}
                model={m}
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: "100%",
                  height: vi.size,
                  transform: `translateY(${vi.start}px)`,
                }}
              />
            );
          })}
        </div>
      ) : (
        items.map((m, idx) => (
          <ModelRowLine isLast={idx === items.length - 1} key={m.id} model={m} />
        ))
      )}
    </div>
  );
}

function ModelRowLine({
  model,
  isLast,
  style,
}: {
  isLast: boolean;
  model: ModelRow;
  style?: CSSProperties;
}) {
  return (
    <div
      className={`group hover:bg-subtle flex items-center gap-3 px-3 py-1.5 transition-colors ${
        isLast ? "" : "border-border-subtle border-b"
      }`}
      role="listitem"
      style={style}
    >
      <span
        className="text-ink-bright min-w-0 flex-1 truncate font-mono text-xs"
        title={model.fileName}
      >
        {model.fileName}
      </span>
      {!model.isAvailable && (
        <span
          className="bg-surface-2 text-ink-faint text-3xs shrink-0 rounded-md px-1.5 py-0.5"
          title="当前未在 ComfyUI 扫描结果中"
        >
          不可用
        </span>
      )}
      <span className="text-ink-muted shrink-0 text-xs tabular-nums" title="文件大小">
        {fmtSize(model.fileSize)}
      </span>
    </div>
  );
}
