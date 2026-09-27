"use client";
import { matchesNeedle, normalizeNeedle } from "~/lib/list-filter";
import { trimmed } from "~/lib/number-format";
import { compareText } from "~/lib/ordered-set";
import { useRgthreeGroups } from "./IOEditContext";
import type { WorkflowGroup } from "../workflow-types";
import { Toggle } from "~/components/ui/toggle";

export function RgthreeFastGroupsBypasserBody({
  matchTitle,
  groups,
}: {
  matchTitle: string;
  groups: WorkflowGroup[];
}) {
  const ctx = useRgthreeGroups();
  /* useRgthreeGroups 在 store 未挂载时抛错；但该组件只会在编辑器内渲染，
   * 始终在 <WFStoresProvider> 之下，故可直接使用，无需 null 守卫。 */
  /* 归一化（trim + 折小写）走 `~/lib/list-filter`（规范 16 §16.2.4.16）。 */
  const needle = normalizeNeedle(matchTitle);
  if (!needle) return null;
  const matches = groups
    .filter((group) => matchesNeedle(needle, group.title || ""))
    .slice()
    /* 「按当前区域设置排序」走 `~/lib/ordered-set`（规范 16 §16.2.4.55）——
     * 它与 `<` / 不带比较器的 `.sort()` 是**两种判据**（`localeCompare`
     * 让 `"apple" < "Zebra"`，码位序让 `"Zebra" < "apple"`），
     * 收口前两种混用。 */
    .sort((left, right) => compareText(left.title, right.title));
  if (matches.length === 0) return null;
  const pad = Math.max(2, String(matches.length).length);
  return (
    <div className="flex flex-col gap-[2px] px-1 pb-1">
      {matches.map((group, index) => {
        const idx = String(index + 1).padStart(pad, "0");
        const label = `Enable ${matchTitle}${idx}`;
        const bypass = ctx.getBypass(group.id);
        return (
          <div
            key={group.id}
            className="group relative flex h-[22px] items-center gap-1.5 pr-2 pl-2 text-[11px]"
          >
            <span
              className={`min-w-0 shrink truncate text-left text-[11px] ${
                bypass ? "text-ink-faint" : "text-ink-subtle"
              }`}
              style={{ flex: "0 1 auto" }}
              title={group.title}
            >
              {label}
            </span>
            <span
              className={`min-w-0 truncate text-left text-[10.5px] tabular-nums ${
                bypass ? "text-accent-soft" : "text-ink-fainter"
              }`}
              style={{ flex: "1 1 0" }}
            >
              {bypass ? "yes" : "no"}
            </span>
            {/* 开关本体 —— 一颗可点击的小章，经 context 翻转
             *  该分组的中止状态。**用 `~/components/ui/toggle` 的 `<Toggle>`**
             *（P77）——单按钮 pressed 语义、不走 ToggleGroup（那是 2-7 项选项组的
             *  账），也不在 Button 上手拼 `aria-pressed`。Toggle 内部走 Base UI
             *  Toggle、自带 `aria-pressed` / `data-pressed` / Enter/Space / 焦点环，
             *  自己补的那份写漏一处就是「这颗开关键盘点不动」。
             *  外观逐条留在 `style` 里（§16.2.4.2 第 9 条：验收标准是渲染结果不变）。
             *  指针事件照旧拦截，好让 ReactFlow 的拖拽处理器看不到这次点击。 */}
            <Toggle
              pressed={bypass}
              onPressedChange={() => ctx.setBypass(group.id, !bypass)}
              title={bypass ? "点击取消旁路" : "点击旁路此 group"}
              onPointerDown={(event) => event.stopPropagation()}
              onMouseDown={(event) => event.stopPropagation()}
              /* 覆盖串要在 `variant` 之后由 `cn()` 合并 —— tailwind-merge 同一属性
               * 后面的类赢，所以底色 / 圆角 / 内边距 / 悬停底都由这里接管
               *（§16.2.4.2 第 5 条：基元默认值「成套 + 讲顺序」地覆盖）。 */
              className="border-0 bg-transparent p-0 hover:bg-transparent"
              style={{
                marginLeft: 6,
                width: 26,
                height: 14,
                borderRadius: 7,
                cursor: "pointer",
                background: bypass
                  ? "rgba(236, 72, 153, 0.55)"
                  : "rgba(63, 63, 70, 0.55)",
                border: "1px solid var(--color-border-strong)",
                position: "relative",
                flex: "0 0 auto",
                transition: "background 120ms",
              }}
            >
              <span
                style={{
                  position: "absolute",
                  top: 1,
                  left: bypass ? 13 : 1,
                  width: 10,
                  height: 10,
                  borderRadius: 5,
                  background: bypass
                    ? "var(--color-accent-soft)"
                    : "var(--color-ink-subtle)",
                  transition: "left 120ms",
                }}
              />
            </Toggle>
          </div>
        );
      })}
    </div>
  );
}

