/**
 * log-export — 「把日志导出到面板之外」的两个出口。规范 07 §7.9 的复制 / 下载实现已收进 `~/lib/browser-io`（全库曾有 4 份剪贴板写入、7 份下载）；本模块只剩日志这一域的两件事：导出文件名，以及「调用方只传文本、不关心通道」的转发。
 * **导出范围由调用方决定**（store 传当前筛选下的全部条目），因此本模块不依赖 `log-store`、不引入循环引用。
 */

import { copyText, downloadText } from "~/lib/browser-io";
import { formatCompactStamp } from "~/lib/time-format";

/** 导出文件名（本地时间戳，避免同名互相覆盖）。
 *  时间戳形态走全库唯一出口 `~/lib/time-format` 的 `formatCompactStamp`
 *  （文件名那一档：本地时区、无非法字符）。此前这里是手搓的
 *  `toISOString().slice(0,19).replace(/:/g,"-")`——注释写着「本地」但实际是
 *  UTC，且与面板里显示的日志时刻差了时区。 */
export function exportFileName(): string {
  return `comfy-app-logs-${formatCompactStamp(new Date())}.txt`;
}

/**
 * 写入剪贴板，并把**成败原样返回**（规范 16 §16.2.4.43）。此前这里把结果吞掉（`await copyText(text)`
 * 后什么都不返回），理由写的是「面板按钮已有视觉反馈」——而实测那条反馈并不存在（`LogPanel` 的复制
 * 按钮自己没有任何状态），于是「复制全部失败」完全不可见。现在把判据还给调用处：谁给反馈、给什么，由面板决定。
 */
export async function copyLogText(text: string): Promise<boolean> {
  return await copyText(text);
}

/** 触发一次浏览器下载（纯文本 + 本地时间戳文件名）。 */
export function downloadLogText(text: string): void {
  downloadText(text, exportFileName(), "text/plain;charset=utf-8");
}
