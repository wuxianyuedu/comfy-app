## Fixed

- **keepAlive 启动失败文案补上「该动哪个环境」**。保活模式判死文案此前固定为「保活拉起后进程未出现 / 保活进程已退出」，而真实成因——解释器既没有 pip 也没有 uv（ComfyUI-Manager 启动自检在 `main.py` 的 `prestartup()` 阶段抛异常、进程秒退）、或缺依赖（No module named 'X'）——就摆在按次命名的重定向日志里，用户却只看到一句「进程未出现」，不知道该动哪个环境。实测现场：某 ComfyUI 实例启动失败，日志为 `[ERROR] Neither python -m pip nor uv are available.` +「保活拉起后进程未出现」。
  - `lifecycle-derive.ts` 新增纯函数 `diagnoseComfyStartupFailure`：从 ComfyUI 的 stdout+stderr 识别「缺 pip/uv」与「缺依赖」两类根因，给出可行动结论（为该实例解释器补装 `ensurepip`/uv，或装依赖 / 换环境），与 bound 模式既有的 `extractMissingModule` 同族；识别不出返回 null。
  - `lifecycle-launch.ts` 的 keepAlive 判死路径读本次重定向日志（err+out）全文跑诊断，把结论拼进失败文案；识别不出则回落原固定文案。
  - 回归：`lifecycle-derive.test.ts` 新增 `diagnoseComfyStartupFailure` 用例组，含 ComfyUI-Manager pip/uv 缺失的实测原文、单独的 WARNING 回退行不误报、缺依赖、pip/uv 优先于缺依赖、普通启动输出回落 null。
