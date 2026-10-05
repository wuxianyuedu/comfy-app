"use client";

import { PackageSearch } from "lucide-react";

import { Button } from "~/components/ui/button";
import { Hint } from "~/components/ui/hint";
import { useFlashLatch } from "~/components/ui/use-flash-state";
import { useLogPanel } from "./LogProvider";

/** 「已打包」回执的停留时长：与 `SaveExportButton` 同档 —— 它同样要给一个**路径**。 */
const SAVED_FLASH_MS = 8000;

/* 「未亮起」的空载荷：模块级常量，身份稳定（见 `useFlashLatch`）。 */
const EMPTY_SAVED: { savedPath: string | null; failed: boolean } = {
  savedPath: null,
  failed: false,
};

/**
 * 「打包诊断」按钮：把**本次运行 + 最近几次历史**打成一个 zip。
 *
 * 与 `SaveExportButton` 的分工是刻意的，两者不可互相替代：
 *   - 「保存到本地」存的是**面板当前筛选到的行**（用户看得见的东西）；
 *   - 这一个带走的是**诊断要的整份现场**：
 *     `run.json`（runId / 版本 / 分支 / commit / 各 pid / 退出码 / 耗时）、
 *     上一次崩溃留下的残留（`crashed: true`）、comfyui 通信层原始回执 ——
 *     这些在面板上根本看不到，而报 bug 时恰恰最有用。
 *
 * 用户报问题时只要点一下、把路径里的那个文件发过来，比让他截图、或者去文件
 * 管理器里翻 `log/` 挑几个文件打包靠谱得多（ISSUE #1326）。
 *
 * 落盘在服务端（`POST /api/logs/diagnostics`），理由与「保存到本地」同一条：
 * 桌面壳里浏览器下载不保证落盘，而排障要的是「文件确实在、路径说得出来」。
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
          variant="ghost"
          size="icon"
          onClick={onPackage}
          aria-label="打包诊断现场到本地文件"
          className={`hover:bg-subtle hover:text-ink rounded-md ${
            failed ? "text-danger-strong" : "text-ink-muted"
          }`}
        >
          <PackageSearch size={16} />
        </Button>
      </Hint>
      {/* 路径就是这次打包的「回执」：没有它，用户只能自己去猜文件在哪。 */}
      {savedPath && (
        <span
          className="text-ink-fainter text-2xs max-w-56 truncate"
          title={savedPath}
        >
          已打包 {savedPath}
        </span>
      )}
      {failed && <span className="text-danger-strong text-2xs">打包失败</span>}
    </span>
  );
}
