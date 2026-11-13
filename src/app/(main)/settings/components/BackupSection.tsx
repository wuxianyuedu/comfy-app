"use client";

/**
 * 数据库备份 / 恢复分区（规范 17 §17.2 第③层）。
 * 「选哪一份」用 `pendingRestore` 现推，不另开本地 state —— 服务端已是持有者，
 * 视图再记一遍会出现「登记了 A、界面高亮 B」。
 */

import { useState } from "react";

import { SettingsCard, SETTINGS_ROW_CLASS } from "~/components/ui/settings-card";
import { Button } from "~/components/ui/button";
import { displayValue } from "~/lib/display-value";
import { fmtBytes } from "~/lib/format-bytes";
import { formatLocalStamp } from "~/lib/time-format";

import { StatusButton } from "~/components/ui/service-status-row";
import type { BackupEntry } from "../hooks/use-settings-page-backup";
import type { ReadySettingsPageController } from "../hooks/use-settings-page";

/** 一份备份的展示行：名字（= 认人用的那个标识）+ 时刻 + 大小。 */
function BackupRow({
  entry,
  pending,
  disabled,
  onRestore,
}: {
  disabled: boolean;
  entry: BackupEntry;
  onRestore: (name: string) => void;
  pending: boolean;
}) {
  const size = fmtBytes(entry.size);
  return (
    <div className={`${SETTINGS_ROW_CLASS} flex items-center gap-3`}>
      <span className="text-ink/80 min-w-0 flex-1 truncate font-mono text-xs">{entry.name}</span>
      <span className="text-muted-foreground shrink-0 text-xs">
        {/* 缺值占位符走 `~/lib/display-value`（规范 16 §16.2.3 的 P8）：
            名字形态认不出时刻时 `at` 是 null —— 那与「读到了 0 时刻」是两件事，
            这个出口已经把这条判据收在一处。 */}
        {entry.at === null ? displayValue(null) : formatLocalStamp(entry.at)}
        {size === null ? "" : ` · ${size}`}
      </span>
      <Button
        className="h-auto shrink-0 rounded px-2 py-0.5 text-xs"
        disabled={disabled || pending}
        onClick={() => {
          onRestore(entry.name);
        }}
        size="xs"
        variant={pending ? "primary-solid" : "outline"}
      >
        {pending ? "已登记" : "用这一份恢复"}
      </Button>
    </div>
  );
}

export function BackupSection({ c }: { c: ReadySettingsPageController }) {
  /* 「接下来要不要重启」的本地确认态：换文件还没发生，按钮点下去之后要有一句
   * 明确的话让人知道**下一步做什么**，而不是弹个 toast 就完事。 */
  const [confirming, setConfirming] = useState<string | null>(null);

  return (
    <>
      <SettingsCard title="创建备份">
        {/* 段内正文一律 `text-xs`：`text-sm` 是**表单标签与控件值**那一档，
            正文段落用它会让一屏里的两档字（14px 正文 / 14px 标签）分不开，
            说明文字反而比它解释的控件更抢眼。卡片标题 → 标签 → 正文 →
            元信息，四档依次是 section / 标签 / 12px / 2xs（§3.10 的字阶表）。 */}
        <p className="text-muted-foreground mb-3 text-xs leading-relaxed">
          备份走 SQLite 的 <code className="text-ink/80">VACUUM INTO</code>
          —— 一条语句拿到一份一致性的
          <strong className="text-ink/80">单文件</strong>
          快照，不停应用、不带 <code className="text-ink/80">-wal</code> /{" "}
          <code className="text-ink/80">-shm</code>。备份落在{" "}
          <code className="text-ink/80">&lt;应用根&gt;/data/backups/</code>
          ，只保留
          <strong className="text-ink/80">最近 3 份</strong>。
        </p>
        <p className="text-muted-foreground mb-3 text-xs leading-relaxed">
          自动备份只在
          <strong className="text-ink/80">会丢结构的同步之前</strong>
          发生一次（<code className="text-ink/80">pnpm db:push</code> 那条带{" "}
          <code className="text-ink/80">--force</code> 的路，会跑删列 / 重建表）。日常启动不带{" "}
          <code className="text-ink/80">--force</code>
          ，只应用建表 / 建索引 / 加列，不会丢数据，因此不备份。
        </p>
        <div className="flex items-center gap-3">
          <StatusButton
            disabled={c.backupBusy || c.restoreBusy}
            onClick={() => {
              void c.createBackupNow();
            }}
            variant="primary-solid"
          >
            {c.backupBusy ? "备份中…" : "立即备份"}
          </StatusButton>
          <span className="text-muted-foreground text-xs">
            备份失败会说明原因（磁盘满 / 库被别的进程独占），不会静默跳过。
          </span>
        </div>
      </SettingsCard>

      <SettingsCard title="恢复备份">
        <p className="text-muted-foreground mb-3 text-xs leading-relaxed">
          恢复<strong className="text-ink/80">分两步</strong>
          ：点按钮只是登记一份待恢复的备份，
          <strong className="text-ink/80">真正换文件发生在下次启动</strong>
          （那时应用没在跑）。运行期有多个进程同时持有这个库，就地覆盖{" "}
          <code className="text-ink/80">db.sqlite</code> 等于在别人握着句柄时换掉文件。
        </p>
        <p className="text-muted-foreground mb-3 text-xs leading-relaxed">
          换文件之前会
          <strong className="text-ink/80">自动给当前库再做一份备份</strong> ——
          恢复本身也是一次不可逆操作，恢复错了得有退路。
        </p>

        {c.pendingRestore && (
          <div className="border-warning/30 bg-warning/10 text-warning-strong mb-3 rounded-lg border px-3 py-2 text-sm">
            已登记从 <code>{c.pendingRestore.file}</code> 恢复 ——{" "}
            <strong>关闭并重新启动应用后生效</strong>
            。重启前不打算恢复的话，选任意一份再登记一次即可覆盖这条登记。
          </div>
        )}

        {c.backupListLoading ? (
          <p className="text-muted-foreground text-xs">正在读取备份清单…</p>
        ) : c.backups.length === 0 ? (
          <p className="text-muted-foreground text-xs">
            还没有备份。点上面的「立即备份」做第一份。
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            {c.backups.map((entry) => (
              <BackupRow
                disabled={c.restoreBusy || c.backupBusy}
                entry={entry}
                key={entry.name}
                onRestore={setConfirming}
                pending={c.pendingRestore?.file === entry.name}
              />
            ))}
          </div>
        )}

        {/* 确认弹窗态：恢复是数据级不可逆（虽然有两层备份兜底），点一下就登记
            太轻了 —— 与「立即同步」那条路同款：按钮只是发起、不是授权。 */}
        {confirming !== null && (
          <div className="border-destructive/30 bg-destructive/10 mt-3 rounded-lg border px-3 py-2 text-sm">
            <p className="text-danger-strong mb-2">
              确认登记从 <code>{confirming}</code> 恢复？下次启动时它会覆盖当前数据库。
            </p>
            <div className="flex gap-2">
              <Button
                className="h-auto rounded px-3 py-1 text-xs"
                onClick={() => {
                  const name = confirming;
                  setConfirming(null);
                  void c.restoreFrom(name);
                }}
                size="xs"
                variant="destructive"
              >
                确认登记
              </Button>
              <Button
                className="h-auto rounded px-3 py-1 text-xs"
                onClick={() => {
                  setConfirming(null);
                }}
                size="xs"
                variant="outline"
              >
                取消
              </Button>
            </div>
          </div>
        )}
      </SettingsCard>
    </>
  );
}
