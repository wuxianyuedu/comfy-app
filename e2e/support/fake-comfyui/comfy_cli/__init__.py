"""假 comfy-cli —— E2E 的「执行器下游」替身（ISSUE #1621）。

真 comfy-cli 干的事：把工作流文件提交给 ComfyUI（`POST /prompt`）、轮询执行、
最后把结果打成**逐行 JSON 事件**写到 stdout。本应用**只**经它执行任务
（`src/lib/comfyui/executor-cli.ts` 的 `python -m comfy_cli run --workflow …`），
所以「出图」这条链路要真跑通，下游必须有一个东西应答。

替身 vs 真件：本模块只复刻 **comfy-cli 的对外契约**（命令行参数 + stdout 事件
序列），一行都不复刻本仓库的执行器逻辑 —— 那不是「第二份实现」，是**被 mock
掉的外部依赖**（§12.12 的孪生判据判的是仓库内两份同样实现，不是外部程序）。

事件序列照 `executor-cli-stream.ts` 的 `dispatchEvent` 逐条对齐：
    converted → queued → executing×N → progress×N → execution_success
    → executed → envelope{ok:true}
漏掉任一条的表现都不明显（面板少一行），但 `envelope` 是**唯一**的收口信号：
没有它，`executor-cli.ts` 的 `close` 分支会把任务判成「异常退出」。

`--fail` 开关回放失败序列（envelope{ok:false, error}）供失败路径用。
"""
