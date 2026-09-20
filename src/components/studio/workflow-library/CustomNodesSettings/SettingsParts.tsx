/* CustomNodesSettings 弹窗的小型展示积木。
 *  PortRow / WidgetValueChip 从原来的单文件
 *  CustomNodesSettings.tsx 原样搬来；ManifestSummary / ParseProgressBanner / ParseConsole
 *  / ReportCards 是从主组件 render 里提出来的低耦合 JSX 区块
 *（状态经 props 显式传入）。 */

import type { RefObject } from "react";
import { STATUS_STYLE } from "./constants";
import { StatusDot } from "~/components/ui/status-dot";
import { StatusBadge } from "~/components/ui/status-badge";
import type { ParseProgress, ParseReport, SettingsResp } from "./types";
import { displayValue } from "~/lib/display-value";
import { lastSegments } from "~/lib/path-display";
import { ProgressBar } from "~/components/ui/progress-bar";
import { toPct } from "~/lib/progress";

/** 类型端口区的一行 —— 小彩点 + 大写类型章
 *  + 端口名。ComfyUI 真实节点把圆点放在画布边缘、
 *  把名字 + 类型章放在卡片内部；我们镜像这套几何，
 *  好让每个端口行一眼读出它属于节点哪一侧。 */
export function PortRow({
  side,
  color,
  type,
  name,
}: {
  side: "in" | "out";
  color: string;
  type: string;
  name: string;
}) {
  const isOut = side === "out";
  // ComfyUI 给输出固定用青色调，输入则按类别派生。
  // 输出侧的青色是「类型色」的近亲（见 constants.ts 的豁免登记），与
  // `workflow-param-mapping-ui` 的 `PARAM_CLASS_COLOR` 同源。
  const dotColor = isOut ? "#06B6D4" : color;
  return (
    <div
      className={`flex min-w-0 items-center gap-1 ${isOut ? "flex-row-reverse" : ""}`}
    >
      <span
        className="inline-block shrink-0 rounded-full"
        style={{ width: 7, height: 7, background: dotColor }}
      />
      <span
        className="rounded px-1 text-[7.5px] leading-tight font-bold uppercase"
        style={{
          color,
          border: `1px solid ${color}66`,
          letterSpacing: 0.4,
        }}
      >
        {type}
      </span>
      <span
        className={`text-ink-soft min-w-0 truncate text-[10.5px] font-semibold ${
          isOut ? "text-right" : ""
        }`}
        title={name}
        style={isOut ? { textAlign: "right" } : undefined}
      >
        {name}
      </span>
    </div>
  );
}

/** 右对齐的章，显示 widget 的默认值，按 widget 类型着色，
 *  好让用户一眼分辨：字符串 / 数字 / 布尔 / 下拉
 *  各有一套截然不同的色系。镜像 ComfyUI 自己节点渲染
 *  逐 widget 取值章的方式。 */

/** 把 widget 值安全转成展示文本：对象走 JSON，null/undefined 给空串，其余 String。
 *
 *  「空值显示什么」由调用处经 `displayValue` 决定 —— 这里只负责「有值时
 *  怎么成文本」，返回空串即表示「没值」。 */
function widgetValueToText(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "object") return JSON.stringify(v);
  if (typeof v === "string") return v;
  if (typeof v === "number") return String(v);
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "bigint") return v.toString();
  if (typeof v === "symbol") return v.toString();
  if (typeof v === "function") return v.toString();
  return "";
}

export function WidgetValueChip({
  widget,
  value,
}: {
  widget: string | null;
  value: unknown;
}) {
  if (widget === "toggle") {
    const on = value === true || value === "true" || value === "True";
    return (
      <span
        className={`rounded px-1.5 py-px font-mono text-[10px] font-semibold ${
          on
            ? "bg-success-strong/18 text-success-strong"
            : "bg-red-500/18 text-red-600 dark:text-red-400"
        }`}
      >
        {on ? "✓" : "✗"}
      </span>
    );
  }
  if (widget === "select") {
    return (
      <span
        className="max-w-[100px] truncate rounded bg-violet-500/18 px-1.5 py-px font-mono text-[10px] font-semibold text-violet-700 dark:text-violet-300"
        title={widgetValueToText(value)}
      >
        {displayValue(widgetValueToText(value))}
      </span>
    );
  }
  if (widget === "number") {
    return (
      <span
        className="bg-warning/18 text-warning max-w-[100px] truncate rounded px-1.5 py-px font-mono text-[10px] font-semibold"
        title={widgetValueToText(value)}
      >
        {displayValue(widgetValueToText(value))}
      </span>
    );
  }
  // 字符串 / 文本 / 图片 / latent / 未知
  return (
    <span
      className="bg-canvas-deep text-ink-soft max-w-[140px] truncate rounded px-1.5 py-px font-mono text-[10px]"
      title={widgetValueToText(value)}
    >
      {displayValue(widgetValueToText(value))}
    </span>
  );
}

