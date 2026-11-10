"use client";

/**
 * 「实例目录（只读）」区块（规范 17 §17.2 第③层：纯展示，不发请求、不提供编辑）。
 * 数据来自 controller 的 `comfyStorage`（服务端读实例目录形态 + `extra_model_paths.yaml`
 * + 桌面启动参数），非桌面实例为 null；组装在 `../comfyui-storage-paths-config`（纯派生）。
 */

import type { DesktopStoragePaths } from "~/lib/comfyui/desktop-storage-paths";
import { normalizeSlashes } from "~/lib/path-display";
import { SETTINGS_ROW_CLASS } from "~/components/ui/settings-card";
import {
  buildStorageRows,
  describeStorageHint,
  type StoragePathRow,
} from "../comfyui-storage-paths-config";

/** 一个目录行：路径（斜杠统一，便于逐字对照盘符）+ 存在性标注。 */
function StorageDirLine({ dir, shared }: { dir: StoragePathRow["dirs"][number]; shared: boolean }) {
  const shown = normalizeSlashes(dir.path);
  return (
    <li className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
      <span
        className="text-ink/85 font-mono text-xs break-all"
        data-testid={`storage-dir-${shared ? "shared" : "primary"}`}
        title={dir.path}
      >
        {shown}
      </span>
      {dir.source !== null && dir.source !== "" && (
        <span className="text-muted-foreground text-2xs">（来自 {dir.source}）</span>
      )}
      {!dir.exists && <span className="text-muted-foreground text-2xs">· 目录不存在</span>}
    </li>
  );
}

export function ComfyuiStoragePaths({ storage }: { storage: DesktopStoragePaths | null }) {
  // 非桌面实例：没有「实例目录」这回事（它的目录由启动参数逐次决定）。
  if (!storage) {
    return null;
  }

  return (
    <section aria-label="实例目录（只读）" className="border-border mb-4 border-t pt-3">
      <div className="mb-2 flex flex-wrap items-baseline gap-x-2">
        <h3 className="text-ink text-sm font-medium">实例目录（只读）</h3>
        <span className="text-muted-foreground text-xs">模型 / 输入 / 输出指向哪些盘符</span>
      </div>
      <dl className="flex flex-col gap-2">
        {buildStorageRows(storage).map((row) => (
          /* 每组目录一块**独立的承载面**（ISSUE #3519，用户现场：「这部分内容显示的
             乱糟糟的」）：此前标签是弱一档的灰、路径与说明挤成一整片，读起来像一堵
             字墙。现在标签提到正文档、每组一块行表面（与设置页其它「卡片内的一行」
             同一档 `SETTINGS_ROW_CLASS`），组与组之间也就有了间隔。 */
          <div className={`${SETTINGS_ROW_CLASS} flex flex-col gap-1`} key={row.key}>
            <dt className="text-ink text-xs font-medium">{row.label}</dt>
            <dd>
              {row.dirs.length === 0 ? (
                <p className="text-muted-foreground text-xs">未配置共享目录</p>
              ) : (
                <ul className="flex flex-col gap-0.5">
                  {row.dirs.map((dir) => (
                    <StorageDirLine dir={dir} key={dir.path} shared={row.key.endsWith("shared")} />
                  ))}
                </ul>
              )}
            </dd>
          </div>
        ))}
      </dl>
      <p className="text-muted-foreground mt-2 text-xs">{describeStorageHint(storage)}</p>
    </section>
  );
}
