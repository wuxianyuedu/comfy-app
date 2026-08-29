import { useState } from "react";
import { Folder, X } from "lucide-react";

import { MediaThumbnail } from "@/components/studio/MediaThumbnail";
import { useToast } from "@/components/studio/toast-provider";
import { isVideo } from "@/lib/media";
import { vanillaApi } from "~/trpc/vanilla";

import type { TaskDetail } from "./history-types";

interface HistoryDetailModalProps {
  detailId: string | null;
  detail: TaskDetail | null;
  detailLoading: boolean;
  /** 工作流默认值兜底（来自 /api/tasks/[id] 的 workflowHints 子字段）。 */
  workflowHints: unknown;
  onClose: () => void;
}

/** 历史任务详情弹窗：图片网格 + 提示词 + 生成参数卡 + 参数表 + 打开目录 / 下载工作流。 */
export function HistoryDetailModal({
  detailId,
  detail,
  detailLoading,
  workflowHints,
  onClose,
}: HistoryDetailModalProps) {
  const toast = useToast();
  /** 「打开目录」降级 popover：展示路径 + 协议打开引导。 */
  const [folderPopover, setFolderPopover] = useState<{ path: string } | null>(null);
  /** comfyapp:// 协议助手是否未注册（导航后页面未失焦，视为未接管）。 */
  const [helperMissing, setHelperMissing] = useState(false);
  /** 「打开目录」按钮防双击。 */
  const [openFolderBusy, setOpenFolderBusy] = useState(false);

  if (!detailId) return null;
  // 局部 const 让闭包 / IIFE 内的空值窄化在 TS 中稳定成立。
  const current = detail;

  return (
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center bg-black/80 p-4 sm:p-6"
      onClick={onClose}
    >
      <div
        className="flex max-h-[85vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-white/10 bg-(--color-node)"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="relative flex items-center justify-between gap-3 border-b border-white/6 px-5 py-3">
          <h3 className="u-title">任务详情</h3>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={!current?.id || openFolderBusy}
              onClick={async () => {
                if (!current?.id) return;
                setOpenFolderBusy(true);
                try {
                  const result = await vanillaApi.task.openFolder.mutate({
                    id: current.id,
                  });
                  if (result.comfyappUrl) {
                    // 本机自定义协议方案（R-ardot72）：服务端已校验目录存在且在
                    // 白名单内，返回 comfyapp://open?path=... URL。
                    // 这里直接导航（user-initiated 点击），浏览器弹「是否打开外部
                    // 应用」确认 → OS 调起 comfyapp:// handler 用 explorer 打开目录。
                    // 零下载、真正一键。
                    //
                    // 检测协议是否真的被 OS 接管：导航后若 2s 内页面失去焦点
                    // （外部 app 抢走焦点），视为已打开；否则认为未注册助手，
                    // 展示安装引导（防静默失败）。
                    let openedByOs = false;
                    const onBlur = () => {
                      openedByOs = true;
                      window.removeEventListener("blur", onBlur);
                      setHelperMissing(false);
                    };
                    window.addEventListener("blur", onBlur);
                    window.location.href = result.comfyappUrl;
                    window.setTimeout(() => {
                      window.removeEventListener("blur", onBlur);
                      if (!openedByOs) setHelperMissing(true);
                    }, 2000);
                    setFolderPopover({ path: result.absolutePath });
                  } else if (result.error === "directory missing") {
                    toast.error("该任务尚未生成文件目录", result.absolutePath);
                  } else {
                    toast.error("打开目录失败");
                  }
                } catch {
                  toast.error("无法连接服务器");
                } finally {
                  setOpenFolderBusy(false);
                }
              }}
              className="inline-flex items-center gap-1.5 rounded-md border border-white/10 px-2.5 py-1 text-[11px] text-gray-300 transition-colors hover:border-white/20 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
              title="在系统文件管理器中打开本次生成的目录（图片 / 视频 / 音频 / workflow.json / manifest.json 都在这里）"
            >
              <Folder size={12} />
              打开目录
            </button>
            {folderPopover && (
              <div
                className="absolute right-5 top-[52px] z-10 w-[min(440px,calc(100vw-40px))] rounded-lg border border-white/10 bg-[#0f0f17] p-3 shadow-xl"
                onClick={(event) => event.stopPropagation()}
              >
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-[11px] font-medium text-gray-300">
                    📂 在资源管理器中打开
                  </span>
                  <button
                    type="button"
                    onClick={() => setFolderPopover(null)}
                    className="text-gray-500 hover:text-gray-200"
                    aria-label="关闭"
                  >
                    <X size={12} />
                  </button>
                </div>
                {helperMissing ? (
                  <div className="mb-2 rounded border border-amber-500/30 bg-amber-500/10 px-2.5 py-1.5 text-[10.5px] leading-relaxed text-amber-200">
                    未检测到 ComfyApp 助手，浏览器没有弹出「打开外部应用」确认框。
                    请双击运行项目内 <code className="text-amber-100">scripts\install-comfyapp-helper.ps1</code>{" "}
                    注册
                    <code className="text-amber-100"> comfyapp://</code> 协议（仅本机、无需管理员），
                    或直接 <a href="/api/helper/install" className="underline hover:text-amber-100">下载安装脚本</a>。
                  </div>
                ) : (
                  <div className="mb-2 rounded border border-emerald-500/20 bg-emerald-500/6 px-2.5 py-1.5 text-[10.5px] leading-relaxed text-emerald-200/90">
                    若浏览器弹出「是否打开外部应用」，点击「打开」即可在资源管理器中打开该目录。
                  </div>
                )}
                <code className="block select-all break-all rounded bg-black/40 px-2.5 py-2 text-[11px] leading-relaxed text-emerald-300">
                  {folderPopover.path}
                </code>
                <div className="mt-2 flex flex-wrap justify-end gap-2">
                  <button
                    type="button"
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(folderPopover.path);
                        toast.success("路径已复制", "粘贴到资源管理器地址栏（Alt+D）即可跳转");
                        return;
                      } catch {
                        /* 继续走 fallback */
                      }
                      // 兜底：clipboard API 被禁时，用临时 textarea
                      const ta = document.createElement("textarea");
                      ta.value = folderPopover.path;
                      ta.style.position = "fixed";
                      ta.style.opacity = "0";
                      document.body.appendChild(ta);
                      ta.select();
                      document.execCommand("copy");
                      document.body.removeChild(ta);
                      toast.success("路径已复制", "粘贴到资源管理器地址栏（Alt+D）即可跳转");
                    }}
                    className="rounded-md border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-1 text-[11px] text-emerald-200 hover:border-emerald-500/60 hover:text-emerald-100"
                  >
                    📋 复制路径
                  </button>
                </div>
              </div>
            )}
            {(() => {
              if (!current || !Array.isArray(current.images)) return null;
              const first = current.images[0];
              if (!first?.localPath) return null;
              const snapSource = (
                current.workflowSnapshot as unknown as
                  | { source?: string }
                  | null
                  | undefined
              )?.source;
              const sourceLabel =
                snapSource === "backfill"
                  ? "历史记录回填快照"
                  : snapSource === "execution"
                    ? "执行时自动捕获的独立快照"
                    : "磁盘回退快照";
              return (
                <div className="flex items-center gap-2">
                  <button
                    onClick={async () => {
                      try {
                        const result = await vanillaApi.task.workflow.query({
                          id: current.id,
                        });
                        if (!result.workflow) {
                          toast.error("未找到工作流快照");
                          return;
                        }
                        const blob = new Blob(
                          [JSON.stringify(result.workflow, null, 2)],
                          { type: "application/json" }
                        );
                        const url = URL.createObjectURL(blob);
                        const anchor = document.createElement("a");
                        anchor.href = url;
                        anchor.download = "workflow.json";
                        anchor.click();
                        URL.revokeObjectURL(url);
                      } catch {
                        toast.error("下载失败");
                      }
                    }}
                    className="rounded-md border border-white/10 px-2.5 py-1 text-[11px] text-gray-300 transition-colors hover:border-white/20 hover:text-white"
                    title="下载本次执行实际用到的工作流 JSON（含当时的节点与参数，工作流模板后续改动也不影响复现）"
                  >
                    下载工作流
                  </button>
                  <span
                    className="hidden rounded bg-white/4 px-1.5 py-0.5 text-[10px] text-gray-500 sm:inline"
                    title={sourceLabel}
                  >
                    {sourceLabel}
                  </span>
                </div>
              );
            })()}
            <button
              onClick={onClose}
              className="text-gray-500 hover:text-gray-200"
              aria-label="关闭"
            >
              <X size={16} />
            </button>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          {detailLoading ? (
            <p className="text-sm text-gray-500">加载中…</p>
          ) : current ? (
            <div className="space-y-4">
              {current.images?.length > 0 ? (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  {current.images.map((img) => (
                    <div
                      key={img.localPath}
                      className="group relative overflow-hidden rounded-xl border border-white/6"
                    >
                      <MediaThumbnail
                        src={img.localPath}
                        alt=""
                        className="aspect-square w-full object-cover"
                        autoPlay
                        loop
                      />
                      <a
                        href={img.localPath}
                        download
                        className="absolute bottom-2 right-2 rounded bg-white/15 px-2 py-0.5 text-[11px] text-white opacity-0 transition-opacity hover:bg-white/25 group-hover:opacity-100"
                      >
                        {isVideo(img.localPath) ? "下载视频" : "下载"}
                      </a>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-gray-500">该任务没有生成图像。</p>
              )}

              {/* R-ardot60 (2026-08-15): prompt 回退——workflow 任务的 prompt 存在
               *  detail.params.workflowInputs[0].value 而不是 detail.prompt。
               *  之前 detail.prompt 为空时直接显示「—」,用户以为「数据没显示全」。 */}
              {(() => {
                const params = (current.params ?? {}) as Record<string, unknown>;
                const rawWorkflowInputs = params.workflowInputs;
                const workflowInputs: Array<{ name: string; value: unknown }> =
                  Array.isArray(rawWorkflowInputs)
                    ? (rawWorkflowInputs as Array<{ name: string; value: unknown }>)
                    : [];
                const fallbackPrompt = (() => {
                  const hit = workflowInputs.find(
                    (input) =>
                      input.name === "text" ||
                      input.name === "prompt" ||
                      input.name === "positive"
                  );
                  return hit && typeof hit.value === "string" ? hit.value : "";
                })();
                const showPrompt = current.prompt || fallbackPrompt;
                return (
                  <>
                    {showPrompt && (
                      <div>
                        <p className="mb-1 text-xs font-semibold text-gray-400">正向提示词</p>
                        <p className="whitespace-pre-wrap break-words text-sm text-gray-300">
                          {showPrompt}
                        </p>
                      </div>
                    )}
                    {current.negativePrompt && (
                      <div>
                        <p className="mb-1 text-xs font-semibold text-gray-400">反向提示词</p>
                        <p className="whitespace-pre-wrap break-words text-sm text-gray-400">
                          {current.negativePrompt}
                        </p>
                      </div>
                    )}
                  </>
                );
              })()}

              {/* R-ardot61 (2026-08-15): 生成参数卡 —— seed/step/cfg/sampler/scheduler
               *  等生成参数分散在 params.workflowInputs[]（按 name）或顶层 params，
               *  以前只在 collapsed raw JSON 里才看得到，用户要「一眼能看到」。
               *  这里抽出常见生成参数做成网格卡，并去重（同 label 只取优先 key）。
               *  R-ardot63 (2026-08-15): 进一步加工作流默认值兜底 —— 有些工作流（如 z-image）
               *  把 steps/cfg/sampler/scheduler/denoise/size 硬编码在 subgraph 内 KSampler/
               *  Empty*Latent 节点的 widgets_values，从不暴露给用户，也写不进 params；
               *  这里再从 workflowHints（/api/tasks/[id] 的子字段）回填这些非随机字段。
               *  R-ardot62 (2026-08-15): seed 走真值 —— 后端从 ComfyUI history 的 prompt[2] graph
               *  里 KSampler.inputs.seed 抽出，落在 `params.runtime.seed` + `TaskImage.seed`，
               *  通过 workflowHints.seedSource="history" 标记。前端优先用此值，回退到用户填值。 */}
              {(() => {
                const params = (current.params ?? {}) as Record<string, unknown>;
                const rawWorkflowInputs = params.workflowInputs;
                const workflowInputs: Array<{
                  nodeId?: string;
                  name: string;
                  value: unknown;
                }> = Array.isArray(rawWorkflowInputs)
                  ? (rawWorkflowInputs as Array<{
                      nodeId?: string;
                      name: string;
                      value: unknown;
                    }>)
                  : [];
                const GEN_ORDER: Array<{ keys: string[]; label: string; hint?: string }> = [
                  { keys: ["seed", "noise_seed", "image_seed"], label: "种子" },
                  { keys: ["steps"], label: "步数" },
                  { keys: ["cfg"], label: "CFG" },
                  { keys: ["sampler_name", "sampler"], label: "采样器" },
                  { keys: ["scheduler"], label: "调度器" },
                  { keys: ["denoise"], label: "去噪" },
                  { keys: ["size", "width"], label: "尺寸" },
                ];
                /** R-ardot63 (2026-08-15): 工作流默认值兜底 —— 同 label 多个源按优先级合并：
                 *  params > workflowInputs > workflowHints.{steps,cfg,...} > TaskImage.{width,height,seed}。
                 *  R-ardot62：seed 优先用 workflowHints.seed（来自 ComfyUI history 真值）。 */
                const wf = (workflowHints ?? {}) as {
                  steps?: number;
                  cfg?: number;
                  sampler_name?: string;
                  scheduler?: string;
                  denoise?: number;
                  width?: number;
                  height?: number;
                  seed?: number;
                  seedSource?: "history" | "subgraph" | "top" | "request" | null;
                };
                const images = current.images ?? [];
                const coverImage =
                  images.length > 0 ? (images.find((im) => im.isCover) ?? images[0]) : null;
                const coverSize =
                  coverImage?.width && coverImage.height
                    ? `${coverImage.width}×${coverImage.height}`
                    : undefined;
                const findVal = (keys: string[]): unknown => {
                  // R-ardot62：seed 优先用 history 真值（最权威），其次用户填值，最后 workflow 元数据。
                  // 但 params[k] 路径在 R-ardot63 之前一直有效，所以保留 ① 顶层 ② workflowInputs ③ workflowHints/coverImage 顺序。
                  for (const key of keys) {
                    const value = params[key];
                    if (value !== undefined && value !== null && value !== "") return value;
                  }
                  for (const key of keys) {
                    const hit = workflowInputs.find(
                      (input) => String(input.name).toLowerCase() === key.toLowerCase()
                    );
                    if (hit?.value !== undefined && hit.value !== null && hit.value !== "")
                      return hit.value;
                  }
                  // R-ardot63 工作流默认值兜底（非随机字段）
                  for (const key of keys) {
                    if (key === "size") {
                      if (wf.width && wf.height) return `${wf.width}×${wf.height}`;
                      if (coverSize) return coverSize;
                    } else if (
                      key === "seed" &&
                      coverImage?.seed != null &&
                      String(coverImage.seed).trim() !== ""
                    ) {
                      return coverImage.seed;
                    } else if (key in wf) {
                      const value = wf[key as keyof typeof wf];
                      if (value !== undefined && value !== null && value !== "") return value;
                    }
                  }
                  return undefined;
                };
                const seenLabels = new Set<string>();
                const genValues: Array<{ label: string; value: unknown; hint?: string }> = [];
                for (const { keys, label, hint } of GEN_ORDER) {
                  if (seenLabels.has(label)) continue;
                  const value = findVal(keys);
                  if (value !== undefined) {
                    genValues.push({ label, value, hint });
                    seenLabels.add(label);
                  }
                }
                // R-ardot62：根据 seed 来源加精准 hint，区分「真值 / 用户填值 / 默认值」。
                if (wf.seed !== undefined) {
                  const seedEntry = genValues.find((item) => item.label === "种子");
                  if (seedEntry) {
                    seedEntry.hint =
                      wf.seedSource === "history"
                        ? "本次执行真实使用值"
                        : wf.seedSource === "request"
                          ? "用户提交时填写的 seed"
                          : undefined;
                  }
                }
                if (genValues.length === 0) {
                  // R-ardot63 空态说明：让用户一眼知道是工作流没暴露参数，不是系统 bug。
                  return (
                    <div className="rounded-lg border border-dashed border-white/8 bg-white/2 px-3 py-2.5 text-xs text-gray-500">
                      本任务所用工作流未暴露常见生成参数（seed/steps/cfg 等在节点硬编码默认值中）。
                      如需查看完整参数，请展开下方的「原始 JSON」。
                    </div>
                  );
                }
                return (
                  <div>
                    <p className="mb-1 text-xs font-semibold text-gray-400">生成参数</p>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 rounded-lg border border-white/6 bg-white/2 p-3 sm:grid-cols-3">
                      {genValues.map((item) => (
                        <div key={item.label} className="flex flex-col gap-0.5">
                          <div className="flex items-baseline gap-2">
                            <span className="shrink-0 text-[11px] text-gray-500">
                              {item.label}
                            </span>
                            <span className="min-w-0 break-words font-mono text-[12px] text-gray-200">
                              {typeof item.value === "string" || typeof item.value === "number"
                                ? String(item.value)
                                : JSON.stringify(item.value)}
                            </span>
                          </div>
                          {item.hint && (
                            <span className="pl-0.5 text-[10px] leading-tight text-gray-500/80">
                              {item.hint}
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                    {genValues.some((item) => item.hint) && (
                      <p className="mt-1 text-[10px] leading-relaxed text-gray-500">
                        注：种子字段在 control_after_generate=randomize 时为默认值，非本次执行的真实种子。
                      </p>
                    )}
                  </div>
                );
              })()}

              {current.error && (
                <div className="rounded-lg bg-red-500/10 p-2.5 text-xs text-red-300">
                  错误：{current.error}
                </div>
              )}

              {/* R-ardot60: 参数展示——把 workflowInputs 抽成可读「参数表」,
               *  再附 raw JSON 块(可换行 wrap,不再撑破 modal)。 */}
              {(() => {
                const params = (current.params ?? {}) as Record<string, unknown>;
                const GEN_KEYS_LOWER = new Set([
                  "seed",
                  "steps",
                  "cfg",
                  "sampler_name",
                  "sampler",
                  "scheduler",
                  "denoise",
                  "size",
                ]);
                const rawWorkflowInputs = params.workflowInputs;
                const workflowInputs: Array<{
                  nodeId?: string;
                  name: string;
                  value: unknown;
                }> = Array.isArray(rawWorkflowInputs)
                  ? (rawWorkflowInputs as Array<{
                      nodeId?: string;
                      name: string;
                      value: unknown;
                    }>).filter(
                      (input) => !GEN_KEYS_LOWER.has(String(input.name).toLowerCase())
                    )
                  : [];
                const topLevelEntries = Object.entries(params).filter(
                  ([k]) => k !== "workflowInputs"
                );
                const hasAny = workflowInputs.length > 0 || topLevelEntries.length > 0;
                if (!hasAny) return null;
                return (
                  <div>
                    <p className="mb-1 text-xs font-semibold text-gray-400">参数</p>

                    {workflowInputs.length > 0 && (
                      <div className="mb-2 overflow-hidden rounded-lg border border-white/6">
                        <table className="w-full text-[11px]">
                          <tbody>
                            {workflowInputs.map((input, i) => (
                              <tr
                                key={(input.nodeId ?? "?") + ":" + input.name + ":" + i}
                                className="border-b border-white/4 last:border-b-0"
                              >
                                <td
                                  className="w-[36%] max-w-[180px] shrink-0 truncate align-top border-r border-white/4 bg-white/2 px-2.5 py-1.5 font-mono text-violet-300"
                                  title={input.name}
                                >
                                  {input.name}
                                </td>
                                <td className="break-words px-2.5 py-1.5 text-gray-200">
                                  {typeof input.value === "string"
                                    ? input.value
                                    : JSON.stringify(input.value)}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}

                    {topLevelEntries.length > 0 && (
                      <details className="rounded-lg border border-white/6 bg-black/30">
                        <summary className="cursor-pointer select-none px-3 py-1.5 text-[11px] text-gray-500 hover:text-gray-300">
                          原始 JSON · {topLevelEntries.length + (workflowInputs.length ? 1 : 0)} 个字段
                        </summary>
                        <pre className="max-w-full whitespace-pre-wrap break-all border-t border-white/6 p-3 text-[11px] text-gray-400">
                          {JSON.stringify(params, null, 2)}
                        </pre>
                      </details>
                    )}
                  </div>
                );
              })()}
            </div>
          ) : (
            <p className="text-sm text-gray-500">未找到任务。</p>
          )}
        </div>
      </div>
    </div>
  );
}
