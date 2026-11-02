"use client";

import { useState, type CSSProperties } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { AuroraBackground } from "~/components/ui/aurora-background";
import { textHandler } from "~/lib/form-props";
import { Hint } from "~/components/ui/hint";
import { Icon } from "~/components/ui/icon";
import { Input } from "~/components/ui/input";
import { InputGroup, InputGroupAddon, InputGroupInput } from "~/components/ui/input-group";
import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import { FieldLabel } from "~/components/ui/field";
import { Spinner } from "~/components/ui/spinner";
import { EmptyState } from "~/components/ui/empty-state";
import { PageHeader } from "~/components/ui/page-header";
import { SelectChip } from "~/components/ui/select-chip";
import { Skeleton } from "~/components/ui/skeleton";
import { pageHeaderTitle } from "./NavItems";
import { folderMeta, getFolderTooltip } from "~/lib/model-types";

import { DocumentFrame } from "./ViewContainer";
import { ViewActions } from "./ViewActions";
import { useModelFolderConfig } from "./hooks/use-model-folder-config";
import { useModelLibrary } from "./hooks/use-model-library";
import {
  ALL_TYPES,
  type FolderConfigRow as FolderConfigRowData,
  type ModelRow,
  fmtSize,
} from "./model-library-config";
import { Dialog, DialogContent } from "~/components/ui/dialog";
import { EMBEDDED_SCROLL_MAX_HEIGHT, OVERLAY_MAX_HEIGHT } from "~/components/ui/overlay-max-height";

/**
 * 工作室模型库 —— 视图层（规范 17 §17.2 第③层）。
 * 列表拉取与筛选在 hooks/use-model-library.ts，派生计算与常量在
 * model-library-config.ts。本文件只渲染；对外导出名与 props 保持不变。
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
          （注册表 `NavItems.tsx`）。此前这里是裸字面量「模型库」，而注册表里
          那一项叫「模型」：两名并存，且 `page-name-single-source` 的第 4 条锚的是
          `<h1>纯文本</h1>`、看不见 prop 里的字面量（ISSUE #1673）。 */}
      <PageHeader srTitle={pageHeaderTitle("models")} />

      {/* 目录配置 / 搜索挂到顶栏（`ViewActions`）：留在屏内就是「左边一整行空气 +
          右边两颗控件」那一行（ISSUE #1871）。搜索框在顶栏里收窄了宽度档
          （`sm:w-64` → `w-56`），免得把全局控件挤到换行。 */}
      <ViewActions>
        <Button
          className="border-border bg-subtle text-ink-bright hover:border-primary/40 hover:text-primary-strong gap-1.5"
          onClick={() => {
            c.setConfigOpen(true);
          }}
          variant="outline"
        >
          <Icon data-icon="inline-start" name="settings" size={16} />
          模型目录配置
        </Button>
        {/* 搜索走 `ui/input-group` 基元（与 ⌘K 那一枚同款）：此前这里是裸
            `<input>` 自拼尺寸 + 写死的 `focus:border-violet-500/40`，既绕开了
            输入框唯一的出口，焦点色也不跟品牌走（规范 03 §3.6.2）。高度交给
            基元的 h-8，与顶栏其余控件同档。 */}
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
      </ViewActions>

      {/* 一档都筛不出来时不渲染这一排：库里 0 个模型时它只剩孤零零一枚
          「全部 (0)」，点它什么也不会发生，而下方空态已经在说同一件事。 */}
      {(c.loading || c.models.length > 0) && (
        <div
          aria-label="按类型筛选模型"
          className="mb-5 flex flex-wrap items-center gap-2"
          role="radiogroup"
        >
          {c.loading ? (
            /* 首屏骨架的档位占位：与真实 chip 同高同圆角，避免「全部 (0)」
             * 先闪一秒再变成真 chips（数量从 0 跳上去比不显示更吵）。
             * 占位一律走 `ui/skeleton` 基元（P3：不许在视图里手写 animate-pulse）。 */
            <>
              <Skeleton className="h-7 w-16 rounded-full" />
              <Skeleton className="h-7 w-20 rounded-full" />
              <Skeleton className="h-7 w-14 rounded-full" />
            </>
          ) : (
            <>
              <SelectChip
                onClick={() => {
                  c.setFilter(ALL_TYPES);
                }}
                selected={c.filter === ALL_TYPES}
              >
                {`全部 (${c.models.length})`}
              </SelectChip>
              {c.typeChips.map(([t, count]) => {
                const meta = folderMeta(t);
                return (
                  <SelectChip
                    key={t}
                    onClick={() => {
                      c.setFilter(t);
                    }}
                    selected={c.filter === t}
                  >
                    {`${meta.label} (${count})`}
                  </SelectChip>
                );
              })}
            </>
          )}
          {/* 后台同步指示：sync 在首屏之后重扫目录，这里只报「在同步」，
              不挡内容（首屏数据已经是上一轮的存量）。 */}
          {!c.loading && c.refreshing && (
            <span className="text-ink-faint ml-auto flex items-center gap-1.5 text-xs">
              <Spinner className="size-3.5" />
              同步中…
            </span>
          )}
        </div>
      )}

      {c.loading ? (
        <ModelListSkeleton />
      ) : c.filtered.length === 0 ? (
        <EmptyState
          action={
            /* 空态里唯一能解决问题的那一颗 → 实心档。此前是软底 `primary`，
               与它下面那句说明同色阶，读起来像又一条描述而不是出口。
               不再补 `mt-4`：`EmptyState` 的 EmptyContent 已经给了 mt-3，
               两处叠加会把说明与按钮之间撑成 28px。 */
            <Button
              className="h-auto gap-1.5 px-4 py-2"
              onClick={() => {
                c.setConfigOpen(true);
              }}
              variant="primary-solid"
            >
              <Icon data-icon="inline-start" name="settings" size={16} />
              去配置目录
            </Button>
          }
          description="没启用任何模型目录时这里为空。打开「模型目录配置」勾选需要扫描的目录，重新扫描后即可在此查看。"
          minHeightClass="min-h-75"
          title="模型库还没有内容"
        />
      ) : (
        // 紧凑列表 —— 每行是 [类型药丸][文件名][大小]。
        // 旧的卡片栅格（4 列 + 28px 占位图标 + 重复的 fileName）
        // 太重；对最终只是「一行文件名 + 大小」的这种负载，
        // N 行画廊可读性好得多。行数可能上探到三位数（LoRA/ckpt 混放），
        // 交给 ModelList 做定高虚拟滚动（量不到视口时退回整页渲染）。
        <ModelList items={c.filtered} />
      )}

      {c.configOpen && (
        <ModelConfigModal
          onClose={() => {
            c.setConfigOpen(false);
            c.reload();
          }}
        />
      )}
    </DocumentFrame>
  );
}

