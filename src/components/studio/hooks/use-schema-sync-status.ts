"use client";

// ── 后台 schema 同步的状态（底部状态栏「数据库同步中 / 已同步请刷新」的数据源）──
//
// 数据链路：启动脚本拉起 Next 的同时 spawn `scripts/db-sync.mjs` 做一次结构核对
// 与同步（不阻塞启动）→ 它把结果写进 `log/schema-sync.json` → 服务端
// `GET /api/schema` 读出来透出 → 本 hook 轮询。
//
// 为什么值得占一格状态栏：同步期间库结构可能还是旧的，业务请求会 500。页面若
// 不说「正在同步」，用户看到的就是一个报错页，无从判断该等还是该去查别的 ——
// 这正是「静默失败」最贵的形态。
//
// 轮询频率与 dev server 存活探测一致（2s，`use-interval` 同款：切后台暂停）。
// 探测失败**不动状态**（与那条探测同口径）：瞬时断网不该把「正在同步」抹掉。

import { useCallback, useEffect, useRef, useState } from "react";

import { useInterval } from "~/components/ui/use-interval";
import { isRecord } from "~/lib/is-record";

export const SCHEMA_SYNC_POLL_MS = 2000;

/** 与 `scripts/db-schema-state.mjs` 的 `ensureSchemaCurrent` 返回值一一对应。 */
export type SchemaSyncPhase =
  "syncing" | "ready" | "synced" | "missing" | "stale" | "unknown";

export interface SchemaSyncStatus {
  phase: SchemaSyncPhase;
  /** 失败原因（`stale` / `missing` 时有），给提示的 tooltip 用。 */
  detail: string | null;
  /** 执行件（`scripts/db-sync.mjs`）在不在：桌包载荷刻意不带它（那里没有
   * drizzle-kit），`false` 时 missing / stale 回落成「跑 pnpm db:push」的
   * 纯提示，不给一个点了必然失败的按钮。 */
  canPush: boolean;
}

/** 状态栏那一格该说什么（纯函数，组件只管把 tone 映射成颜色）。 */
export interface SchemaSyncNotice {
  tone: "info" | "ok" | "error";
  text: string;
  title: string;
  /** `ok` 那档是「点一下刷新」的按钮（同步完是一次性事件）。 */
  refreshable: boolean;
  /** `stale` / `missing` 且本机有执行件：渲染成「立即同步」按钮（点击后仍要
   * 过确认弹窗 —— 那批变更会丢数据，按钮只是发起、不是授权）。 */
  actionable: boolean;
}

/**
 * 相位 → 提示内容。返回 `null` = **不占位**。
 *
 * 抽成纯函数而不是写在组件里：它是判据（本仓库的 UI / 逻辑分离门禁），
 * 而要判的四种相位各有各的话要说 ——
 *   · `syncing`  让它等，别去查数据库；
 *   · `synced`   一次性事件，点一下就恢复（只在第一眼提示，见上面的 `ackAt`）；
 *   · `missing` / `stale` 需要人动手，给的是**命令**而不是安慰（规范 §9.2 第 3 条）；
 *   · `ready`（指纹一致，最常见）/ `unknown`（还没探到）不占位 —— 状态栏不该
 *     常驻一个「一切正常」的格子。
 */
export function schemaSyncNotice(
  status: SchemaSyncStatus,
): SchemaSyncNotice | null {
  switch (status.phase) {
    case "syncing":
      return {
        tone: "info",
        text: "数据库同步中…",
        title:
          "启动时发现库结构与当前 schema 不一致，正在后台同步（只自动应用建表 / 建索引 / 加列这类不丢数据的变更）",
        refreshable: false,
        actionable: false,
      };
    case "synced":
      return {
        tone: "ok",
        text: "数据库已同步 · 点此刷新",
        title: "数据库结构已同步到当前版本，点击刷新页面",
        refreshable: true,
        actionable: false,
      };
    case "missing":
    case "stale": {
      const missing = status.phase === "missing";
      const title = missing
        ? status.detail === null
          ? "数据库表还没建，需要先执行 pnpm db:push"
          : `数据库表还没建：${status.detail}`
        : status.detail === null
          ? "数据库结构与 schema 不一致，需要人工同步"
          : `数据库结构与 schema 不一致：${status.detail}`;
      /* 有执行件 → 给「立即同步」入口（文案不必再复述命令）；没有（桌包）
       * → 维持原样，只给命令让人到终端跑。 */
      return {
        tone: "error",
        text: status.canPush
          ? missing
            ? "数据库表还没建"
            : "数据库结构过期"
          : missing
            ? "数据库表还没建 · 跑 pnpm db:push"
            : "数据库结构过期 · 跑 pnpm db:push",
        title,
        refreshable: false,
        actionable: status.canPush,
      };
    }
    default:
      return null;
  }
}

