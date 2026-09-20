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
import { Button } from "~/components/ui/button";
import { simpleKeyHandler } from "~/components/ui/simple-key-handler";

/** 可滚动 + 编辑区档位的滚动条外观。
 *  外观定义已收进 `globals.css` 的 `.soft-scrollbar` —— 此前这里用一组
 *  任意值变体（`[&::-webkit-scrollbar-thumb]:bg-border-strong!` …）把同一件事
 *  又实现了一份，取值与 `.custom-scrollbar` 各自漂移；判据 P4 现在禁止
 *  视图里再出现 `::-webkit-scrollbar`。 */
export const SCROLLBAR_VISIBLE_CLASSES = "soft-scrollbar overflow-y-auto";

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
    <Button
      variant="ghost"
      size="icon"
      onClick={onClick}
      title={title}
      className="text-ink-muted hover:bg-subtle hover:text-ink-bright rounded-lg"
    >
      {children}
    </Button>
  );
}

export function ToolbarGroup({ children }: { children: ReactNode }) {
  return <div className="flex items-center gap-0.5">{children}</div>;
}

export function ToolbarDivider() {
  return <div className="bg-border mx-2 h-5 w-px" />;
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
    <div className="border-border bg-panel flex items-center gap-1 border-b px-4 py-2">
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
        <ToolbarButton
          onClick={() => wrapSelection("**", "**", "粗体")}
          title="粗体"
        >
          <Bold size={18} />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => wrapSelection("*", "*", "斜体")}
          title="斜体"
        >
          <Italic size={18} />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => wrapSelection("__", "__", "下划线")}
          title="下划线"
        >
          <Underline size={18} />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => wrapSelection("~~", "~~", "删除线")}
          title="删除线"
        >
          <Strikethrough size={18} />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => wrapSelection("`", "`", "代码")}
          title="行内代码"
        >
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
        <ToolbarButton
          onClick={() => restoreHistory(1)}
          title="重做 (Ctrl+Shift+Z)"
        >
          <Redo size={18} />
        </ToolbarButton>
      </ToolbarGroup>

      <div className="ml-auto flex items-center gap-2">
        <Button
          variant="ghost"
          size="xs"
          onClick={onTogglePreview}
          className="text-ink-muted hover:bg-subtle hover:text-ink-bright h-auto gap-1.5 rounded-lg px-3 py-1.5"
        >
          {showPreview ? <EyeOff size={14} /> : <Eye size={14} />}
          {showPreview ? "返回编辑" : "预览"}
        </Button>
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
    <aside className="border-border bg-panel w-64 shrink-0 overflow-y-auto border-r p-4">
      <h3 className="text-ink-fainter mb-3 text-xs font-semibold tracking-wider uppercase">
        目录大纲
      </h3>
      {outline.length === 0 ? (
        <p className="text-ink-faintest text-xs leading-relaxed">
          使用 # / ## / ### 添加标题后，此处自动生成目录。
        </p>
      ) : (
        <nav className="space-y-1">
          {outline.map((item, index) => (
            <Button
              key={`${item.line}-${index}`}
              variant="ghost"
              size="xs"
              onClick={() => onJump(item.line)}
              className={`hover:bg-subtle hover:text-ink-bright block h-auto w-full truncate rounded-md px-2.5 py-1.5 text-left ${
                item.level === 1
                  ? "text-ink-strong font-medium"
                  : item.level === 2
                    ? "text-ink-muted pl-5 font-normal"
                    : "text-ink-faint pl-8 font-normal"
              }`}
              title={item.text}
            >
              {item.text}
            </Button>
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
  /* Tab 缩进的键动作走 `~/components/ui/simple-key-handler`（规范 16
   *  §16.2.4.57）：键判别与 `preventDefault` 此前混在同一个 `if` 里，
   *  看不出「吞掉焦点转移」是谁决定的。
   *
   *  它必须**在事件处理器里**调（而不是在 render 时展开成 props）：动作闭包
   *  要读 `textareaRef.current`，而 render 期读 ref 会被
   *  `react-hooks/refs` 拦下。因此这里是 `onKeyDown={(event) => …}` ——
   *  元素上仍然只有一个 `onKeyDown`，键判据仍然只有一处定义。 */
  return (
    <main className="relative flex min-w-0 flex-1 flex-col">
      {showPreview ? (
        <div
          className={`${SCROLLBAR_VISIBLE_CLASSES} bg-canvas text-ink min-h-0 flex-1 p-6 text-[13px] leading-7`}
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
              event.target.selectionEnd,
            );
          }}
          onKeyDown={(event) => {
            /* 键判据（哪几个键、要不要 preventDefault、收不收连发）来自出口，
             *  这里只写「按下 Tab 要为这段文本做什么」—— 而这三件事现在都
             *  写在同一个地方（`simpleKeyHandler`），不再与动作混在一个 `if` 里。 */
            const tabHandler = simpleKeyHandler(["Tab"], () => {
              const { start, end } = getSelection();
              const nextValue = value.slice(0, start) + "  " + value.slice(end);
              emitChange(nextValue);
              pushHistory(nextValue, start + 2, start + 2);
              setTimeout(
                () =>
                  textareaRef.current?.setSelectionRange(start + 2, start + 2),
                0,
              );
            });
            tabHandler.onKeyDown(event);
          }}
          spellCheck={false}
          placeholder="# 剧本标题\n\n## 第一场\n\n（在此处编写完整剧本……）"
          className={`${SCROLLBAR_VISIBLE_CLASSES} bg-canvas text-ink-bright placeholder:text-ink-fainter min-h-0 flex-1 resize-none p-6 font-mono text-[13px] leading-7 outline-none`}
          style={{ tabSize: 2 }}
        />
      )}
    </main>
  );
}
