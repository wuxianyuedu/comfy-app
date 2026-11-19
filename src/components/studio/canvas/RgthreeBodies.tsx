"use client";
import { isPlainRecord } from "~/lib/is-record";
import { matchesNeedle, normalizeNeedle } from "~/lib/list-filter";
import { trimmed } from "~/lib/number-format";
import { compareText } from "~/lib/ordered-set";
import { useRgthreeGroups } from "./IOEditContext";
import type { WorkflowGroup } from "../workflow-types";
import { Toggle } from "~/components/ui/toggle";
import { Hint } from "~/components/ui/hint";

export function RgthreeFastGroupsBypasserBody({
  matchTitle,
  groups,
}: {
  groups: Array<WorkflowGroup>;
  matchTitle: string;
}) {
  const ctx = useRgthreeGroups();
  /* useRgthreeGroups 在 store 未挂载时抛错；但该组件只会在编辑器内渲染，
   * 始终在 <WFStoresProvider> 之下，故可直接使用，无需 null 守卫。 */
  /* 归一化（trim + 折小写）走 `~/lib/list-filter`（规范 16 §16.2.4.16）。 */
  const needle = normalizeNeedle(matchTitle);
  if (!needle) {
    return null;
  }
  const matches = groups
    .filter((group) => matchesNeedle(needle, group.title || ""))
    /* 「按当前区域设置排序」走 `~/lib/ordered-set`（规范 16 §16.2.4.55）——
     * 它与 `<` / 不带比较器的 `.sort()` 是**两种判据**（`localeCompare`
     * 让 `"apple" < "Zebra"`，码位序让 `"Zebra" < "apple"`），
     * 收口前两种混用。 */
    .sort((left, right) => compareText(left.title, right.title));
  if (matches.length === 0) {
    return null;
  }
  const pad = Math.max(2, String(matches.length).length);
  return (
    <div className="flex flex-col gap-0.5 px-1 pb-1">
      {matches.map((group, index) => {
        const idx = String(index + 1).padStart(pad, "0");
        const label = `Enable ${matchTitle}${idx}`;
        const bypass = ctx.getBypass(group.id);
        return (
          <div
            className="group text-2xs relative flex h-5.5 items-center gap-1.5 pr-2 pl-2"
            key={group.id}
          >
            <Hint label={group.title}>
              <span
                className={`text-2xs min-w-0 shrink truncate text-left ${
                  bypass ? "text-ink-faint" : "text-ink-subtle"
                }`}
                style={{ flex: "0 1 auto" }}
              >
                {label}
              </span>
            </Hint>
            <span
              className={`text-2xs min-w-0 truncate text-left tabular-nums ${
                bypass ? "text-accent-soft" : "text-ink-fainter"
              }`}
              style={{ flex: "1 1 0" }}
            >
              {bypass ? "yes" : "no"}
            </span>
            {/* 开关本体 —— 经 context 翻转分组中止状态。用 `ui/toggle` 的 <Toggle>（P77）：
                单按钮 pressed 语义、自带 aria-pressed/data-pressed/Enter/Space/焦点环，不手拼 aria-pressed；
                外观留在 style（§16.2.4.2 验收标准是渲染结果不变）；指针事件拦截，避免 ReactFlow 当作拖拽。 */}
            <Toggle
              /* 覆盖串要在 `variant` 之后由 `cn()` 合并 —— tailwind-merge 同一属性
               * 后面的类赢，所以底色 / 圆角 / 内边距 / 悬停底都由这里接管
               *（§16.2.4.2 第 5 条：基元默认值「成套 + 讲顺序」地覆盖）。 */
              className="border-0 bg-transparent p-0 hover:bg-transparent"
              onMouseDown={(event) => {
                event.stopPropagation();
              }}
              onPointerDown={(event) => {
                event.stopPropagation();
              }}
              onPressedChange={() => {
                ctx.setBypass(group.id, !bypass);
              }}
              pressed={bypass}
              style={{
                marginLeft: 6,
                width: 26,
                height: 14,
                borderRadius: 7,
                cursor: "pointer",
                background: bypass ? "rgba(236, 72, 153, 0.55)" : "rgba(63, 63, 70, 0.55)",
                border: "1px solid var(--color-border-strong)",
                position: "relative",
                flex: "0 0 auto",
                transition: "background 120ms",
              }}
              title={bypass ? "点击取消旁路" : "点击旁路此 group"}
            >
              <span
                style={{
                  position: "absolute",
                  top: 1,
                  left: bypass ? 13 : 1,
                  width: 10,
                  height: 10,
                  borderRadius: 5,
                  background: bypass ? "var(--color-accent-soft)" : "var(--color-ink-subtle)",
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

/** 把 classType 硬编码映射到包名，补服务清单解析器漏掉的知名自定义节点包
 *（源码树不在解析路径，或其 MAPPING/CATEGORY 无包声明）。表要保持很窄 ——
 *  超过约 5 条就该扩展解析器。当前：efficiency-nodes 的 SetNode / GetNode 无磁盘标记也无 `cnr_id`。 */
export function RgthreePowerLoraLoaderBody({ widgets }: { widgets: Array<unknown> }) {
  const fmtStrength = (v: unknown): string | undefined => {
    if (typeof v === "number") {
      /* ComfyUI 会剥掉末尾的零（"1.00" → "1"，"0.85" 保持）——
       * 「按两位小数写 + 剥尾零」走 `~/lib/number-format`
       *（规范 16 §16.2.4.54），此前这里是手写的一份。 */
      return trimmed(v, 2) ?? undefined;
    }
    if (typeof v === "string" && v.length > 0 && v !== "undefined") {
      return v;
    }
    return undefined;
  };

  // 逐 lora 行：过滤掉表头 widget 与空占位。
  // 行的形状取决于包（裸文件名字符串，或一条 widget 记录）。
  type PowerLoraWidget = string | Record<string, unknown>;
  const loras: Array<PowerLoraWidget> = widgets.filter((widget): widget is PowerLoraWidget => {
    if (widget === null || widget === undefined) {
      return false;
    }
    if (!isPlainRecord(widget)) {
      return typeof widget === "string" && widget.length > 0; // bare lora filename
    }
    if (Object.keys(widget).length === 0) {
      return false;
    } // {} placeholder
    if (widget.type === "PowerLoraLoaderHeaderWidget") {
      return false;
    } // header widget
    return true; // real lora tuple
  });

  return (
    <div className="flex w-full flex-col gap-0.75 px-1 pt-0.5 pb-1">
      {/* Lora 堆栈区头 —— 始终绘制（空堆栈时也与 rgthree
       *  一致，好让作者总能在其下添加一条 lora）。 */}
      <div
        className="text-3xs flex items-center justify-between rounded px-1.5 py-0.75 font-medium uppercase"
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
          className="text-4xs inline-flex items-center gap-1.5"
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
          className="text-3xs rounded px-1.5 py-3 text-center"
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
          const recName = rec?.name ?? rec?.lora_name ?? rec?.model_name;
          const name =
            typeof widget === "string" ? widget : typeof recName === "string" ? recName : "";
          const modelStr = isObj
            ? fmtStrength(rec?.model_strength ?? rec?.model_str ?? rec?.strength)
            : undefined;
          const clipStr = isObj ? fmtStrength(rec?.clip_strength ?? rec?.clip_str) : undefined;
          return (
            <div
              className="text-2xs flex items-center gap-2 rounded px-1.5 py-0.75"
              key={`pll-r-${index}`}
              style={{ background: "var(--color-subtle)" }}
            >
              <Hint label={name}>
                <span
                  className="min-widget-0 flex-1 truncate"
                  style={{
                    color: name ? "var(--color-ink-bright)" : "var(--color-ink-fainter)",
                  }}
                >
                  {name}
                </span>
              </Hint>
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
        className="text-2xs mt-1 flex items-center justify-center gap-2 rounded py-1.5 font-medium"
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

/** rgthree Label 运行时主体：该 classType 无 I/O，用 properties 里的样式
 *（fontSize/fontFamily/fontColor/textAlign/backgroundColor/borderRadius/angle）绘制标题或 `text`。
 *  只读渲染铺满节点体；该 classType 抑制标准标题栏（ComfyUI 不显示独立头部）。 */
export function RgthreeLabelBody({
  text,
  properties,
}: {
  properties: Record<string, unknown>;
  text: string;
}) {
  const p = properties;
  const fontSize = typeof p.fontSize === "number" ? p.fontSize : 24;
  const fontFamily = typeof p.fontFamily === "string" ? p.fontFamily : "sans-serif";
  const fontColor = typeof p.fontColor === "string" ? p.fontColor : "#ffffff";
  const textAlign = p.textAlign === "center" || p.textAlign === "right" ? p.textAlign : "left";
  const bg =
    typeof p.backgroundColor === "string" && p.backgroundColor !== "transparent"
      ? p.backgroundColor
      : "transparent";
  const angle = typeof p.angle === "number" ? p.angle : 0;
  return (
    <div
      className="flex min-h-6 w-full flex-1 items-center px-2 py-1"
      style={{
        background: bg,
        borderRadius: typeof p.borderRadius === "number" ? p.borderRadius : 0,
        transform: angle ? `rotate(${angle}deg)` : undefined,
        overflow: "hidden",
      }}
    >
      <Hint label={text}>
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
        >
          {text || "（空标签）"}
        </span>
      </Hint>
    </div>
  );
}