/** 「当前清单」单行清单摘要 —— 从主组件
 *  的「nodes」页签 render 原样提出。 */
export function ManifestSummary({
  summary,
}: {
  summary: NonNullable<SettingsResp["summary"]>;
}) {
  return (
    <div className="border-border bg-bg text-muted-foreground mb-4 rounded-lg border px-3 py-2 text-xs">
      当前清单：共 <b className="text-ink">{summary.totalNodes}</b> 个节点类型
      {summary.generatedAt ? ` · 生成于 ${summary.generatedAt}` : ""}
      {summary.missingPaths?.length
        ? ` · ⚠️ ${summary.missingPaths.length} 个目录未找到`
        : ""}
    </div>
  );
}

/** 两阶段解析进度条（扫描 → 哈希）—— 从
 *  主组件的「nodes」页签 render 原样提出。只在 `loading` 且尚无
 *  摘要时渲染（条件由调用方维持）。 */
export function ParseProgressBanner({ progress }: { progress: ParseProgress }) {
  return (
    <div className="border-border bg-bg/50 text-muted-foreground mb-4 rounded-lg border border-dashed px-3 py-3 text-xs">
      {/* 顶行：当前阶段 + 包计数（用户最关心的）。.py 文件数
          已去掉 —— 用户明说它没用。 */}
      <div className="flex items-center gap-2">
        <StatusDot state="busy" sizeClass="size-2" pulse />
        {progress.phase === "hash" && progress.total > 0 ? (
          <span className="text-ink">
            🔎 正在处理{" "}
            <span className="font-mono">
              {progress.done}/{progress.total}
            </span>{" "}
            个节点包
            {progress.parent && (
              <span
                className="text-muted-foreground ml-2 truncate font-mono text-[11px]"
                title={progress.parent}
              >
                · {lastSegments(progress.parent, 2)}
              </span>
            )}
          </span>
        ) : progress.phase === "scan" && progress.discovered > 0 ? (
          <span className="text-ink">
            📦 已发现 <span className="font-mono">{progress.discovered}</span>{" "}
            个节点包
            <span className="text-muted-foreground ml-2 text-[11px]">
              （总数待定，正在扫描…）
            </span>
          </span>
        ) : (
          <span>首次扫描目录中的节点包…</span>
        )}
      </div>
      {/* 进度条：扫描阶段是不确定的（条纹滑动）；哈希阶段是确定的 K/M。
          `progress.total > 0` 只在文件遍历结束、解析器宣布 M 时才翻真，
          所以条子能干净地从扫描（不定态）过渡到哈希（确定态）。
          「总数未知 → 不确定态」的换算收在 `~/lib/progress` 的 `toPct`。 */}
      <ProgressBar
        value={
          progress.phase === "hash" && progress.total > 0
            ? toPct(progress.done, progress.total)
            : null
        }
        showValue={false}
        className="mt-2"
        trackClassName="bg-surface-2 h-1.5"
        fillClassName="duration-300 ease-out"
      />
      {progress.msg && (
        <div
          className="text-muted-foreground mt-1.5 truncate font-mono text-[10px]"
          title={progress.msg}
        >
          {progress.msg}
        </div>
      )}
    </div>
  );
}

/** 实时解析控制台（日志列表）—— 从主组件的
 *  「nodes」页签 render 原样提出。两个滚动 ref 属于主组件的
 *  自动滚动 effect，原样透传。 */
