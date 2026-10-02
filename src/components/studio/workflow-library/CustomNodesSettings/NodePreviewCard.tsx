/* eslint-disable @typescript-eslint/prefer-nullish-coalescing --
 * 理由（规范 §11.7 三分类法 · 第 3 类「伪建议」）：本组件展示的字段来自
 * manifest / 发现结果（服务端反序列化产物），那里的**空串是「没有值」的正常
 * 表示**。`??` 只在 null/undefined 时兜底，会把空串原样渲染成空白控件；
 * `||` 才是本场景的正确语义。与 parsing.ts 同一判断。 */
"use client";

import { colorFor, type ManifestNodeRaw } from "~/config/custom-nodes";
import { PortRow, WidgetValueChip } from "./SettingsParts";
import { Button } from "~/components/ui/button";

/* ──────────────────────────────────────────────────────────────────────── */
/* NodePreviewCard —— 一个自定义节点的小型 ComfyUI 风预览。       */
/*                                                                            */
/*  布局镜像官方 ComfyUI Web UI 里同一节点看到的样子：                */
/*  实色头部（取自节点的 `category`）配                            */
/*  收起箭头与类别徽标，然后卡片体分成两区：                      */
/*                                                                            */
/*    1. 类型端口（没有 `widget` 字段的输入 / 输出）—— 画成          */
/*       小的左右配对行，带彩色句柄圆点与                          */
/*       大写类型章，模仿节点卡片上的 ComfyUI 边框。              */
/*    2. widget（带 `widget` 字段的输入）—— 一行标签 + 默认值，      */
/*       排布与画布上的参数行一致。                                */
/*                                                                            */
/*  默认收起：只有彩色头部加一行计数                                */
/* （「3 个类型端口 / 7 个 widget / 1 个输出」）。点头部展开。        */
/*  这与 ComfyUI 自身行为一致，也让包列表保持可扫读                  */
/*  即使面对 146 个节点的 WanVideoWrapper 包。                       */
/* ──────────────────────────────────────────────────────────────────────── */
export function NodePreviewCard({
  data,
  fallbackName,
  expanded,
  onToggle,
}: {
  data: ManifestNodeRaw | undefined;
  fallbackName: string;
  expanded: boolean;
  onToggle: () => void;
}) {
  const color = colorFor(data?.category);
  const inputs = data?.inputs ?? [];
  const outputs = data?.outputs ?? [];
  const typed = inputs.filter((input) => !input.widget);
  const widgets = inputs.filter((input) => input.widget != null);
  const title = data?.displayName || fallbackName;

  return (
    <div
      className="overflow-hidden rounded-lg font-sans"
      style={{
        /* 卡片表面是**结构性表面**（列表里的卡片，不是浮在内容上的极小叠层），
           必须随主题。此前写死 rgba(15,10,30,0.95)，Light 下仍是一块近黑卡片。 */
        background: "var(--color-card)",
        border: `1px solid ${expanded ? color : "var(--color-border-strong)"}`,
      }}
    >
      {/* 头部 —— 可点击展开。实色色带，取自类别。 */}
      {/* 用原生 `<button>` 而不是 `div + role="button" + onKeyDown`：Enter/Space
       * 与焦点语义是免费给的（§16.2.4.29 里「6 处在复刻浏览器默认行为」之一）。
       * **没有走 `~/components/ui/disclosure`**：本卡片的头部是一条取自类别
       * 的实色色带、刻意镜像 ComfyUI 节点卡外观，与 Disclosure 的「一行文字 +
       * 折叠标记」不是一个形态（该豁免已在 `scripts/check-ui-primitives.cjs`
       * 的 `EXEMPT_FILES.P10` 里写明理由）。 */}
      <Button
        variant="ghost"
        onClick={onToggle}
        /* 覆盖串排在 `variant` 之后（tailwind-merge 后面的类赢）：圆角 / 悬停底 /
         * 文字色都由这里接管，基元只提供键盘与焦点语义（§16.2.4.2 第 5 条）。 */
        className="hover:text-ink-bright flex w-full items-center justify-start gap-2 rounded-none px-2.5 text-left outline-none hover:bg-transparent"
        style={{
          height: 28,
          background: color,
          color: "#fff",
        }}
      >
        <span className="text-[11px] leading-none">{expanded ? "▾" : "▸"}</span>
        <span
          className="flex-1 truncate text-[11.5px] font-bold"
          style={{ letterSpacing: 0.2 }}
          title={title}
        >
          {title}
        </span>
        {data?.category && (
          <span
            className="rounded-full px-1.5 py-px text-[8.5px] font-semibold"
            style={{ background: "rgba(0,0,0,0.28)" }}
          >
            {data.category}
          </span>
        )}
        {data?.outputNode && (
          <span
            className="rounded-full px-1.5 py-px text-[8.5px] font-semibold"
            style={{ background: "rgba(255,255,255,0.22)" }}
            title="前端专属 (OUTPUT_NODE)"
          >
            ⇪
          </span>
        )}
      </Button>

      {!data ? (
        <div className="text-muted-foreground px-2.5 py-1.5 text-[10px] italic">
          清单中未找到该节点（可能解析后未重导入此包）
        </div>
      ) : !expanded ? (
        <div className="text-ink-muted flex flex-wrap items-center gap-x-3 gap-y-1 px-2.5 py-1.5 text-[10px]">
          <span>
            <span className="text-ink-bright font-mono">{typed.length}</span>{" "}
            typed
          </span>
          <span>
            <span className="text-ink-bright font-mono">{widgets.length}</span>{" "}
            widget
          </span>
          <span>
            <span className="text-ink-bright font-mono">{outputs.length}</span>{" "}
            output
          </span>
        </div>
      ) : (
        <div className="px-2.5 pt-1.5 pb-2">
          {/* 区 1 —— 类型端口（输入在左，输出在右） */}
          {(typed.length > 0 || outputs.length > 0) && (
            <div
              className="mb-1.5 grid"
              style={{ gridTemplateColumns: "1fr 1fr", gap: 4 }}
            >
              <div className="flex flex-col gap-0.75">
                {typed.map((i, idx) => (
                  <PortRow
                    key={`ti-${idx}`}
                    side="in"
                    color={color}
                    type={i.type}
                    name={i.name}
                  />
                ))}
              </div>
              <div className="flex flex-col items-end gap-0.75">
                {outputs.map((output, idx) => (
                  <PortRow
                    key={`to-${idx}`}
                    side="out"
                    color={color}
                    type={output.type}
                    name={output.name}
                  />
                ))}
              </div>
            </div>
          )}

          {/* 区 2 —— widget（带标签的参数） */}
          {widgets.length > 0 && (
            <div
              className="flex flex-col gap-0.5 border-t pt-1.5"
              style={{ borderColor: "var(--color-border-subtle)" }}
            >
              {widgets.slice(0, 32).map((widget, idx) => (
                <div
                  key={`w-${idx}`}
                  className="flex items-center gap-1.5 text-[10.5px]"
                >
                  <span
                    className="inline-block shrink-0 rounded-full"
                    style={{
                      width: 6,
                      height: 6,
                      background: color,
                      opacity: 0.7,
                    }}
                  />
                  <span
                    className="text-ink-soft min-w-0 flex-1 truncate"
                    title={widget.name}
                  >
                    {widget.name}
                  </span>
                  <WidgetValueChip
                    widget={widget.widget ?? null}
                    value={widget.default}
                  />
                </div>
              ))}
              {widgets.length > 32 && (
                <div className="text-muted-foreground pl-3 text-[10px]">
                  … +{widgets.length - 32} more
                </div>
              )}
            </div>
          )}

          {typed.length === 0 &&
            widgets.length === 0 &&
            outputs.length === 0 && (
              <div className="text-muted-foreground py-1 text-center text-[10px] italic">
                无输入 / 输出参数
              </div>
            )}
        </div>
      )}
    </div>
  );
}
