"use client";

import type { ReactNode, RefObject } from "react";
import {
  Bold,
  Code,
  Eye,
  EyeOff,
  Heading1,
  Heading2,
  Heading3,
  Image as ImageIcon,
  Italic,
  Link,
  List,
  ListOrdered,
  Quote,
  Redo,
  Strikethrough,
  Table,
  Underline,
  Undo,
} from "lucide-react";
import type { OutlineItem } from "./script-markdown-utils";

export const SCROLLBAR_VISIBLE_CLASSES =
  "overflow-y-auto [&::-webkit-scrollbar]:h-2.5! [&::-webkit-scrollbar]:w-2.5! [&::-webkit-scrollbar-track]:bg-transparent! [&::-webkit-scrollbar-thumb]:rounded-full! [&::-webkit-scrollbar-thumb]:bg-(--color-border-strong)! [&::-webkit-scrollbar-thumb:hover]:bg-(--color-ink-muted)!";

/* ── Toolbar primitives ── */
export function ToolbarButton({
  children,
  onClick,
  title,
}: {
  children: ReactNode;
  onClick: () => void;
  title: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className="grid h-8 w-8 place-items-center rounded-lg text-(--color-ink-muted) transition-colors hover:bg-(--color-subtle) hover:text-(--color-ink-bright)"
    >
      {children}
    </button>
  );
}

export function ToolbarGroup({ children }: { children: ReactNode }) {
  return <div className="flex items-center gap-0.5">{children}</div>;
}

export function ToolbarDivider() {
  return <div className="mx-2 h-5 w-px bg-(--color-border)" />;
}

/* ── Full toolbar(标题 / 行内样式 / 列表引用 / 媒体 / 撤销重做 / 预览) ── */
export function EditorToolbar({
  insertAtLineStart,
  wrapSelection,
  insertList,
  insertLink,
  insertImage,
  insertTable,
  restoreHistory,
  showPreview,
  onTogglePreview,
}: {
  insertAtLineStart: (prefix: string) => void;
  wrapSelection: (before: string, after: string, placeholder?: string) => void;
  insertList: (ordered: boolean) => void;
  insertLink: () => void;
  insertImage: () => void;
  insertTable: () => void;
  restoreHistory: (delta: number) => void;
  showPreview: boolean;
  onTogglePreview: () => void;
}) {
  return (
    <div className="flex items-center gap-1 border-b border-(--color-border) bg-(--color-panel) px-4 py-2">
      <ToolbarGroup>
        <ToolbarButton onClick={() => insertAtLineStart("#")} title="标题 1">
          <Heading1 size={18} />
        </ToolbarButton>
        <ToolbarButton onClick={() => insertAtLineStart("##")} title="标题 2">
          <Heading2 size={18} />
        </ToolbarButton>
        <ToolbarButton onClick={() => insertAtLineStart("###")} title="标题 3">
          <Heading3 size={18} />
        </ToolbarButton>
      </ToolbarGroup>

      <ToolbarDivider />

      <ToolbarGroup>
        <ToolbarButton onClick={() => wrapSelection("**", "**", "粗体")} title="粗体">
          <Bold size={18} />
        </ToolbarButton>
        <ToolbarButton onClick={() => wrapSelection("*", "*", "斜体")} title="斜体">
          <Italic size={18} />
        </ToolbarButton>
        <ToolbarButton onClick={() => wrapSelection("__", "__", "下划线")} title="下划线">
          <Underline size={18} />
        </ToolbarButton>
        <ToolbarButton onClick={() => wrapSelection("~~", "~~", "删除线")} title="删除线">
          <Strikethrough size={18} />
        </ToolbarButton>
        <ToolbarButton onClick={() => wrapSelection("`", "`", "代码")} title="行内代码">
          <Code size={18} />
        </ToolbarButton>
      </ToolbarGroup>

      <ToolbarDivider />

      <ToolbarGroup>
        <ToolbarButton onClick={() => insertList(false)} title="无序列表">
          <List size={18} />
        </ToolbarButton>
        <ToolbarButton onClick={() => insertList(true)} title="有序列表">
          <ListOrdered size={18} />
        </ToolbarButton>
        <ToolbarButton onClick={() => insertAtLineStart(">")} title="引用">
          <Quote size={18} />
        </ToolbarButton>
      </ToolbarGroup>

      <ToolbarDivider />

      <ToolbarGroup>
        <ToolbarButton onClick={insertLink} title="链接">
          <Link size={18} />
        </ToolbarButton>
        <ToolbarButton onClick={insertImage} title="图片">
          <ImageIcon size={18} />
        </ToolbarButton>
        <ToolbarButton onClick={insertTable} title="表格">
          <Table size={18} />
        </ToolbarButton>
      </ToolbarGroup>

      <ToolbarDivider />

      <ToolbarGroup>
        <ToolbarButton onClick={() => restoreHistory(-1)} title="撤销 (Ctrl+Z)">
          <Undo size={18} />
        </ToolbarButton>
        <ToolbarButton onClick={() => restoreHistory(1)} title="重做 (Ctrl+Shift+Z)">
          <Redo size={18} />
        </ToolbarButton>
      </ToolbarGroup>

      <div className="ml-auto flex items-center gap-2">
        <button
          onClick={onTogglePreview}
          className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-(--color-ink-muted) transition-colors hover:bg-(--color-subtle) hover:text-(--color-ink-bright)"
        >
          {showPreview ? <EyeOff size={14} /> : <Eye size={14} />}
          {showPreview ? "返回编辑" : "预览"}
        </button>
      </div>
    </div>
  );
}

