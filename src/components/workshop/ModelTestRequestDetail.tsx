"use client";

// ── 「测试模型能力」请求详情面板（ISSUE #3791 / #3799 / #3949 需求 4/8）────
// 从 ModelTestView 拆出（§12.13：函数长度硬闸的第二刀）—— 只渲染，读数与
// 开关都由 props 给。生成后显示真实读数；生成前显示「准备请求」（#3949 需求 8，
// #3995：同时可见「本地提交 + 实际请求」两部分）。

import { useState } from "react";

import { useInterval } from "~/components/ui/use-interval";
import { SectionLabel } from "~/components/ui/section-label";
import { SelectChip } from "~/components/ui/select-chip";
import { TruncatedText } from "~/components/ui/truncated-text";
import { cn } from "~/lib/utils";
import type { ApiCallDebugRow } from "~/lib/workshop/api-channel-core";

/** 生成中已过时间（ISSUE #3799；#3949 需求 3）：本地 500ms 一跳，只重渲自己
 *  这格文本；生成结束后组件随行消失（行徽标换回「已发送」）。显示按**整秒**
 *  走 —— 500ms 的节拍撑不起 0.1s 的精度，一位小数只会 1.4→1.9→2.4 地跳。 */
function GeneratingElapsed({ since }: { since: number }) {
  const [now, setNow] = useState(() => Date.now());
  /* 走秒走 useInterval（P12：视图里不自写 setInterval）。 */
  useInterval(
    () => {
      setNow(Date.now());
    },
    { ms: 500 },
  );
  return <>进行中 {Math.max(0, Math.floor((now - since) / 1000))}s</>;
}

/** 响应摘要的格式化显示（ISSUE #3799）：结构化摘要默认 JSON 缩进；
 *  万一是字符串（历史读数）原样给出。 */
function prettyOrRaw(excerpt: unknown): string {
  if (typeof excerpt === "string") {
    return excerpt;
  }
  return JSON.stringify(excerpt, null, 2) ?? "";
}

/** 请求详情面板（ISSUE #3791；#3799：点生成即显示本地提交行 + 生成中走秒 +
 *  响应摘要默认格式化、可切原始；#3949 需求 4/8：生成前显示「准备请求」、
 *  按模式 / 模型隔离、解释换算字段；#3995：生成前同时可见「本地提交 +
 *  实际请求」两行预览）。 */
export function RequestDetailSection(props: {
  excerptPretty: boolean;
  generating: boolean;
  generatingSince: number | null;
  onExcerptPretty: (pretty: boolean) => void;
  previewOnly: boolean;
  rows: Array<ApiCallDebugRow>;
}) {
  const { excerptPretty, generating, generatingSince, onExcerptPretty, previewOnly, rows } = props;
  return (
    <section className="flex flex-col gap-2">
      <SectionLabel
        hint={
          previewOnly
            ? "生成前预览：「本地提交」= 前端发给中继的统一输入；「实际请求」= 经模型适配器翻译后真正发往上游的请求（密钥在请求头，不在此显示；请求体里的长值已截断）"
            : "本次生成实际发出的请求（密钥在请求头，不在此显示；请求体里的长值已截断）"
        }
      >
        请求详情{previewOnly ? "（准备请求 · 未发送）" : ""}
      </SectionLabel>
      <div className="flex items-center gap-1.5">
        <span className="text-muted-foreground text-2xs">响应摘要</span>
        <SelectChip
          onClick={() => {
            onExcerptPretty(true);
          }}
          selected={excerptPretty}
          shape="pill"
        >
          格式化
        </SelectChip>
        <SelectChip
          onClick={() => {
            onExcerptPretty(false);
          }}
          selected={!excerptPretty}
          shape="pill"
        >
          原始
        </SelectChip>
      </div>
      {rows.map((row, i) => (
        <div
          className="border-border bg-bg overflow-hidden rounded-lg border"
          key={`${row.phase}-${String(i)}`}
        >
          <div className="flex flex-wrap items-center gap-2 px-3 py-2 text-xs">
            {row.phase === "relay" ? (
              /* 本地提交行（#3799）：点生成即出现；生成中走秒。
                  #3949 需求 8 / #3995：生成前是「准备请求」（未发送）。 */
              <span className="bg-primary/12 text-primary-strong text-2xs rounded-full px-2 py-0.5 tabular-nums">
                {previewOnly ? (
                  "准备请求"
                ) : generating && generatingSince !== null ? (
                  <GeneratingElapsed since={generatingSince} />
                ) : (
                  "已发送"
                )}
              </span>
            ) : previewOnly ? (
              /* 预览行（ISSUE #3995）：还没发出去，不冒充真实读数 ——
                  status=null 的既有读法是给已发送行准备的「网络失败」。 */
              <span className="bg-elevated text-muted-foreground text-2xs rounded-full px-2 py-0.5 tabular-nums">
                未发送
              </span>
            ) : (
              <span
                className={cn(
                  "rounded-full px-2 py-0.5 text-2xs tabular-nums",
                  row.ok
                    ? "bg-elevated text-muted-foreground"
                    : "bg-destructive/10 text-destructive",
                )}
              >
                {row.status === null ? "网络失败" : `HTTP ${String(row.status)}`}
              </span>
            )}
            <span className="text-muted-foreground text-2xs">
              {row.phase === "relay"
                ? "本地提交"
                : row.phase === "local-task"
                  ? "本地任务"
                  : previewOnly
                    ? "实际请求"
                    : row.phase === "image"
                      ? "生图"
                      : row.phase === "video-submit"
                        ? "视频提交"
                        : "视频轮询"}
            </span>
            {row.durationMs !== null && (
              <span className="text-muted-foreground text-2xs tabular-nums">
                {String(row.durationMs)}ms
              </span>
            )}
            <TruncatedText className="min-w-0 flex-1 truncate font-mono">
              {row.endpoint}
            </TruncatedText>
          </div>
          <pre className="border-border/60 text-2xs overflow-x-auto border-t px-3 py-2 font-mono break-all whitespace-pre-wrap">
            {JSON.stringify(row.body, null, 2)}
          </pre>
          {row.excerpt !== null && row.excerpt !== undefined && (
            <pre className="text-muted-foreground border-border/60 text-2xs overflow-x-auto border-t px-3 py-2 font-mono break-all whitespace-pre-wrap">
              {excerptPretty ? prettyOrRaw(row.excerpt) : (JSON.stringify(row.excerpt) ?? "")}
            </pre>
          )}
        </div>
      ))}
      {/* #3949 需求 4：megapixels / multiple 不是用户填的，是所选
          「比例 + 分辨率」按本机尺寸表换算出的等价写法（适配器映射了
          哪个就下发哪个）—— 在这里讲清楚，不让人猜。 */}
      {previewOnly && (
        <p className="text-muted-foreground text-2xs">
          megapixels / multiple 由所选「比例 + 分辨率」按本机尺寸表换算得出 （与 resolution
          同口的等价写法），随请求一并下发；适配器映射了哪个 就下发哪个。
        </p>
      )}
    </section>
  );
}
