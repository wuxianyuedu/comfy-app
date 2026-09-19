"use client";

import { HardDriveDownload } from "lucide-react";

import { Button } from "~/components/ui/button";
import { useFlashLatch } from "~/components/ui/use-flash-state";
import { useLogPanel } from "./LogProvider";

/** 「已保存」回执的停留时长：8s。比默认长得多 —— 它要给出一个**路径**，
 *  用户得看清并可能抄下来，而路径比「已复制」三个字长得多。 */
const SAVED_FLASH_MS = 8000;

/* 「未亮起」的空载荷：模块级常量，身份稳定（见 `useFlashLatch`）。 */
const EMPTY_SAVED: { savedPath: string | null; failed: boolean } = {
  savedPath: null,
  failed: false,
};

/**
 * 日志面板的「保存到本地」按钮（服务端落盘，不是浏览器下载）。
 *
 * 用户反馈第 3 条：「应用运行日志，没看到本地有保存」。面板此前只有「下载为
 * 文本文件」——`<a download>` 在桌面壳（WebView2）里存不存、存到哪由宿主决定，
 * 用户点完常常本地什么都没有。这里改为经 `POST /api/logs/export` 让**服务端**
 * 写进 `log/exports/`，再把路径显示出来：排障时「文件在哪」必须是可引用的事实。
 *
 * 反馈按按钮本地自持（与行内复制按钮同一套口径）：
 *   - 成功 → 按钮改口「已保存」，并在旁边标出 `log/exports/xxx.txt`；
 *   - 失败 → 「保存失败」（不谎报成功，否则用户会去一个不存在的路径找文件）；
 *   - 过一会儿回到初始态，路径也一并收起来，不常驻占宽。
 */
export function SaveExportButton({
  label,
  scopeLabel,
  total,
}: {
  /** 导出的来源标签（进文件名，服务端有白名单兜底）。 */
  label: string;
  /** 当前筛选的中文摘要（写进 title，用户知道存下来的是哪一类）。 */
  scopeLabel: string;
  total: number;
}) {
  const saveExport = useLogPanel((state) => state.saveExport);
  /* 「已保存 <路径>」与失败标记必须**同生共死**（见 `useFlashLatch`）：
   * 两个独立定时器在时长一改就会漂移，留下「已保存」还在、失败标记已经
   * 消失的自相矛盾画面。 */
  const saved = useFlashLatch(SAVED_FLASH_MS, EMPTY_SAVED);
  const { savedPath, failed } = saved.value;

  /* 用 `.then` 而不是 `async` 处理器：逻辑层已经是 Promise，这里只负责把
   * 结果翻成三种可见状态（不用在视图里写 async 状态机，见规范 17）。 */
  const onSave = () => {
    void saveExport(label).then((result) => {
      const ok = result.ok && result.relativePath;
      saved.flash({
        savedPath: ok ? result.relativePath! : null,
        failed: !ok,
      });
    });
  };

  return (
    <span className="flex items-center gap-1">
      <Button
        variant="ghost"
        size="icon"
        onClick={onSave}
        title={`保存当前筛选的全部日志到本机 log/exports/（${scopeLabel} · ${total} 条）`}
        aria-label="保存当前筛选的全部日志到本地文件"
        className={`hover:bg-subtle hover:text-ink rounded-md ${
          failed ? "text-danger-strong" : "text-ink-muted"
        }`}
      >
        <HardDriveDownload size={16} />
      </Button>
      {/* 路径就是这次保存的「回执」：没有它，用户只能自己去猜文件在哪。 */}
      {savedPath && (
        <span
          className="text-ink-fainter max-w-56 truncate text-[11px]"
          title={savedPath}
        >
          已保存 {savedPath}
        </span>
      )}
      {failed && (
        <span className="text-danger-strong text-[11px]">保存失败</span>
      )}
    </span>
  );
}
