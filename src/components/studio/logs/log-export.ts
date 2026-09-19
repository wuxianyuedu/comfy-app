/**
 * log-export — 「把日志导出到面板之外」的两个出口。
 *
 * 规范 07 §7.9 定的是「复制走 Clipboard API、下载走 Blob + 临时 `<a download>`」。
 * 那两段实现本身已收进 `~/lib/browser-io`（按形态扫描时发现全库有 4 份剪贴板
 * 写入、7 份下载，各自写法还不同）；本模块只剩**日志这一域自己**的两件事：
 * 导出文件名，以及「调用方只传文本、不关心通道」的转发。
 *
 * **导出范围由调用方决定**（store 传当前筛选下的全部条目拼出的文本）：本模块
 * 只管「怎么把一段文本送出去」，不管「送哪些行」——后者是 `filteredLogs` 的
 * 口径，属于 store。为此本模块**不依赖 `log-store`**（不引入循环引用）。
 *
 * @module logs/log-export — 「把日志导出到面板之外」的两个出口
 */

import { copyText, downloadText } from "~/lib/browser-io";

/** 导出文件名（本地时间戳，避免同名互相覆盖）。 */
export function exportFileName(): string {
  return `comfy-app-logs-${new Date().toISOString().slice(0, 19).replace(/:/g, "-")}.txt`;
}

/**
 * 写入剪贴板。失败静默 —— 日志面板的「复制全部」已经在按钮上给了
 * 视觉反馈（`LogPanel` 的 flash 态），再弹一次错误提示反而吵。
 */
export async function copyLogText(text: string): Promise<void> {
  await copyText(text);
}

/** 触发一次浏览器下载（纯文本 + 本地时间戳文件名）。 */
export function downloadLogText(text: string): void {
  downloadText(text, exportFileName(), "text/plain;charset=utf-8");
}
