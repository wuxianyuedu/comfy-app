## Fixed

- **视频/音频/图片的类型判据此前有三份互相矛盾的实现，`gif` 口径直接对立**：`lib/media.ts` 明确注释「gif 不是视频——`<video>` 解不了 GIF 会渲染成黑屏」，`lib/materials.ts` 与 `server/api/routers/task.ts` 却各带一份扩展名清单（`task.ts` 把 gif 判成视频，正是那条注释要防的事）。后果是同一个产出文件从历史面板看是图片、从素材库看是文档、从任务列表看是视频。现收敛到 `lib/media-kind.ts`（零依赖，浏览器与服务端共用），`lib/media.ts` 保留兼容 re-export。顺带去掉视图层 `ResultCard.tsx` 内联的第四份正则（规范 17：视图层不得自带判据），并把 `task.ts` 的 `VIDEO_EXT`/`AUDIO_EXT` 两份常量与 `materials.ts` 的 `inferKind` 改为引用同一判据。