const MODEL_ROW_H = 37; // px，单行（truncate 不换行）：py-2 + text-sm 行高 + 1px 分隔

/**
 * 首屏骨架 —— 与真实行同形的占位（类型药丸 + 文件名 + 大小）。
 *
 * 为什么不是一行「加载中…」：那行小字之外是大片空白，读者既不知道
 * 要等多久、也不知道等出来长什么样（反馈原话「一打开就是这个丑的加载
 * 界面」）。骨架给出**最终形态的预览**，且 list 回包即替换 —— 现在
 * 首屏只等 DB 存量（ms 级），后台的目录同步不再挡在它前面。
 *
 * `role="status"`：读屏播报「正在加载模型列表」；条块本身无文字，
 * 不会被念成一串噪音。
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
          className={`flex items-center gap-3 px-3 py-2 ${
            i === rows - 1 ? "" : "border-border-subtle border-b"
          }`}
          key={i}
        >
          <Skeleton className="h-5 w-14 shrink-0" />
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
  // eslint-disable-next-line react-hooks/incompatible-library
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
  const meta = folderMeta(model.type);
  return (
    <div
      className={`group hover:bg-subtle flex items-center gap-3 px-3 py-2 transition-colors ${
        isLast ? "" : "border-border-subtle border-b"
      }`}
      role="listitem"
      style={style}
    >
      <span className={`text-2xs shrink-0 rounded-md px-2 py-0.5 font-medium ${meta.color}`}>
        {meta.label}
      </span>
      <span
        className="text-ink-bright) min-w-0 flex-1 truncate font-mono text-sm"
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

/* ── 模型目录配置弹窗 ──
 * 呈现扫描器能访问的每个 ComfyUI 目录。每行的类型
 * 由目录名自动解析（精选查表 → 模糊匹配
 * → CHECKPOINT 兜底），所以用户只需启用 / 停用
 * 目录 —— 不用选类型。每行的「高级」面板让
 * 用户追加*额外*的 COMBO 字段类型（例如把该文件夹的文件
 * 额外暴露在另一个字段下）。 */
