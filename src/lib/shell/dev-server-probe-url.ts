// 应用服务探活的请求地址（ISSUE #4195）。
//
// 探活每 2s 一拍，与页面的全部业务轮询共享浏览器对**同一个 host** 的
// HTTP/1.1 连接池（每 host 6 条）。ComfyUI 关停 / 启动的重载窗口里，自家慢
// 请求（状态查询动辄数秒、长轮询一挂 25s）会把这 6 条占满，探活便在浏览器
// 网络栈里排队超时——进程活得好好的，探活却连续失败，界面翻成「应用服务
// 已断开」（#4140 同族；本次现场 18:35:07–18:35:23 页面请求全部停摆，而
// 编排器侧另一进程打的 /api/health 每拍照常 200ms 内应答）。
//
// 浏览器的连接池按 **host 字符串**分桶：`localhost` 与 `127.0.0.1` 是两个桶。
// 应用服务恒定监听 IPv4 环回（编排器与壳的就绪判据就打 127.0.0.1），因此
// 页面挂在 `localhost` / `::1` 上时，把探活改打 `127.0.0.1` 即可让它拥有
// 独立连接池，不再被业务轮询饿死。其余形态维持同源相对地址：
//   · 页面本就挂在 127.0.0.1 上 —— 没有更优的桶可选，行为与旧版一致；
//   · 非环回来源（局域网访问）—— 那种部署里 127.0.0.1 未必是本应用，
//     不冒然换目标。
// 跨源读取需要服务端配合放行：见 `src/app/api/dev/server-id/route.ts` 的
// 环回 Origin 回显（仅回环主机 + 与服务同端口的 Origin）。

import { SERVER_ID_ENDPOINT } from "~/lib/log/panel-self-poll";

/** 页面挂在 loopback 名（localhost / ::1）上时，探活改打 127.0.0.1 这张卡。 */
export function devServerProbeUrl(originHref: string | undefined): string {
  if (originHref === undefined || originHref === "") {
    return SERVER_ID_ENDPOINT;
  }
  try {
    const origin = new URL(originHref);
    /* URL 的 IPv6 hostname 自带方括号（`[::1]`），先剥掉再比。 */
    const hostname = origin.hostname.replace(/^\[/, "").replace(/\]$/, "");
    const isLoopbackName = hostname === "localhost" || hostname === "::1";
    /* 无端口（默认 80/443）不是本应用的部署形态：维持相对地址，不猜。 */
    if (!isLoopbackName || origin.port === "") {
      return SERVER_ID_ENDPOINT;
    }
    return `http://127.0.0.1:${origin.port}${SERVER_ID_ENDPOINT}`;
  } catch {
    /* origin 形状异常（测试桩 / 非法值）：退回同源相对地址，行为与旧版一致。 */
    return SERVER_ID_ENDPOINT;
  }
}