/** 把 classType 硬编码映射到包名，服务清单解析器漏掉的知名自定义
 *  节点包（例如它的源码树不在解析路径上，
 *  或它的 `MAPPING/CATEGORY` 里没有包声明）。
 *  这张表要保持很窄 —— 超过约 5 条就说明该去
 *  扩展解析器而不是继续加表。
 *
 *  目前：
 *   • efficiency-nodes 的 SetNode / GetNode —— 它的包在我们装的环境里
 *     没有磁盘标记，节点本身也没有 `cnr_id`，所以硬编码这份
 *     归属。 */
export function RgthreePowerLoraLoaderBody({
  widgets,
}: {
  widgets: unknown[];
}) {
  const fmtStrength = (v: unknown): string | undefined => {
    if (typeof v === "number") {
      /* ComfyUI 会剥掉末尾的零（"1.00" → "1"，"0.85" 保持）——
       * 「按两位小数写 + 剥尾零」走 `~/lib/number-format`
       *（规范 16 §16.2.4.54），此前这里是手写的一份。 */
      return trimmed(v, 2) ?? undefined;
    }
    if (typeof v === "string" && v.length > 0 && v !== "undefined") return v;
    return undefined;
  };

  // 逐 lora 行：过滤掉表头 widget 与空占位。
  // 行的形状取决于包（裸文件名字符串，或一条 widget 记录）。
  type PowerLoraWidget = string | Record<string, unknown>;
  const loras: PowerLoraWidget[] = (
    (widgets ?? []) as PowerLoraWidget[]
  ).filter((widget) => {
    if (widget === null || widget === undefined) return false;
    if (typeof widget !== "object" || Array.isArray(widget)) {
      return typeof widget === "string" && widget.length > 0; // bare lora filename
    }
    if (Object.keys(widget).length === 0) return false; // {} placeholder
    if (widget.type === "PowerLoraLoaderHeaderWidget") return false; // header widget
    return true; // real lora tuple
  });

  return (
    <div className="flex w-full flex-col gap-[3px] px-1 pt-0.5 pb-1">
      {/* Lora 堆栈区头 —— 始终绘制（空堆栈时也与 rgthree
       *  一致，好让作者总能在其下添加一条 lora）。 */}
      <div
        className="flex items-center justify-between rounded px-1.5 py-[3px] text-[10px] font-medium uppercase"
        style={{
          background: "var(--color-subtle)",
          color: "var(--color-ink-soft)",
          letterSpacing: 0.4,
        }}
      >
        <span className="inline-flex items-center gap-1">
          <span
            aria-hidden
            style={{
              width: 8,
              height: 8,
              borderRadius: 999,
              background: "rgba(167, 139, 250, 0.95)",
              display: "inline-block",
            }}
          />
          Lora Stack
        </span>
        <span
          className="inline-flex items-center gap-1.5 text-[9px]"
          style={{ color: "var(--color-ink-muted)", letterSpacing: 0.6 }}
        >
          <span>model</span>
          <span style={{ color: "var(--color-ink-faintest)" }}>•</span>
          <span>clip</span>
        </span>
      </div>

      {/* 逐 lora 行（本工作流里是空占位区）。 */}
      {loras.length === 0 ? (
        <div
          className="rounded px-1.5 py-3 text-center text-[10px]"
          style={{
            background: "var(--color-subtle)",
            color: "var(--color-ink-muted)",
            border: "1px dashed var(--color-border-strong)",
          }}
        >
          暂无 Lora — 点击下方按钮添加
        </div>
      ) : (
        loras.map((widget, index) => {
          const isObj = typeof widget === "object" && !Array.isArray(widget);
          const rec = isObj ? widget : undefined;
          const name =
            typeof widget === "string"
              ? widget
              : (((rec?.name ?? rec?.lora_name ?? rec?.model_name) as
                  string | undefined) ?? "");
          const modelStr = isObj
            ? fmtStrength(
                rec?.model_strength ?? rec?.model_str ?? rec?.strength,
              )
            : undefined;
          const clipStr = isObj
            ? fmtStrength(rec?.clip_strength ?? rec?.clip_str)
            : undefined;
          return (
            <div
              key={`pll-r-${index}`}
              className="flex items-center gap-2 rounded px-1.5 py-[3px] text-[11px]"
              style={{ background: "var(--color-subtle)" }}
            >
              <span
                className="min-widget-0 flex-1 truncate"
                style={{
                  color: name
                    ? "var(--color-ink-bright)"
                    : "var(--color-ink-fainter)",
                }}
                title={name}
              >
                {name ?? "（未选择 Lora）"}
              </span>
              {modelStr !== undefined && (
                <span
                  className="shrink-0 tabular-nums"
                  style={{ color: "var(--color-ink-soft)", fontSize: 10 }}
                >
                  {modelStr}
                </span>
              )}
              {clipStr !== undefined && (
                <span
                  className="shrink-0 tabular-nums"
                  style={{ color: "var(--color-ink-muted)", fontSize: 10 }}
                >
                  {clipStr}
                </span>
              )}
            </div>
          );
        })
      )}

      {/* 「+ 添加 Lora」CTA —— rgthree 在空堆栈时也显示它。画布上
       *  是只读的，所以是一颗静态药丸（没有点击处理器）。 */}
      <div
        aria-hidden
        className="mt-1 flex items-center justify-center gap-2 rounded py-[6px] text-[11px] font-medium"
        style={{
          background: "rgba(139, 92, 246, 0.10)",
          border: "1px solid rgba(139, 92, 246, 0.45)",
          color: "var(--color-ink-bright)",
          pointerEvents: "none",
          userSelect: "none",
        }}
      >
        <span
          style={{
            fontSize: 14,
            lineHeight: 1,
            color: "rgba(167, 139, 250, 0.95)",
            fontWeight: 600,
          }}
        >
          +
        </span>
        Add Lora
      </div>
    </div>
  );
}