const PHASES: readonly SchemaSyncPhase[] = [
  "syncing",
  "ready",
  "synced",
  "missing",
  "stale",
  "unknown",
];

function toPhase(value: unknown): SchemaSyncPhase {
  return PHASES.find((phase) => phase === value) ?? "unknown";
}

/** 「已经提示过一次『已同步，请刷新』」的标记（存状态文件的 `at`）。
 *
 * 为什么需要它：`synced` 是**一次性事件**，但状态文件会一直留着这个值
 * （直到下次启动重写）—— 不记标记的话，用户刷新完页面还会再看到一遍「请刷新」，
 * 而那时库早就同步好了。`syncing` / `missing` / `stale` 不属于此列：它们该一直
 * 显示到状态改变为止。 */
const ACK_KEY = "schemaSync.ackAt";

/** 「已同步，请刷新」的提示有效期。
 *
 * 状态文件在**下次启动**做同步时才会被覆盖，所以一个旧的 `synced` 可能躺着好几天
 * —— 那时刷新页面什么也不会变，提示就成了误导。超过这个时长就不再当回事。 */
const SYNCED_FRESH_MS = 120_000;

/** 状态文件里的 `at`（ISO）距现在是否还在有效期内；解析不了当作过期。
 *  写成类型守卫：调用处据此把 `at` 收窄成非空，下面才敢落 sessionStorage。 */
function isFresh(at: string | null): at is string {
  if (at === null) return false;
  const t = Date.parse(at);
  return Number.isFinite(t) && Date.now() - t < SYNCED_FRESH_MS;
}

function readAck(): string | null {
  try {
    return sessionStorage.getItem(ACK_KEY);
  } catch {
    return null;
  }
}

function writeAck(value: string): void {
  try {
    sessionStorage.setItem(ACK_KEY, value);
  } catch {
    /* sessionStorage 被禁用（隐私模式）时放弃记录，最坏是多提示一次 */
  }
}

export function useSchemaSyncStatus(): SchemaSyncStatus {
  /* 初值 unknown（= 不显示），SSR 与客户端首帧一致，避免 hydration 不匹配。 */
  const [status, setStatus] = useState<SchemaSyncStatus>({
    phase: "unknown",
    detail: null,
    canPush: false,
  });
  const stoppedRef = useRef(false);

  const probe = useCallback(async () => {
    try {
      const res = await fetch("/api/schema", {
        cache: "no-store",
        signal: AbortSignal.timeout(2500),
      });
      if (!res.ok) return;
      const data: unknown = await res.json();
      if (stoppedRef.current) return;
      const record = isRecord(data) ? data : {};
      const phase = toPhase(record.phase);
      const at = typeof record.at === "string" ? record.at : null;

      /* `synced`（刚同步完，建议刷新）只提示一次：刷新后状态文件里还是同一个
       * `at`，再提示一遍就成了噪音；陈旧的 `synced`（上次同步之后再没启动过）
       * 也不提示 —— 那时刷新什么也不会变。 */
      if (phase === "synced") {
        if (!isFresh(at) || readAck() === at) {
          setStatus({ phase: "unknown", detail: null, canPush: false });
          return;
        }
        writeAck(at);
      }

      setStatus({
        phase,
        detail: typeof record.detail === "string" ? record.detail : null,
        canPush: record.canPush === true,
      });
    } catch {
      /* 探测失败不动状态：瞬时断网不该把「正在同步」抹掉（与 dev server 存活
       * 探测同口径，见 use-dev-server-liveness.ts 文件头）。 */
    }
  }, []);

  /* 卸载守卫：`useInterval` 卸载即停间隔，但已发出的探测仍可能回来并
   * `setState`（规范 16 §16.2.4.15）。 */
  useEffect(() => {
    stoppedRef.current = false;
    return () => {
      stoppedRef.current = true;
    };
  }, []);

  useInterval(probe, { ms: SCHEMA_SYNC_POLL_MS });

  return status;
}
