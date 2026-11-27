"use client";

/**
 * 工坊 → `production` 表的写穿与挂载对账（ISSUE #5147）。
 *
 * 这一层存在的理由：工坊界面与 AI 侧（自主 run / MCP 编排 / 评审器）共读同一份
 * production 真值，而界面那份草稿是**挂载那一刻**从 localStorage 读进来的副本。
 * 整份回写会让「界面里没有角色卡」变成「把库里 AI 写的角色卡清空」—— 本单的现场。
 *
 * 三条判据（判据本体在 `~/lib/production/payload`，本文件只做接线）：
 *   ① **窄写入**：只发相对挂载基线真改过的字段，缺键的列不动；
 *   ② **版本凭据**：把基线对应的 `updatedAt` 当 `baseUpdatedAt` 带回去，服务端据此
 *      在整份快照写入时拒绝基于更旧副本的那一份；
 *   ③ **挂载采纳**：服务端严格更新（或本机为空）时采纳其内容，采纳后基线跟着换。
 *
 * 从 `use-workshop-pipeline` 拆出来是按 §12.13 的函数长度闸：主管线已经 400 行上下，
 * 再塞进这一段就会越过硬闸；而这三条判据本来就是一个可以独立讲的单元（同一个
 * 写入面的读 / 写 / 对账），拆开也不损失可读性。
 */
import React from "react";

import { beginStaleRun } from "~/lib/stale-run";
import { pushServerDraft } from "~/lib/workshop/draft-sync-client";
import { writeWorkshopDraft as writeDraft, type WorkshopDraft } from "~/lib/workshop/draft-store";
import {
  buildProductionPayload,
  isProductionWriteEmpty,
  narrowProductionWrite,
  productionContentToDraft,
  productionToContent,
  shouldAdoptProduction,
} from "~/lib/production/payload";
import {
  fetchProduction,
  pushProduction,
  type ProductionPayload,
} from "~/lib/production/production-client";
import type { ProductionStage } from "~/lib/production/progress";

export type UseWorkshopProductionSyncInput = {
  /** 所在项目（= 画布活跃 proj_*）。空串 = 没有活跃项目，全部动作早退。 */
  activeProjectId: string;
  /** 把采纳来的草稿灌进受管 state（主管线的 `applyDraft`）。 */
  applyDraft: (draft: WorkshopDraft) => void;
  /** 此刻的完整草稿（每次渲染后同步进 ref 的那一份）。 */
  currentDraft: () => WorkshopDraft;
  /** 阶段游标与 rendered（写进 production.progress）。工坊的 `Tab` 与
   *  `ProductionStage` 是同一套词表（`~/lib/production/progress` 是它的定义处），
   *  这里直接按后者收，不在调用链上反复断言。 */
  rendered: boolean;
  /** 模块级草稿缓存的失效 / 指向（采纳后要指向新内容，否则重挂载读回旧的）。 */
  setDraftCache: (draft: WorkshopDraft | null) => void;
  /** 用户可见提示（采纳服务端内容时说一句）。 */
  setNotice: (message: string) => void;
  stage: ProductionStage;
};

export type WorkshopProductionSync = {
  /** 最新草稿 ref（主管线的卸载兜底与挂载回填都要读它）。 */
  latestDraftRef: React.RefObject<WorkshopDraft>;
  /** 卸载兜底：把「此刻最新的那一份草稿」立即写穿（读的是 hook 内的 ref，
   *  调用方不必在 cleanup 里直接碰 `.current` —— 那会让判据以为要的是挂载那份）。 */
  persistLatest: () => void;
  /** 一次自动保存 / 卸载兜底：立即落 localStorage + 草稿镜像 + production 差异写。 */
  persistNow: (draft: WorkshopDraft) => void;
  /** 当前 rendered 的 ref 镜像（卸载兜底时读最新值）。 */
  renderedRef: React.RefObject<boolean>;
  /** 服务端草稿镜像对账是否已落定（#4023 的闸门，落定前不放行任何写穿）。 */
  restoreSettledRef: React.RefObject<boolean>;
  /** 草稿镜像对账落定时调（放行写穿）。 */
  settleRestore: () => void;
  /** 当前阶段的 ref 镜像（卸载兜底时读最新值）。 */
  stageRef: React.RefObject<ProductionStage>;
};