/* ── Outline sidebar(点击目录跳转) ── */
export function OutlineSidebar({
  outline,
  onJump,
}: {
  outline: OutlineItem[];
  onJump: (line: number) => void;
}) {
  return (
    <aside className="w-64 shrink-0 overflow-y-auto border-r border-(--color-border) bg-(--color-panel) p-4">
      <h3 className="mb-3 text-xs font-semibold tracking-wider text-(--color-ink-fainter) uppercase">
        目录大纲
      </h3>
      {outline.length === 0 ? (
        <p className="text-xs leading-relaxed text-(--color-ink-faintest)">
          使用 # / ## / ### 添加标题后，此处自动生成目录。
        </p>
      ) : (
        <nav className="space-y-1">
          {outline.map((item, index) => (
            <button
              key={`${item.line}-${index}`}
              onClick={() => onJump(item.line)}
              className={`block w-full truncate rounded-md px-2.5 py-1.5 text-left text-xs transition-colors hover:bg-(--color-subtle) hover:text-(--color-ink-bright) ${
                item.level === 1
                  ? "font-medium text-(--color-ink-strong)"
                  : item.level === 2
                    ? "pl-5 text-(--color-ink-muted)"
                    : "pl-8 text-(--color-ink-faint)"
              }`}
              title={item.text}
            >
              {item.text}
            </button>
          ))}
        </nav>
      )}
    </aside>
  );
}

/* ── Editor body:编辑态 textarea / 预览态渲染视图 ── */
export function EditorBody({
  textareaRef,
  value,
  showPreview,
  previewHtml,
  emitChange,
  pushHistory,
  getSelection,
  onChange,
}: {
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  value: string;
  showPreview: boolean;
  previewHtml: string;
  emitChange: (next: string) => void;
  pushHistory: (next: string, start: number, end: number) => void;
  getSelection: () => { start: number; end: number; text: string };
  onChange: (next: string, start: number, end: number) => void;
}) {
  return (
    <main className="relative flex min-w-0 flex-1 flex-col">
      {showPreview ? (
        <div
          className={`${SCROLLBAR_VISIBLE_CLASSES} min-h-0 flex-1 bg-(--color-canvas) p-6 text-[13px] leading-7 text-(--color-ink)`}
          dangerouslySetInnerHTML={{ __html: previewHtml }}
        />
      ) : (
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(event) => {
            onChange(
              event.target.value,
              event.target.selectionStart,
              event.target.selectionEnd
            );
          }}
          onKeyDown={(event) => {
            if (event.key === "Tab") {
              event.preventDefault();
              const { start, end } = getSelection();
              const nextValue = value.slice(0, start) + "  " + value.slice(end);
              emitChange(nextValue);
              pushHistory(nextValue, start + 2, start + 2);
              setTimeout(
                () => textareaRef.current?.setSelectionRange(start + 2, start + 2),
                0
              );
            }
          }}
          spellCheck={false}
          placeholder="# 剧本标题\n\n## 第一场\n\n（在此处编写完整剧本……）"
          className={`${SCROLLBAR_VISIBLE_CLASSES} min-h-0 flex-1 resize-none bg-(--color-canvas) p-6 font-mono text-[13px] leading-7 text-(--color-ink-bright) outline-none placeholder:text-(--color-ink-fainter)`}
          style={{ tabSize: 2 }}
        />
      )}
    </main>
  );
}
