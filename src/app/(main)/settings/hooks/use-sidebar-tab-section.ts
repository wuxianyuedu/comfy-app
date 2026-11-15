"use client";

// ── 「界面页签」分区的控制器（规范 17 §17.2 第②层）────────────────────────
//
// 界面页签的行为（ISSUE #3623 / #3798）：每个全局视图点开后是**独立标签页**（常驻）还是**共享
// 标签页**（切走即关），按项配置、落在 JSON 里。
//
// 这一层只管**编辑态**：草稿（改到哪了）、三个动作（本机保存 / 写项目默认 / 还原
// 默认）与状态提示。读写的出口在 `~/components/studio/hooks/use-sidebar-tab-config`
// （工作区与设置页共用同一份 React Query 缓存 —— 保存后自动回读）。

import { useCallback, useState } from "react";

import {
  useSidebarTabConfigActions,
  useSidebarTabConfigQuery,
} from "~/components/studio/hooks/use-sidebar-tab-config";
import { errorText } from "~/lib/error-message";
import {
  isSidebarTabCustomized,
  type SidebarTabConfig,
  type SidebarTabMode,
} from "~/lib/shell/sidebar-tab-behavior";

export type SidebarTabSectionController = {
  /** 本机覆盖还在吗（决定「还原默认」这个出口显不显示）。 */
  customized: boolean;
  /** 草稿：每一项当前的档位（null = 还没取回）。 */
  draft: SidebarTabConfig | null;
  /** 这份检出能不能「保存为项目默认」（正式包为 false，入口随之隐藏）。 */
  projectDefaultEditable: boolean;
  /** 「还原默认」进行中。 */
  resetBusy: boolean;
  /** 还原默认：删掉本机覆盖，生效值回落项目默认。 */
  resetToDefault: () => Promise<void>;
  /** 保存本机覆盖。 */
  save: () => Promise<void>;
  /** 「保存为项目默认（跟代码走）」：写进入库那份 JSON。 */
  saveAsProjectDefaults: () => Promise<void>;
  /** 「保存」进行中。 */
  saving: boolean;
  /** 「保存为项目默认」进行中。 */
  savingProjectDefaults: boolean;
  /** 改一项的档位（草稿态；点「保存」才落盘）。 */
  setMode: (view: string, mode: SidebarTabMode) => void;
  /** 上一次动作的结果 / 失败原因（界面念它）。 */
  status: string | null;
};

export function useSidebarTabSection(): SidebarTabSectionController {
  const query = useSidebarTabConfigQuery();
  const actions = useSidebarTabConfigActions();

  /* 草稿：编辑中的那份配置。首帧就用取回来的那份播种；之后服务端回读一次
   * （保存后 / 还原后）就重新播种 —— 判据是「引用变了」，与设置页其它草稿同一手法。 */
  const config = query.data?.config;
  const [draft, setDraft] = useState<SidebarTabConfig | null>(config ? { ...config } : null);
  const [prevConfig, setPrevConfig] = useState(config);
  const [status, setStatus] = useState<string | null>(null);
  if (config !== prevConfig) {
    setPrevConfig(config);
    setDraft(config ? { ...config } : null);
  }

  const setMode = useCallback((view: string, mode: SidebarTabMode) => {
    setDraft((prev) => ({ ...prev, [view]: mode }));
  }, []);

  const save = useCallback(async () => {
    if (!draft) {
      return;
    }
    try {
      await actions.save(draft);
      setStatus("已保存 —— 只落在这台机器上，不会跟着代码走。");
    } catch (error) {
      setStatus(errorText(error, "保存失败"));
    }
  }, [actions, draft]);

  const saveAsProjectDefaults = useCallback(async () => {
    if (!draft) {
      return;
    }
    try {
      const file = await actions.saveAsProjectDefaults(draft);
      setStatus(
        `已写入项目默认（${file ?? ""}），提交后每个检出与桌包都是这一份；` +
          "桌面包要把这份 JSON 重新构建才会带上。",
      );
    } catch (error) {
      setStatus(errorText(error, "写入失败"));
    }
  }, [actions, draft]);

  const resetToDefault = useCallback(async () => {
    try {
      await actions.resetToDefault();
      setStatus("已还原默认 —— 本机覆盖已删除，回到项目默认那份。");
    } catch (error) {
      setStatus(errorText(error, "还原失败"));
    }
  }, [actions]);

  return {
    customized: isSidebarTabCustomized(query.data?.config, query.data?.projectDefaults),
    draft,
    projectDefaultEditable: query.data?.projectDefaultEditable === true,
    resetToDefault,
    resetBusy: actions.resetBusy,
    save,
    saveAsProjectDefaults,
    saving: actions.saving,
    savingProjectDefaults: actions.savingProjectDefaults,
    setMode,
    status,
  };
}