export function ParseConsole({
  logs,
  parsing,
  logsRef,
  consoleRef,
}: {
  logs: { level: string; msg: string }[];
  parsing: boolean;
  logsRef: RefObject<HTMLDivElement | null>;
  consoleRef: RefObject<HTMLDivElement | null>;
}) {
  return (
    <div ref={logsRef} className="mb-4">
      <div className="mb-1 flex items-center justify-between">
        <span className="text-muted-foreground text-xs font-medium">
          解析日志
        </span>
        {parsing && (
          <span className="text-primary flex items-center gap-1.5 text-xs">
            <StatusDot state="busy" sizeClass="size-2" pulse />
            解析中…
          </span>
        )}
      </div>
      {logs.length === 0 ? (
        <div className="border-border bg-bg/30 text-muted-foreground rounded-lg border border-dashed p-3 text-center text-[11px]">
          {parsing
            ? "等待第一条日志…"
            : "点击「解析全部」或「导入此包」后日志会出现在这里。"}
        </div>
      ) : (
        <div
          ref={consoleRef}
          className="border-border h-48 overflow-y-auto rounded-lg border bg-black/70 p-3 font-mono text-[11px] leading-relaxed"
        >
          {logs.map((log, idx) => (
            <div
              key={`log-${idx}`}
              data-log-row
              className={
                log.level === "error"
                  ? "text-red-700 dark:text-red-400"
                  : "text-emerald-700 dark:text-emerald-300/90"
              }
            >
              {log.msg}
            </div>
          ))}
          {parsing && <div className="text-ink-muted">…</div>}
        </div>
      )}
    </div>
  );
}

/** 按包的报告卡片（「最近解析结果」）—— 从主组件
 *  的「nodes」页签 render 原样提出。 */
export function ReportCards({ report }: { report: ParseReport }) {
  return (
    <div className="mt-2">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-ink text-sm font-medium">最近解析结果</span>
        <span className="text-muted-foreground text-xs">
          {report.mode === "subset"
            ? `增量 +${report.addedNodes ?? 0}`
            : `${report.pathCount} 个目录 · ${report.totalNodes} 个节点`}
          {report.errorCount ? ` · ${report.errorCount} 个错误` : ""}
        </span>
      </div>
      <div className="space-y-2">
        {(report.packages ?? []).map((pkg) => {
          const st = STATUS_STYLE[pkg.status] ?? STATUS_STYLE.ok;
          return (
            <div
              key={pkg.name}
              className="border-border bg-bg rounded-xl border p-3"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-ink font-medium">{pkg.name}</span>
                    <StatusBadge
                      status={pkg.status === "ok" ? "SUCCEEDED" : pkg.status}
                      label={st!.label}
                      dot={false}
                      className="px-2 py-0.5 text-[11px]"
                    />
                  </div>
                  <div
                    className="text-muted-foreground truncate font-mono text-[11px]"
                    title={pkg.path}
                  >
                    {/* 绝对路径的**语义在尾部**（哪个目录下的包）—— CSS `truncate`
                        只留头部，恰好把它切掉，故这里显式取末几段。 */}
                    {lastSegments(pkg.path, 3)}
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <div className="text-ink-bright text-lg font-semibold">
                    {pkg.nodeCount}
                  </div>
                  <div className="text-muted-foreground text-[11px]">
                    节点类型
                  </div>
                </div>
              </div>
              {pkg.nodeTypes?.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {pkg.nodeTypes.slice(0, 24).map((ct) => (
                    <span
                      key={ct}
                      className="bg-subtle text-muted-foreground rounded-md px-1.5 py-0.5 font-mono text-[11px]"
                    >
                      {ct}
                    </span>
                  ))}
                  {pkg.nodeTypes.length > 24 && (
                    <span className="bg-subtle text-muted-foreground rounded-md px-1.5 py-0.5 font-mono text-[11px]">
                      +{pkg.nodeTypes.length - 24}
                    </span>
                  )}
                </div>
              )}
              {pkg.errors?.length > 0 && (
                <div className="mt-2 space-y-1">
                  {pkg.errors.map((er, j) => (
                    <div
                      key={j}
                      className="font-mono text-[11px] text-red-700 dark:text-red-400"
                    >
                      ⚠ {er.file}: {er.error}
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
