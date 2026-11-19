"use client";

// ── 「界面页签」分区的控制器（规范 17 §17.2 第②层）────────────────────────
//
// 界面页签的行为（ISSUE #3623 / #3798）：每个全局视图点开后是**独立标签页**（常驻）还是**共享
// 标签页**（切走即关），按项配置、落在 JSON 里。
//
// 这一层只管**编辑态**：草稿（改到哪了）、三个动作（改一档即存本机 / 写项目默认 / 还原
// 默认）与状态提示。读写的出口在 `~/components/studio/hooks/use-sidebar-tab-config`
// （工作区与设置页共用同一份 React Query 缓存 —— 保存后自动回读）。
//
// **本机覆盖是「改一档即存」**（ISSUE #3948）：此前配好要再点一次「保存」，改完没点
// 就切走 = 白改（配置面与「尺寸配置表」那一族的口径不一致）。于是这一层不再有
// 「保存」按钮：改一档直接落本机（`data/sidebar-tab-behavior.json`），只有「写项目
// 默认（跟代码走）」才是一个显式动作 —— 那一份进代码库，不能顺手就改。
//
// **草稿不从查询回读重新播种**（只播种一次，之后只由用户的动作改）：自动保存期间
// 服务端会回读两次（前一票的响应可能落后于用户刚改的那一格），拿它播种会把用户
// 刚点的档位顶回旧值 —— 那一格明明已经存进本机了，界面却显示没改。

import { useCallback, useEffect, useRef, useState } from "react";

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
  /** 「保存为项目默认（跟代码走）」：写进入库那份 JSON。 */
  saveAsProjectDefaults: () => Promise<void>;
  /** 改一档即存本机（进行中）。 */
  saving: boolean;
  /** 「保存为项目默认」进行中。 */
  savingProjectDefaults: boolean;
  /** 改一项的档位（草稿态 + 立刻落本机）。 */
  setMode: (view: string, mode: SidebarTabMode) => void;
  /** 上一次动作的结果 / 失败原因（界面念它）。 */
  status: string | null;
};

export function useSidebarTabSection(): SidebarTabSectionController {
  const query = useSidebarTabConfigQuery();
  const actions = useSidebarTabConfigActions();

  /* 草稿：编辑中的那份配置。首帧就用取回来的那份播种；之后**不再**从查询回读
   * 重新播种（见文件头那段：自动保存的回读可能落后于用户刚改的那一格）。 */
  const config = query.data?.config;
  const [draft, setDraft] = useState<SidebarTabConfig | null>(config ? { ...config } : null);
  const [status, setStatus] = useState<string | null>(null);
  /** 草稿的同步副本：改一档要在**当前草稿**上改（不是上一帧的闭包值）。
   *  它只在事件与副作用里被读写 —— 渲染期读 ref 拿不到「这一帧的值」，还会让
   *  组件在该重渲染时不重渲染（规范 08 的渲染期纯度）。 */
  const draftRef = useRef<SidebarTabConfig | null>(draft);
  /* 首屏那一次播种：配置晚到（第一帧还没有数据）时补上。 */
  useEffect(() => {
    if (draftRef.current !== null || !config) {
      return;
    }
    const seeded = { ...config };
    draftRef.current = seeded;
    setDraft(seeded);
  }, [config]);

  /** 落本机：改一档即存（不再有「保存」按钮那一步）。 */
  const persistLocal = useCallback(
    async (next: SidebarTabConfig) => {
      try {
        await actions.save(next);
        setStatus("已保存 —— 只落在这台机器上，不会跟着代码走。");
      } catch (error) {
        setStatus(errorText(error, "保存失败"));
      }
    },
    [actions],
  );

  const setMode = useCallback(
    (view: string, mode: SidebarTabMode) => {
      const current = draftRef.current;
      if (!current) {
        return;
      }
      const next = { ...current, [view]: mode };
      draftRef.current = next;
      setDraft(next);
      void persistLocal(next);
    },
    [persistLocal],
  );

  const saveAsProjectDefaults = useCallback(async () => {
    const current = draftRef.current;
    if (!current) {
      return;
    }
    try {
      const file = await actions.saveAsProjectDefaults(current);
      setStatus(
        `已写入项目默认（${file ?? ""}），提交后每个检出与桌包都是这一份；` +
          "桌面包要把这份 JSON 重新构建才会带上。",
      );
    } catch (error) {
      setStatus(errorText(error, "写入失败"));
    }
  }, [actions]);

  const resetToDefault = useCallback(async () => {
    try {
      /* 还原后服务端回的是**生效值**（项目默认那份）—— 草稿按它重种，
         否则界面还留着用户刚改的那些档位。 */
      const effective = await actions.resetToDefault();
      if (effective) {
        const seeded = { ...effective };
        draftRef.current = seeded;
        setDraft(seeded);
      }
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
    saveAsProjectDefaults,
    saving: actions.saving,
    savingProjectDefaults: actions.savingProjectDefaults,
    setMode,
    status,
  };
}
