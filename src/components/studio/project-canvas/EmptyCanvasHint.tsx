"use client";

/** 2026-08-29 T12-3: extracted from ProjectCanvas's empty-state overlays —
 *  the loading hint (shown while the initial project hydrates) and the
 *  friendly "right-click to start" guide card (shown when the canvas is
 *  genuinely empty).
 */
import { Icon } from "@/components/ui/Icon";

interface EmptyCanvasHintProps {
  /** True → hydrating overlay; false → empty-canvas guide. */
  loading: boolean;
}

export function EmptyCanvasHint({ loading }: EmptyCanvasHintProps) {
  if (loading) {
    return (
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
        <div className="flex flex-col items-center gap-3 rounded-3xl border border-white/8 bg-linear-to-br from-[#1a1530]/60 to-[#0f0b1c]/60 px-12 py-10 shadow-2xl shadow-black/40 backdrop-blur-md">
          <Icon
            name="loader"
            size={40}
            className="animate-spin text-cyan-300/90"
          />
          <p className="text-sm text-gray-400">加载中…</p>
        </div>
      </div>
    );
  }
  return (
    <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
      <div className="rounded-3xl border border-white/8 bg-linear-to-br from-[#1a1530]/60 to-[#0f0b1c]/60 px-12 py-10 shadow-2xl shadow-black/40 backdrop-blur-md">
        <div className="mb-3 flex justify-center gap-2">
          <span
            className="inline-block h-10 w-10 rounded-xl shadow-lg"
            style={{
              background: "linear-gradient(135deg, #B584FF 0%, #FF9DCD 100%)",
              boxShadow: "0 4px 18px rgba(181,132,255,0.45)",
            }}
          />
          <span
            className="inline-block h-10 w-10 rounded-xl shadow-lg"
            style={{
              background: "linear-gradient(135deg, #5BC6FF 0%, #6BEBEB 100%)",
              boxShadow: "0 4px 18px rgba(91,198,255,0.45)",
            }}
          />
          <span
            className="inline-block h-10 w-10 rounded-xl shadow-lg"
            style={{
              background: "linear-gradient(135deg, #5BE3C4 0%, #67E89D 100%)",
              boxShadow: "0 4px 18px rgba(91,227,196,0.45)",
            }}
          />
          <span
            className="inline-block h-10 w-10 rounded-xl shadow-lg"
            style={{
              background: "linear-gradient(135deg, #FFD571 0%, #FF9C5B 100%)",
              boxShadow: "0 4px 18px rgba(255,213,113,0.45)",
            }}
          />
        </div>
        <p className="mt-4 text-[15px] font-semibold text-gray-100">
          右键画布任意位置，开始创建节点
        </p>
        <p className="mt-2 text-[12px] leading-relaxed text-gray-400">
          支持：生图 · 生视频 · 生成剧本 · Agent 模式 · 自定义工作流
        </p>
        <p className="mt-1 text-[12px] leading-relaxed text-gray-500">
          自定义工作流可下拉选用你上传的 ComfyUI 工作流
        </p>
        <p className="mt-1 text-[12px] leading-relaxed text-violet-300">
          <Icon
            name="sparkles"
            size={12}
            className="mr-1 inline align-[-2px]"
          />
          连线节点可把上游输出自动喂给下游
        </p>
      </div>
    </div>
  );
}
