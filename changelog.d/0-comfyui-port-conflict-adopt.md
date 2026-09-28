## Fixed

- **保活拉起 ComfyUI 遇端口被占：不再重复拉起，「假就绪 + 假退出」如实归因**
  （`src/lib/comfyui/lifecycle.ts`、`lifecycle-launch.ts`、`lifecycle-derive.ts`）：
  上一会话遗留的保活实例占着配置端口且正忙时，入口 HTTP 探测超时会被当成
  「未运行」再拉一个新进程——新进程绑端口失败秒退（发生在脱离的孙进程里，
  等待循环看不见），就绪判定被旧实例的应答冒领，几分钟后退出监督器又把
  「从未活过的新进程」报成「保活进程已退出：进程消失」。现在入口探测 null
  后先问进程级快照（`status.ts`），进程在跑就转 `waitForExistingInstanceReady`
  等已有实例就绪并接管（不 spawn）；保活等待循环同时逐行识别重定向 stderr
  的 `Port <n> is already in use`，命中立即中止等待并转同一条接管路径。
  排障手册 §5 已补对应条目。
