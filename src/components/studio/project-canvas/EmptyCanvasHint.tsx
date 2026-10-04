"use client";

/** 画布空态覆盖层：加载提示（初始项目水合期间显示）与
 *  友好的「右键开始」引导卡（画布确实为空时显示）。 */
import { Icon } from "~/components/ui/icon";
import { Spinner } from "~/components/ui/spinner";

interface EmptyCanvasHintProps {
  /** true → 水合覆盖层；false → 空画布引导。 */
  loading: boolean;
}

export function EmptyCanvasHint({ loading }: EmptyCanvasHintProps) {
  if (loading) {
    return (
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
        <div className="border-border-strong from-subtle to-canvas-deep flex flex-col items-center gap-3 rounded-3xl border bg-linear-to-br px-12 py-10 shadow-2xl shadow-black/40 backdrop-blur-md">
          <Spinner className="size-10" />
          <p className="text-ink-soft text-sm">加载中…</p>
        </div>
      </div>
    );
  }
  return (
    <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
      <div className="border-border-strong from-subtle to-canvas-deep rounded-3xl border bg-linear-to-br px-12 py-10 shadow-2xl shadow-black/10 backdrop-blur-md dark:shadow-black/40">
        <div className="mb-3 flex justify-center gap-2">
          <span
            className="inline-block size-10 rounded-xl shadow-lg"
            style={{
              background: "linear-gradient(135deg, #B584FF 0%, #FF9DCD 100%)",
              boxShadow: "0 4px 18px rgba(181,132,255,0.45)",
            }}
          />
          <span
            className="inline-block size-10 rounded-xl shadow-lg"
            style={{
              background: "linear-gradient(135deg, #5BC6FF 0%, #6BEBEB 100%)",
              boxShadow: "0 4px 18px rgba(91,198,255,0.45)",
            }}
          />
          <span
            className="inline-block size-10 rounded-xl shadow-lg"
            style={{
              background: "linear-gradient(135deg, #5BE3C4 0%, #67E89D 100%)",
              boxShadow: "0 4px 18px rgba(91,227,196,0.45)",
            }}
          />
          <span
            className="inline-block size-10 rounded-xl shadow-lg"
            style={{
              background: "linear-gradient(135deg, #FFD571 0%, #FF9C5B 100%)",
              boxShadow: "0 4px 18px rgba(255,213,113,0.45)",
            }}
          />
        </div>
        <p className="text-ink-bright mt-4 text-[15px] font-semibold">
          右键画布任意位置，开始创建节点
        </p>
        <p className="text-ink-soft mt-2 text-[12px] leading-relaxed">
          支持：生图 · 生视频 · 生成剧本 · Agent 模式 · 自定义工作流
        </p>
        <p className="text-ink-muted mt-1 text-[12px] leading-relaxed">
          自定义工作流可下拉选用你上传的 ComfyUI 工作流
        </p>
        <p className="text-primary-strong mt-1 text-[12px] leading-relaxed">
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
