## Added

- **生图进行中的进度从「只有一个百分比」补成 tqdm 那一行的完整读数**（ISSUE #4908）。
  ComfyUI 控制台本就有 `7%|▋| 553/8196 [00:42<10:07, 12.58it/s]` 这样的采样进度行，
  应用侧的进度条此前只显示百分比。三处生图现场一并补齐：
  - **项目画布节点**：水波进度覆盖层在百分比下加「步数 · 速度」与
    「已用 · 剩余约」两行 —— 数据来自任务行 `progressNode` 的 value/max 与
    `claimedAt`，由 `pollTask` 每拍随进度快照透出；
  - **工坊「测试模型」进度面板**：本地工作流执行进度加已用耗时（本地时钟每秒走）、
    步数 · 速度与预估剩余（SSE progress 帧带了 value/max 才显示）；
  - **队列与运行「跑动中」卡**：在 已跑 / 预计剩余 之外补「步数」「速度」两格
    （`/api/comfy/queue` 的 running 随 `progressNode` 透出 value/max）。
  - 口径：剩余时间 = 已用 ×(100−pct)/pct 线性外推，0% / 100% 与没有开始时刻时
    不给数（写「估算中」或不显示）；速度 = 步数 ÷ 已用秒数的**全程平均**
    （tqdm 显示的是平滑瞬时值，口径不同、都对）；算不出的项不显示、不编数。
    算法收口在 `src/lib/progress.ts`（`describeSampleProgress` 等），与队列页既有
    `formatElapsed` / `estimateRemainingMs` 同一份实现，未另抄第二份。
