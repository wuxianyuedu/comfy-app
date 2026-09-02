"use client";

import type { CustomNodesSettingsController } from "./useCustomNodesSettings";

export function WorkflowsTab({ ctrl }: { ctrl: CustomNodesSettingsController }) {
  const { localPathsText, setLocalPathsText, savedLocalPaths, localSaving, localSaveErr, localSavedAt, loading } = ctrl;
  return (
    <>
      {/* 只读扫描器：服务端只从这些目录读取，绝不写入/追加/重命名。自动保存后实际
          扫描惰性发生在 Workflow Library 打开时（GET /api/workflows；结果以「⤓ 未载入」
          卡片出现）。 */}
      <section className="mb-4 rounded-xl border border-border bg-bg p-4">
        <div className="mb-2 flex items-center justify-between">
          <label className="block text-sm font-medium text-ink">
            本地工作流目录（LOCAL_WORKFLOWS_PATH）
          </label>
          <span
            className="rounded-full px-1.5 py-0.5 text-[10px] font-medium"
            style={{ background: "rgba(56,189,248,0.18)", color: "#7DD3FC" }}
            title="服务端只读取、绝不修改这些目录里的任何文件"
          >
            🔒 只读
          </span>
        </div>
        <p className="mb-2 text-xs text-muted-foreground">
          每行一个目录（也可英文逗号分隔）。支持绝对路径，或相对（项目根）路径。
          服务端扫描时会列出其下的 <code className="font-mono">.json</code> / <code className="font-mono">.workflow</code> 文件，
          尚未导入到数据库的会显示在工作流库的「本地工作流」分组里，标题为「⤓ 未载入」，
          点击「载入」才会落库并自动跟踪文件变更。
          <span className="ml-1 text-amber-300/80">目录内容不会被修改。</span>
        </p>
        <textarea
          value={localPathsText}
          onChange={(event) => setLocalPathsText(event.target.value)}
          rows={Math.max(2, Math.min(savedLocalPaths.length || 2, 6))}
          placeholder={
            "示例 ·  C:\\Users\\me\\AppData\\Local\\Programs\\ComfyUI\\resources\\app\\workflows\n" +
            "示例 ·  /home/me/ComfyUI/user/default/workflows"
          }
          /* placeholder 之前用 text-gray-500，太像已填内容导致误判「已配置」。改为
             italic + 更浅 gray-600/60 并加「示例 ·  」前缀，与真实 text-ink 视觉隔离。*/
          className="mb-2 w-full resize-none rounded-lg border border-border bg-surface p-3 font-mono text-xs text-ink outline-none placeholder:italic placeholder:text-gray-600/60 focus:border-primary"
        />
        {/* textarea 真为空且无已存路径时，加一行小灰提示明确「灰字只是示例，需手动输入」。 */}
        {localPathsText.trim() === "" && savedLocalPaths.length === 0 && !localSaving && (
          <p className="mb-2 text-[11px] italic text-gray-500/80">
            ⓘ 上面 textarea 里灰色斜体只是示例路径，请手动输入你本地 ComfyUI 的工作流目录。
          </p>
        )}
        {savedLocalPaths.length > 0 && (
          <ul className="mb-2 space-y-1">
            {savedLocalPaths.map((path, i) => (
              <li
                key={`${path}-${i}`}
                className="flex items-center gap-2 truncate font-mono text-[11px] text-muted-foreground"
                title={path}
              >
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-cyan-400" />
                <span className="truncate">{path}</span>
              </li>
            ))}
          </ul>
        )}
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <div className="flex flex-wrap items-center gap-2">
            {localSaving && (
              <span className="flex items-center gap-1.5 text-primary">
                <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-primary" />
                自动保存中…
              </span>
            )}
            {!localSaving && localSaveErr && (
              <span className="text-red-400">⚠ {localSaveErr}</span>
            )}
            {!localSaving && !localSaveErr && localSavedAt && savedLocalPaths.length > 0 && (
              <span className="text-emerald-400">✓ 已自动保存 {localSavedAt}</span>
            )}
            {/* 之前条件用 !localSavedAt，即便 .env 已存路径也会触发（localSavedAt 仅本会话
                自动保存时设置）。新条件以真实已存值为键：有路径即「已配置」，时间戳是可选点缀。 */}
            {!localSaving && !localSaveErr && !localSavedAt && savedLocalPaths.length > 0 && (
              <span className="text-emerald-400">✓ 已配置（来自 .env）</span>
            )}
            {!localSaving && !localSaveErr && loading && (
              <span className="flex items-center gap-1.5 text-muted-foreground">
                <span className="inline-block h-2 w-2 animate-spin rounded-full border border-muted border-t-transparent" />
                加载中…
              </span>
            )}
            {!localSaving && !localSaveErr && !loading && savedLocalPaths.length === 0 && (
              /* placeholder 已加 italic +「示例 ·  」前缀并配 ⓘ 提示行，这条消息只需简短
                 说「尚未配置」。*/
              <span>尚未配置 — 请在上面的 textarea 里输入你的本地工作流目录</span>
            )}
          </div>
        </div>
      </section>
    </>
  );
}