/**
 * 模型目录配置弹层 —— 视图层（规范 17 §17.2 第③层）。
 * 列表拉取、启用/停用/删除与重新扫描在 hooks/use-model-folder-config.ts。
 */
function ModelConfigModal({ onClose }: { onClose: () => void }) {
  const c = useModelFolderConfig();

  /* 关闭语义（Esc / 点遮罩 / 焦点锁与归还）交给`ui/dialog`：此前把遮罩写成
 一个**兄弟 div** 单独接`onClick`（与全库其余弹窗的「外层带 onClick +
 内层 stopPropagation」又是一种写法），Esc 没接、焦点不锁也不归还。 */
  return (
    <Dialog
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      open
    >
      <DialogContent
        aria-label="模型库"
        className="bg-transparent p-0 ring-0"
        popupClassName="max-w-3xl"
        showCloseButton={false}
      >
        <div
          className={`border-border bg-panel relative flex ${OVERLAY_MAX_HEIGHT} w-full max-w-3xl flex-col overflow-hidden rounded-2xl border shadow-2xl shadow-black/25 dark:shadow-black/50`}
        >
          {/* header */}
          <div className="border-border-subtle flex items-start justify-between border-b px-5 py-4">
            <div>
              <h2 className="text-ink flex items-center gap-2 text-base font-semibold">
                <Icon className="text-primary-strong" name="foldertree" size={18} />
                模型目录配置
              </h2>
              <p className="text-ink-muted mt-0.5 text-xs">
                勾选需要扫描的 ComfyUI
                模型目录；每个目录即独立模型类型（目录名即类型名）。禁用后该目录模型将从模型库与画布
                COMBO 下拉中隐藏。
              </p>
            </div>
            <Button
              aria-label="关闭"
              className="text-ink-muted hover:bg-surface-2 hover:text-ink-bright rounded-lg"
              onClick={onClose}
              size="icon-sm"
              variant="ghost"
            >
              <Icon data-icon="inline-start" name="close" size={18} />
            </Button>
          </div>

          {/* status + scan */}
          <div className="border-border-subtle flex items-center justify-between gap-3 border-b px-5 py-3">
            <div className="flex items-center gap-3 text-xs">
              {c.loading ? (
                /* 还没拿到答案时不许报「已连接」，也不许报「未连接」——那一格既不是
                 * 绿也不是红，只是没测到（与 §13.6.4.1 同一条口径）。 */
                <span className="text-ink-muted">● 正在检测 ComfyUI…</span>
              ) : c.comfyReachable ? (
                <span className="text-success-strong">
                  ● ComfyUI 已连接 · 共 {c.totalCount} 个目录
                </span>
              ) : (
                <span className="text-warning-strong">● ComfyUI 未连接</span>
              )}
              <span className="text-ink-muted">· 已启用 {c.enabledRows.length} 个</span>
              {c.err && <span className="text-destructive">{c.err}</span>}
            </div>
            <Button
              className="border-border bg-subtle text-ink-bright hover:border-primary/40 hover:text-primary h-auto gap-1.5 rounded-lg px-3 py-1.5"
              disabled={c.scanning}
              // oxlint-disable-next-line no-void -- reject 由 action 内部捕获
              onClick={() => void c.rescan()}
              size="xs"
              variant="outline"
            >
              {c.scanning ? (
                <Spinner className="size-3.5" />
              ) : (
                <Icon data-icon="inline-start" name="shuffle" size={14} />
              )}
              {c.scanning ? "扫描中…" : "重新扫描"}
            </Button>
          </div>

          {/* search + filter */}
          <div className="flex items-center gap-3 px-5 py-3">
            <Input
              aria-label="搜索目录名"
              className="bg-subtle flex-1"
              onChange={textHandler(c.setQ)}
              placeholder="搜索目录名…"
              value={c.q}
            />
            <FieldLabel className="text-ink-faint flex shrink-0 cursor-pointer items-center gap-2 text-xs">
              <Checkbox
                checked={c.onlyEnabled}
                className="border-border-strong bg-surface-2 text-primary-strong focus:ring-primary/40 size-3.5 rounded"
                onCheckedChange={(checked) => {
                  c.setOnlyEnabled(checked === true);
                }}
              />
              仅显示已启用
            </FieldLabel>
          </div>

          {/* list */}
          <div className="flex-1 overflow-y-auto px-5 pb-5">
            {c.loading ? (
              <p className="text-ink-muted text-sm">加载中…</p>
            ) : c.totalCount === 0 ? (
              <EmptyState
                description={
                  c.comfyReachable
                    ? "ComfyUI 中没有可识别的模型目录。"
                    : "未连接 ComfyUI；请先启动本地 ComfyUI。"
                }
                minHeightClass="min-h-40"
              />
            ) : (
              <>
                {c.enabledRows.length > 0 && (
                  <section className="mb-6">
                    <div className="mb-2 flex items-center justify-between">
                      <h3 className="text-ink-faint text-xs font-medium tracking-wide uppercase">
                        已启用 · {c.enabledRows.length}
                      </h3>
                    </div>
                    <div className="flex flex-col gap-2">
                      {c.enabledRows.map((row) => (
                        <FolderConfigRow
                          key={row.folder}
                          onAdd={c.add}
                          onDelete={c.remove}
                          onToggle={c.toggle}
                          row={row}
                        />
                      ))}
                    </div>
                  </section>
                )}

                {!c.onlyEnabled && c.availableRows.length > 0 && (
                  <section>
                    <div className="mb-2 flex items-center justify-between">
                      <h3 className="text-ink-faint text-xs font-medium tracking-wide uppercase">
                        可添加 · {c.availableRows.length}
                      </h3>
                      <p className="text-ink-muted text-xs">点「启用」加入扫描列表</p>
                    </div>
                    <div className="flex flex-col gap-2">
                      {c.availableRows.map((row) => (
                        <FolderConfigRow
                          key={row.folder}
                          onAdd={c.add}
                          onDelete={c.remove}
                          onToggle={c.toggle}
                          row={row}
                        />
                      ))}
                    </div>
                  </section>
                )}
              </>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * 单个文件夹行。已启用区与可用区用同一形状
 * —— 唯一区别是显示哪个按钮。类型药丸
 * 原样显示目录名（它**就是**类型）；悬停看
 * 说明。
 */
function FolderConfigRow({
  row,
  onToggle,
  onAdd,
  onDelete,
}: {
  onAdd: (folder: string) => void;
  onDelete: (folder: string) => void;
  onToggle: (folder: string, enabled: boolean) => void;
  row: FolderConfigRowData;
}) {
  const primaryMeta = folderMeta(row.type);

  const toggleEnabled = () => {
    onToggle(row.folder, !row.enabled);
  };
  const enableFromAvailable = () => {
    onAdd(row.folder);
  };
  const remove = () => {
    onDelete(row.folder);
  };

  return (
    <div className="border-border-subtle bg-card rounded-xl border px-3 py-2.5">
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-ink-bright font-mono text-sm">{row.folder}</span>
            <span
              className={`text-2xs cursor-help rounded-md px-2 py-0.5 font-medium ${primaryMeta.color}`}
              title={getFolderTooltip(row.folder)}
            >
              {primaryMeta.label}
            </span>
            {row.count > 0 && (
              <span className="bg-surface-2 text-ink-faint text-3xs rounded-md px-1.5 py-0.5">
                {row.count} 个文件
              </span>
            )}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {row.enabled ? (
            <Button
              className="h-auto rounded-lg px-3 py-1.5"
              onClick={toggleEnabled}
              size="xs"
              variant="success"
            >
              已启用
            </Button>
          ) : (
            <Button
              className="h-auto gap-1 rounded-lg px-3 py-1.5"
              onClick={enableFromAvailable}
              size="xs"
              variant="primary"
            >
              <Icon data-icon="inline-start" name="plus" size={12} />
              启用
            </Button>
          )}
          {row.hasConfig && (
            <Hint label="删除配置（不再扫描）">
              <Button
                className="text-ink-muted hover:bg-surface-2 hover:text-ink-strong h-auto rounded-md px-2 py-1"
                onClick={remove}
                size="xs"
                variant="ghost"
              >
                删除
              </Button>
            </Hint>
          )}
        </div>
      </div>
    </div>
  );
}