/** 把工坊草稿写穿到三处（localStorage / workshopDraft 镜像 / production 差异）。 */
export function useWorkshopProductionSync(
  input: UseWorkshopProductionSyncInput,
): WorkshopProductionSync {
  const { activeProjectId, applyDraft, currentDraft, setNotice, setDraftCache, stage, rendered } =
    input;

  /* 最新项目 id / 草稿 / 阶段 / rendered 的 ref：供卸载兜底与异步服务端回填读最新值
   * （避免闭包捕获陈旧 state）。每次渲染后同步。 */
  const activeProjectRef = React.useRef(activeProjectId);
  const latestDraftRef = React.useRef<WorkshopDraft>(currentDraft());
  const stageRef = React.useRef<ProductionStage>(stage);
  const renderedRef = React.useRef(rendered);
  /* 草稿镜像对账是否已落定（#4023）：落定前不放行写穿，否则挂载即 PUT 会把本机较旧的
   * localStorage 草稿盖到服务端较新镜像上。 */
  const restoreSettledRef = React.useRef(false);
  /* 生产数据的写入基线（#5147）：界面**挂载时**那一份内容。窄写入拿它与此刻内容比差，
   * 只有用户真改过的字段才进 PUT。
   *
   * 基线**必须在首帧就有值**：留空的话第一次差异计算会把整份内容都判成「改过」，
   * 那正是本单要消灭的整片写。所以这里在渲染期做一次性初始化（幂等、不写 state）。 */
  const productionBaseRef = React.useRef<ProductionPayload | null>(null);
  productionBaseRef.current ??= buildProductionPayload(currentDraft(), stage, rendered);
  /* 基线对应的服务端版本时刻：窄写入把它当 `baseUpdatedAt` 带回去。
   * 挂载对账读到行之后填上（缺省 = 旧行 / 没读到，不参与版本闸）。 */
  const productionBaseAtRef = React.useRef<number | undefined>(undefined);

  React.useEffect(() => {
    activeProjectRef.current = activeProjectId;
    latestDraftRef.current = currentDraft();
    stageRef.current = stage;
    renderedRef.current = rendered;
  });

  /** 只把基线之后改过的字段写出去（#5147）。没有改动 ⇒ 连请求都不发。 */
  const pushProductionDelta = React.useCallback(
    (draft: WorkshopDraft, atStage: ProductionStage, isRendered: boolean) => {
      const projectId = activeProjectRef.current;
      const base = productionBaseRef.current;
      if (!projectId || base === null) {
        return;
      }
      const next = buildProductionPayload(draft, atStage, isRendered);
      const patch = narrowProductionWrite(base, next);
      if (isProductionWriteEmpty(patch)) {
        return;
      }
      /* 写成功后基线推进到这一份：下一次只发新的差异，不会把同一批字段反复重发。
       * `failed` 不推进 —— 下一拍自动保存会带着同一批差异重试。
       * `stale` 说明有人在这份基线之后写过库；窄写入本身是安全的（只覆盖用户改过的
       * 那几个字段），所以照旧推进基线，不把用户的改动卡在重试里。 */
      void pushProduction(projectId, patch, productionBaseAtRef.current).then((result) => {
        if (result !== "failed") {
          productionBaseRef.current = next;
        }
      });
    },
    [],
  );

  /** 立即把一份草稿落到三处：localStorage（即时缓存）→ 草稿镜像 → production 差异。 */
  const persistNow = React.useCallback(
    (draft: WorkshopDraft) => {
      const projectId = activeProjectRef.current;
      const stamped: WorkshopDraft = { ...draft, updatedAt: Date.now() };
      /* localStorage 是即时缓存：无论对账落定与否都照常落盘（内容未变时与存量相同，
       * 不会丢）。服务端两处写穿在对账未落定时不发（#4023）。 */
      writeDraft(projectId, stamped);
      if (!restoreSettledRef.current) {
        return;
      }
      void pushServerDraft(projectId, stamped);
      pushProductionDelta(stamped, stageRef.current, renderedRef.current);
    },
    [pushProductionDelta],
  );

  /** 卸载兜底：落「此刻最新的那一份」（ref 在 hook 里读，读的就是当下值）。 */
  const persistLatest = React.useCallback(() => {
    persistNow(latestDraftRef.current);
  }, [persistNow]);

  /** 草稿镜像对账落定（放行写穿）。 */
  const settleRestore = React.useCallback(() => {
    restoreSettledRef.current = true;
  }, []);

  /* 挂载时的生产数据对账（#5147 ③）：AI 侧写进 production 的角色卡 / 场景 / 分镜，
   * 界面重新挂载时应当**看得见** —— 否则用户面对的还是本机那份旧草稿，而它一旦被编辑
   * 就会把那几个字段按差异写回去（窄写入保证了「没碰的不会被清」，但「看不见」仍是缺陷）。
   *
   * 判据收在 `shouldAdoptProduction`（与草稿镜像同一「同 id 取较新」口径）；这里只负责
   * 采纳与基线对齐：采纳之后基线跟着换成采纳后的那一份，否则下一次自动保存会把
   * 「刚采纳来的内容」当成用户改动整片重发。 */
  React.useEffect(() => {
    const activeId = activeProjectRef.current;
    if (!activeId) {
      return;
    }
    const guard = beginStaleRun();
    void (async () => {
      const production = await fetchProduction(activeId);
      if (!production) {
        return;
      }
      const local = latestDraftRef.current;
      const adopt = shouldAdoptProduction({
        draftUpdatedAt: local.updatedAt,
        localEmpty:
          !local.scriptMarkdown &&
          local.scenes.length === 0 &&
          local.characters.length === 0 &&
          local.shots.length === 0,
        production,
        productionUpdatedAt: production.updatedAt,
      });
      guard.commit(() => {
        if (!adopt) {
          /* 没采纳也记下版本：窄写入的 `baseUpdatedAt` 从此指向这一行，
           * 服务端据此能在整份快照写入时拒绝基于更旧副本的那一份。 */
          productionBaseAtRef.current = production.updatedAt;
          return;
        }
        const next = productionContentToDraft(productionToContent(production), local);
        writeDraft(activeId, next);
        applyDraft(next);
        latestDraftRef.current = next;
        setDraftCache(next);
        /* 基线 = 刚采纳的这一份：用户接下来动哪一项，就只发哪一项。 */
        productionBaseRef.current = buildProductionPayload(
          next,
          stageRef.current,
          renderedRef.current,
        );
        productionBaseAtRef.current = production.updatedAt;
        setNotice("已同步服务端最新的剧本 / 角色卡 / 分镜内容");
      });
    })();
    return () => {
      guard.dispose();
    };
    /* 仅首挂载执行一次（与草稿镜像同款）：本地草稿经 ref 读当次值。 */
    // oxlint-disable-next-line react/exhaustive-deps
  }, []);

  return {
    latestDraftRef,
    persistLatest,
    persistNow,
    renderedRef,
    restoreSettledRef,
    settleRestore,
    stageRef,
  };
}