/** rgthree Label 的运行时主体。rgthree 的 Label 节点没有
 *  I/O —— 它用 `properties` 里的样式（fontSize / fontFamily / fontColor / textAlign /
 *  backgroundColor / borderRadius / angle）绘制自己的标题（或 `text` 属性）。
 *  我们把这段带样式的文字只读渲染，铺满节点体。这个 classType
 *  会抑制标准标题栏（ComfyUI 不显示独立头部），
 *  好让绘制的文字读起来就是整个节点。 */
export function RgthreeLabelBody({
  text,
  properties,
}: {
  text: string;
  properties: Record<string, unknown>;
}) {
  const p = properties ?? {};
  const fontSize = typeof p.fontSize === "number" ? p.fontSize : 24;
  const fontFamily =
    typeof p.fontFamily === "string" ? p.fontFamily : "sans-serif";
  const fontColor = typeof p.fontColor === "string" ? p.fontColor : "#ffffff";
  const textAlign =
    p.textAlign === "center" || p.textAlign === "right" ? p.textAlign : "left";
  const bg =
    typeof p.backgroundColor === "string" && p.backgroundColor !== "transparent"
      ? p.backgroundColor
      : "transparent";
  const angle = typeof p.angle === "number" ? p.angle : 0;
  return (
    <div
      className="flex min-h-[24px] w-full flex-1 items-center px-2 py-1"
      style={{
        background: bg,
        borderRadius: typeof p.borderRadius === "number" ? p.borderRadius : 0,
        transform: angle ? `rotate(${angle}deg)` : undefined,
        overflow: "hidden",
      }}
    >
      <span
        style={{
          fontFamily,
          fontSize,
          color: fontColor,
          textAlign,
          width: "100%",
          lineHeight: 1.1,
          wordBreak: "break-word",
          whiteSpace: "pre-wrap",
        }}
        title={text}
      >
        {text || "（空标签）"}
      </span>
    </div>
  );
}
