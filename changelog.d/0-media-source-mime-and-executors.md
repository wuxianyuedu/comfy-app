## Fixed

- **工坊参考图的类型此前恒被判成 PNG**：`media-source.server.ts` 把整条路径喂给了只认扩展名的 `mimeForExt()`（本地分支传 `abs`、远端分支传 `new URL(src).pathname`），查表必然落空 → 两支都落到默认值 `image/png`。于是一张 webp / jpeg 的参考图会被标成 png 拼进 data URL 发给远程通道、或写进 ComfyUI 的 input 目录。现在两支都先取扩展名再查表（与 `contentTypeForPath` 同一把尺）。这条藏了很久的原因值得记：唯一那一条本地用例的文件恰好叫 `img_0.png` —— 错误的值与正确的值撞在一起，看着像测过了。
- **补上这个模块其余四族的执行者**（27 条用例，覆盖率门槛 35/30/35/30 → 95/92/100/100）：`http(s)` 拉取带 30s 超时信号（沉默的上游不许挂住流水线）、HTTP 不成功时文案里带状态码、网络层异常翻成人话、上游 `reject` 一个裸字符串时回落「未知错误」而不是 `undefined`、24MB 上限、`file:` 之类 scheme 一律拒（只认 data URL / 产物根内 / http(s) 三扇门）、`readUpstreamJson` 的片段有界（长响应不许整包进错误消息），以及 `strField` / `intField` 两个字段守卫的收与拒。
