/**
 * `BackupSection` 的可见行为契约（规范 17 §17.2 第③层视图）。唯一风险是把「恢复」说成已发生：
 * 恢复是两步（写标记 → 下次启动换文件），弹「恢复成功」会让用户刷新后发现数据没变。
 * 断言指向「界面说清下一步」：无备份给引导、点恢复先出确认、已登记的说「重启应用后生效」且按钮禁点。
 */
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ReadySettingsPageController } from "../hooks/use-settings-page";

import { BackupSection } from "./BackupSection";

afterEach(cleanup);

function controller(
  overrides: Partial<ReadySettingsPageController> = {},
): ReadySettingsPageController {
  /* SAFETY: 类型断言已复核 */
  return {
    backups: [],
    pendingRestore: null,
    backupListLoading: false,
    backupBusy: false,
    restoreBusy: false,
    createBackupNow: vi.fn(async () => undefined),
    restoreFrom: vi.fn(async () => undefined),
    ...overrides,
  } as unknown as ReadySettingsPageController;
}

const oneBackup = [{ name: "db-backup-20261010-120000.sqlite", size: 8192, at: 0 }];

describe("备份清单", () => {
  it("还没有备份时给出「立即备份」这条路，而不是一片空白", () => {
    render(<BackupSection c={controller()} />);
    expect(screen.getByText(/还没有备份/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "立即备份" })).toBeTruthy();
  });

  it("读取清单期间说的是「正在读取」，不是「没有备份」", () => {
    render(<BackupSection c={controller({ backupListLoading: true })} />);
    expect(screen.getByText(/正在读取备份清单/)).toBeTruthy();
    expect(screen.queryByText(/还没有备份/)).toBeNull();
  });

  it("每份备份带名字与大小，各有一个恢复入口", () => {
    render(<BackupSection c={controller({ backups: oneBackup })} />);
    expect(screen.getByText("db-backup-20261010-120000.sqlite")).toBeTruthy();
    /* 大小走 `~/lib/format-bytes`：8192 → "8 KB"（KB 档取整）。 */
    expect(screen.getByText(/8 KB/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "用这一份恢复" })).toBeTruthy();
  });
});

describe("恢复是两步，界面必须说清", () => {
  it("点恢复先确认，不直接登记", async () => {
    const restoreFrom = vi.fn(async () => undefined);
    render(<BackupSection c={controller({ backups: oneBackup, restoreFrom })} />);

    await userEvent.click(screen.getByRole("button", { name: "用这一份恢复" }));
    // 还没登记
    expect(restoreFrom).not.toHaveBeenCalled();
    expect(screen.getByText(/确认登记从/)).toBeTruthy();

    await userEvent.click(screen.getByRole("button", { name: "确认登记" }));
    expect(restoreFrom).toHaveBeenCalledWith("db-backup-20261010-120000.sqlite");
  });

  it("取消就真的不登记", async () => {
    const restoreFrom = vi.fn(async () => undefined);
    render(<BackupSection c={controller({ backups: oneBackup, restoreFrom })} />);
    await userEvent.click(screen.getByRole("button", { name: "用这一份恢复" }));
    await userEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(restoreFrom).not.toHaveBeenCalled();
    expect(screen.queryByText(/确认登记从/)).toBeNull();
  });

  it("已登记时说的是「重启应用后生效」，按钮不再可点", () => {
    render(
      <BackupSection
        c={controller({
          backups: oneBackup,
          pendingRestore: {
            file: "db-backup-20261010-120000.sqlite",
            at: new Date().toISOString(),
          },
        })}
      />,
    );
    expect(screen.getByText(/关闭并重新启动应用后生效/)).toBeTruthy();
    const registered = screen.getByRole("button", { name: "已登记" });
    expect(registered).toHaveProperty("disabled", true);
    // 反例：界面上不该出现任何「已经恢复了」的说法
    expect(screen.queryByText(/已恢复/)).toBeNull();
  });

  it("分区文案里说明「换文件之前会再做一份退路备份」", () => {
    render(<BackupSection c={controller()} />);
    expect(screen.getAllByText(/退路/).length).toBeGreaterThan(0);
  });
});
