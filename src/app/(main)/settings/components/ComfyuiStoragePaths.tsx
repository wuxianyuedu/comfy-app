"use client";

/**
 * 「实例目录（只读）」区块（规范 17 §17.2 第③层：纯展示）。
 *
 * 回答的是「这个 ComfyUI Desktop 实例的模型 / 输入 / 输出到底指向哪个盘符」——
 * 应用此前只能给出目录**名**（`GET /api/models`），绝对路径要去 ComfyUI Desktop
 * 自己开「存储」页看。这里把同一份事实摆在设置页里，省掉一次跨应用往返。
 *
 * 严格只读：本区块不发任何请求、不提供编辑入口。数据来自 controller 的
 * `comfyStorage`（服务端读实例目录形态 + `extra_model_paths.yaml` + 桌面元数据
 * 里的启动参数），非桌面实例为 null（不拿别的形态的目录凑数）。
 *
 * 行数据的组装在 `../comfyui-storage-paths-config`（纯派生，可单测）。
 */

import type { DesktopStoragePaths } from "~/lib/comfyui/desktop-storage-paths";
import { normalizeSlashes } from "~/lib/path-display";
import {
  buildStorageRows,
  describeStorageHint,
  type StoragePathRow,
} from "../comfyui-storage-paths-config";

/** 一个目录行：路径（斜杠统一，便于逐字对照盘符）+ 存在性标注。 */
function StorageDirLine({
  dir,
  shared,
}: {
  dir: StoragePathRow["dirs"][number];
  shared: boolean;
}) {
  const shown = normalizeSlashes(dir.path);
  return (
    <li className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
      <span
        className="text-ink/85 font-mono text-xs break-all"
        title={dir.path}
        data-testid={`storage-dir-${shared ? "shared" : "primary"}`}
      >
        {shown}
      </span>
      {dir.source && (
        <span className="text-muted-foreground text-2xs">
          （来自 {dir.source}）
        </span>
      )}
      {!dir.exists && (
        <span className="text-muted-foreground text-2xs">· 目录不存在</span>
      )}
    </li>
  );
}

export function ComfyuiStoragePaths({
  storage,
}: {
  storage: DesktopStoragePaths | null;
}) {
  // 非桌面实例：没有「实例目录」这回事（它的目录由启动参数逐次决定）。
  if (!storage) return null;

  return (
    <section
      className="border-border mb-4 border-t pt-3"
      aria-label="实例目录（只读）"
    >
      <div className="mb-2 flex flex-wrap items-baseline gap-x-2">
        <h3 className="text-ink text-sm font-medium">实例目录（只读）</h3>
        <span className="text-muted-foreground text-xs">
          模型 / 输入 / 输出指向哪些盘符
        </span>
      </div>
      <dl className="flex flex-col gap-2">
        {buildStorageRows(storage).map((row) => (
          <div key={row.key} className="flex flex-col gap-0.5">
            <dt className="text-muted-foreground text-xs">{row.label}</dt>
            <dd>
              {row.dirs.length === 0 ? (
                <p className="text-muted-foreground text-xs">未配置共享目录</p>
              ) : (
                <ul className="flex flex-col gap-0.5">
                  {row.dirs.map((dir) => (
                    <StorageDirLine
                      key={dir.path}
                      dir={dir}
                      shared={row.key.endsWith("shared")}
                    />
                  ))}
                </ul>
              )}
            </dd>
          </div>
        ))}
      </dl>
      <p className="text-muted-foreground mt-2 text-xs">
        {describeStorageHint(storage)}
      </p>
    </section>
  );
}
