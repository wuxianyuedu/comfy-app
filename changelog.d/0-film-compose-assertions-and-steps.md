## Fixed

- **影片合成 `composeFilm` 的双重非空断言改为显式守卫（运行期崩溃风险）**：逐镜循环此前 `shot!.videoPath!.replace(...)` —— `shots[i]` 索引访问在 `noUncheckedIndexedAccess` 下逼出 `shot!`，而 `videoPath` 是可空 DB 列，脏数据（某镜未出片）时 `videoPath!` 在 `path.join` 里崩成栈噪声、被上层吞成「合成失败」却看不出原因。改为 `for (const [i, shot] of shots.entries())`（消全部 `shot!`）+ `if (!videoPath) throw`（空路径落明确文案「镜头 N 缺少视频文件」，交外层 catch 落 markFailed + 面板日志，硬规则 4）。

## Added

- **抽 `src/server/film/compose-steps.ts` 纯函数 + 单测**：把 `composeFilm` 里的 ffmpeg `vf` 滤镜串、SRT 字幕体、逐镜归一化参数、`videoPath→clip` 路径折算下沉为可测纯函数。其中**两份近孪生的 ffmpeg 参数数组**（带字幕 / 字幕烧录失败重试各一份，只差一个 `subtitles=` 滤镜，§12.12）合并为一支 `buildNormalizeArgs({ srtPath })`。`compose-steps.test.ts` 锁住「两次调用编码参数逐字一致、仅差 subtitles」这一合并契约。`orchestrator.ts` 随之从 932 行降到 894 行（回到 900 行拆分候选线内）。
