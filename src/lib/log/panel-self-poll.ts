/**
 * 面板**自用轮询**打的端点清单 —— 这些路径的唯一定义处。
 *
 * 为什么需要一份清单而不是「谁要过滤谁写正则」：面板的自请求会被 dev server
 * 原样打进 `app` 转录，下一轮轮询又把它读回来 —— 一条自我反馈回路，滤不掉就以
 * 每轮数行的速度累积，而时间线不设上限（`log-analysis` 的 `isPanelSelfPollingLine`
 * 讲的就是这件事）。判据此前**手抄了其中两个端点名**，于是端点族长出第三个
 * （`/api/dev/build-id`，代码更新检测，每 30s 一拍且 `pauseWhenHidden: false`）
 * 时账面一条都不红（ISSUE #2417，与 #2389 同形：抄一份清单 = 给下一次新增留一份
 * 会脱钩的副本）。
 *
 * 现在**请求方与过滤判据读同一份常量**：新增一个面板自用请求，就得从这里取路径，
 * 于是它自动进过滤集合；反过来在别处再写一个字面量，评审时一眼看得见。
 *
 * 与 `~/lib/endpoints.ts` 的分工：那份管**地址与端口**（回环主机、默认端口只定义一次），
 * 这里管**本应用自己发的周期请求的路径**，两者不是同一件事。
 */

import { BUILD_ID_ENDPOINT } from "~/lib/shell/code-update-since-load";

/** 日志文件增量（六路来源共用这一条路径，靠 `?source=` 分流）。 */
export const LOG_SLICE_ENDPOINT = "/api/logs/current";

/** 应用服务进程标识探活（状态栏与面板共用，2s 一拍）。 */
export const SERVER_ID_ENDPOINT = "/api/dev/server-id";

/** 面板自用轮询打的全部端点。过滤判据按这份集合推，不另抄名字。 */
export const PANEL_SELF_POLL_ENDPOINTS = [
  LOG_SLICE_ENDPOINT,
  SERVER_ID_ENDPOINT,
  BUILD_ID_ENDPOINT,
] as const;
