"use client";

import { PackageSearch } from "lucide-react";

import { Button } from "~/components/ui/button";
import { Hint } from "~/components/ui/hint";
import { useFlashLatch } from "~/components/ui/use-flash-state";
import { useLogPanel } from "./LogProvider";

/** 「已打包」回执的停留时长：与 `SaveExportButton` 同档 —— 它同样要给一个**路径**。 */
const SAVED_FLASH_MS = 8000;

/* 「未亮起」的空载荷：模块级常量，身份稳定（见 `useFlashLatch`）。 */
const EMPTY_SAVED: { failed: boolean; savedPath: string | null } = {
  savedPath: null,
  failed: false,
};

/**
 * 「打包诊断」按钮：本次运行 + 最近几次历史打成 zip，落盘在 `POST /api/logs/diagnostics`
 * （桌面壳里浏览器下载不保证落盘）。与 `SaveExportButton` 不可互换：那个存面板当前筛选的行，
 * 这个带走诊断整份现场（`run.json`、崩溃残留、comfyui 原始回执），点一下把路径发过来即可（ISSUE #1326）。
 */
export function DiagnosticsButton() {
  const saveDiagnostics = useLogPanel((state) => state.saveDiagnostics);
  /* 与 `SaveExportButton` 同款：成功回执与失败标记必须**同生共死**，两个独立
   * 定时器在时长一改就会漂移，留下自相矛盾的画面（见 `useFlashLatch`）。 */
  const saved = useFlashLatch(SAVED_FLASH_MS, EMPTY_SAVED);
  const { savedPath, failed } = saved.value;

  const onPackage = () => {
    void saveDiagnostics().then((result) => {
      // 判据与取值同一处落地：`ok` 与路径都由 `relativePath` 的有无决定，
      // 不用非空断言把「同一件事」说两遍（§18 的空值口径）。
      const relativePath = result.ok ? (result.relativePath ?? null) : null;
      saved.flash({
        savedPath: relativePath,
        failed: relativePath === null,
      });
    });
  };

  return (
    <span className="flex items-center gap-1">
      <Hint label="打包本次运行与最近几次的历史日志（含 run.json 环境信息）到 log/exports/">
        <Button
          aria-label="打包诊断现场到本地文件"
          className={`hover:bg-subtle hover:text-ink rounded-md ${
            failed ? "text-danger-strong" : "text-ink-muted"
          }`}
          onClick={onPackage}
          size="icon"
          variant="ghost"
        >
          <PackageSearch size={16} />
        </Button>
      </Hint>
      {/* 路径就是这次打包的「回执」：没有它，用户只能自己去猜文件在哪。 */}
      {savedPath !== null && savedPath !== "" && (
        <span className="text-ink-fainter text-2xs max-w-56 truncate" title={savedPath}>
          已打包 {savedPath}
        </span>
      )}
      {failed && <span className="text-danger-strong text-2xs">打包失败</span>}
    </span>
  );
}
