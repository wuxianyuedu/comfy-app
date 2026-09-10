"use client";

/* ── 对外参数映射栏（工作流编辑画布左侧）──
 *
 * 视图层（规范 §17.2 第③层）：只消费 controller，不发请求、不算业务规则。
 * 这里把「这个工作流对外暴露了哪些参数」按**节点**归并成一行行卡片，每行右侧
 * 显示它当前连到哪个端口（自动映射 = 默认连线状态；作者在画布上拖的线 = 手工），
 * 并允许一键回到自动映射 / 断开。
 *
 * 连线本身画在画布上（见 WorkflowEditorCanvas 的 param 节点与 paramWires），
 * 因为只有画布坐标系能把「对外参数」和「节点端口」用曲线连起来。 */

import type { ParamMappingController } from "./hooks/use-param-mapping";

const CLASS_LABEL: Record<string, string> = {
  prompt: "提示词",
  negative: "负面提示词",
  "size-width": "宽度",
  "size-height": "高度",
  "size-aspect": "宽高比",
  "size-megapixels": "像素量",
  "reference-image": "参考图",
  "first-frame": "首帧",
  "last-frame": "尾帧",
  other: "参数",
};

const CLASS_COLOR: Record<string, string> = {
  prompt: "#a78bfa",
  negative: "#f87171",
  "size-width": "#38bdf8",
  "size-height": "#38bdf8",
  "size-aspect": "#38bdf8",
  "size-megapixels": "#38bdf8",
  "reference-image": "#22d3ee",
  "first-frame": "#34d399",
  "last-frame": "#fbbf24",
  other: "#94a3b8",
};

export function ParamMappingPanel({
  mapping,
  onClose,
}: {
  mapping: ParamMappingController;
  onClose: () => void;
}) {
  const { entries, resolved, selectedId, setSelectedId, isManual, resetToAuto } = mapping;
  const manualCount = entries.filter((entry) => isManual(entry.id)).length;

  return (
    <div className="pointer-events-none absolute left-4 top-4 bottom-4 z-30 flex w-[300px] flex-col">
      <div className="pointer-events-auto flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-violet-400/30 bg-[#0a0a14]/92 shadow-2xl backdrop-blur-md">
        <div className="flex shrink-0 items-center justify-between gap-2 border-b border-white/6 px-3 py-2">
          <div className="flex min-w-0 items-center gap-2">
            <span className="h-2 w-2 shrink-0 rounded-full bg-violet-400" />
            <span className="truncate text-[12px] font-semibold text-gray-200">对外参数</span>
            <span className="rounded-full bg-white/6 px-1.5 py-px font-mono text-[10px] text-gray-400">
              {entries.length}
            </span>
          </div>
          {manualCount > 0 && (
            <button
              type="button"
              onClick={mapping.resetAll}
              className="rounded-md border border-white/8 bg-white/4 px-1.5 py-0.5 text-[11px] text-gray-300 transition-colors hover:bg-white/8 hover:text-gray-100"
              title={`撤销 ${manualCount} 条手工连线，全部回到自动映射`}
            >
              恢复自动
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-white/8 bg-white/4 px-1.5 py-0.5 text-[11px] text-gray-400 transition-colors hover:bg-white/8 hover:text-gray-200"
            title="关闭映射栏"
          >
            ✕
          </button>
        </div>

        <div className="nodrag nopan min-h-0 flex-1 overflow-y-auto px-2.5 py-2.5">
          {entries.length === 0 ? (
            <div className="rounded-lg border border-dashed border-white/10 bg-white/2 px-3 py-4 text-center text-[11px] leading-relaxed text-gray-500">
              该工作流还没有对外暴露的参数。
              <br />
              在画布上勾选节点参数后，这里会按节点归并出现对应的对外参数。
            </div>
          ) : (
            <div className="space-y-1.5">
              {entries.map((entry) => {
                const target = resolved[entry.id] ?? null;
                const manual = isManual(entry.id);
                const accent = CLASS_COLOR[entry.cls] ?? "#94a3b8";
                const pin = entry.pins.find((item) => item.ioKey === target);
                return (
                  <button
                    key={entry.id}
                    type="button"
                    onClick={() => setSelectedId(selectedId === entry.id ? null : entry.id)}
                    className={`w-full rounded-lg border px-2 py-1.5 text-left transition-colors ${
                      selectedId === entry.id
                        ? "border-violet-400/60 bg-violet-400/12"
                        : "border-white/8 bg-white/3 hover:bg-white/6"
                    }`}
                    title={`${entry.nodeTitle || entry.nodeId} · ${CLASS_LABEL[entry.cls] ?? entry.cls}`}
                  >
                    <div className="flex items-center gap-1.5">
                      <span
                        className="h-1.5 w-1.5 shrink-0 rounded-full"
                        style={{ background: accent, boxShadow: `0 0 6px ${accent}` }}
                      />
                      <span className="truncate text-[11.5px] font-medium text-gray-100">
                        {entry.label}
                      </span>
                      <span className="ml-auto shrink-0 rounded bg-white/6 px-1 py-px text-[9.5px] text-gray-400">
                        {CLASS_LABEL[entry.cls] ?? entry.cls}
                      </span>
                    </div>
                    <div className="mt-1 flex items-center gap-1 text-[10px]">
                      <span className="shrink-0 text-gray-500">→</span>
                      <span className="truncate font-mono text-gray-300" title={target ?? ""}>
                        {pin ? `${entry.nodeTitle || entry.nodeId}.${pin.name}` : "未连线"}
                      </span>
                      <span
                        className={`ml-auto shrink-0 rounded px-1 py-px ${
                          manual
                            ? "bg-amber-400/15 text-amber-200"
                            : target
                              ? "bg-emerald-400/12 text-emerald-200"
                              : "bg-white/6 text-gray-400"
                        }`}
                      >
                        {manual ? "手工" : target ? "自动" : "断开"}
                      </span>
                    </div>
                    {manual && (
                      <span
                        role="button"
                        tabIndex={0}
                        onClick={(event) => {
                          event.stopPropagation();
                          resetToAuto(entry.id);
                        }}
                        onKeyDown={(event) => {
                          if (event.key !== "Enter" && event.key !== " ") return;
                          event.stopPropagation();
                          resetToAuto(entry.id);
                        }}
                        className="mt-1 inline-block cursor-pointer text-[10px] text-sky-300/90 hover:text-sky-200"
                      >
                        回到自动映射
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="shrink-0 border-t border-white/6 px-3 py-1.5 text-[10px] leading-relaxed text-gray-500">
          每个对外参数已按<strong className="text-gray-400">自动映射</strong>连到节点端口（默认连线状态）。
          选中后可从画布上该参数的圆点拖到节点端口改连；保存即落库。
        </div>
      </div>
    </div>
  );
}
