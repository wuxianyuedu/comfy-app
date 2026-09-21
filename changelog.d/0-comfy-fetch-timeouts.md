## Fixed

- **给多个 ComfyUI 代理调用补上超时上界，杜绝无限悬挂**：`src/lib/comfyui/client.ts`
  里 `getHistory` / `getView` / `listModels` / `uploadImage` / `interrupt` 此前都是
  裸 `fetch`，没有 `signal`——ComfyUI 接受连接却迟迟不返回时，这些 Promise 会一直挂着，
  占住连接与内存（`getView` 还会把整张图的 `ArrayBuffer` 全量驻留），表现为「点了没反应、
  一直转」。现按操作性质补 `AbortSignal.timeout`（沿用本文件既有 `getSystemStats` /
  `listModelFolders` 的同一写法）：取历史 15s、取图/视频 60s（大图/视频要留余量）、
  列目录模型 5s（异常走既有 catch 返回 `[]`）、上传图片 120s（大文件余量）、
  中断 5s。数值都取宽松档，只挡真正的病态挂死，不误伤慢但正常的本地回环请求。
