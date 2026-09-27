## Fixed

- **日志导出文件名的时间戳收口到 `time-format` 的 `formatCompactStamp`，修 UTC/本地分叉**：`logs/log-export.ts` 的 `exportFileName()` 此前手搓 `new Date().toISOString().slice(0,19).replace(/:/g,"-")`——函数注释写着「本地时间戳」但 `toISOString()` 实际是 **UTC**，导出文件名与面板里显示的日志时刻差一个时区。改用全库文件名时戳的唯一出口 `formatCompactStamp`（本地、无 Windows 非法字符），既修时区口径又统一「导出文件名长什么样」的单一来源。
