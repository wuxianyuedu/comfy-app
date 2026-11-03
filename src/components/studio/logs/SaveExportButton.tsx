"use client";

import { HardDriveDownload } from "lucide-react";

import { Button } from "~/components/ui/button";
import { Hint } from "~/components/ui/hint";
import { useFlashLatch } from "~/components/ui/use-flash-state";
import { useLogPanel } from "./LogProvider";

/** 「已保存」回执的停留时长：8s。比默认长得多 —— 它要给出一个**路径**，
 *  用户得看清并可能抄下来，而路径比「已复制」三个字长得多。 */
const SAVED_FLASH_MS = 8000;

/* 「未亮起」的空载荷：模块级常量，身份稳定（见 `useFlashLatch`）。 */
const EMPTY_SAVED: { failed: boolean; savedPath: string | null } = {
  savedPath: null,
  failed: false,
};

/**
 * 日志面板的「保存到本地」按钮（服务端落盘）：用户反馈「运行日志没看到本地有保存」，`<a download>`
 * 在 WebView2 里存不存由宿主决定。改为经 `POST /api/logs/export` 写进 `log/exports/` 并显示路径；
 * 反馈本地自持：成功「已保存」+ 路径、失败「保存失败」（不谎报）。
 */
export function SaveExportButton({
  label,
  scopeLabel,
  total,
}: {
  /** 导出的来源标签（进文件名，服务端有白名单兜底）。 */
  label: string;
  /** 当前筛选的中文摘要（写进悬停提示，用户知道存下来的是哪一类）。 */
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
      /* `relativePath` 收成局部变量：`ok` 这个布尔量记不住「里面那个字段非空」，
       * 在原地补 `!` 等于让类型替运行时兜底。 */
      const relativePath = result.ok ? (result.relativePath ?? null) : null;
      saved.flash({
        savedPath: relativePath,
        failed: relativePath === null || relativePath === "",
      });
    });
  };

  return (
    <span className="flex items-center gap-1">
      <Hint label={`保存当前筛选的全部日志到本机 log/exports/（${scopeLabel} · ${total} 条）`}>
        <Button
          aria-label="保存当前筛选的全部日志到本地文件"
          className={`hover:bg-subtle hover:text-ink rounded-md ${
            failed ? "text-danger-strong" : "text-ink-muted"
          }`}
          onClick={onSave}
          size="icon"
          variant="ghost"
        >
          <HardDriveDownload size={16} />
        </Button>
      </Hint>
      {/* 路径就是这次保存的「回执」：没有它，用户只能自己去猜文件在哪。 */}
      {savedPath !== null && savedPath !== "" && (
        <span className="text-ink-fainter text-2xs max-w-56 truncate" title={savedPath}>
          已保存 {savedPath}
        </span>
      )}
      {failed && <span className="text-danger-strong text-2xs">保存失败</span>}
    </span>
  );
}
