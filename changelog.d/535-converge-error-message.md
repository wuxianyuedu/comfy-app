## Fixed

- **生图 / 生视频等失败路径的报错可能渲染成一片空白，网络类故障也只显示原始报文**：项目早已把「unknown 抛值 → 可读兜底文案」收敛到 `src/lib/error-message.ts`（含空串回落与网络层报错翻译），但同一份实现又在 19 个文件里被各自复刻了一遍，其中 18 份**丢掉了空串回落**——`new Error("")` 会被当成有效文案，提示条渲染出来没有任何文字；`Unexpected token '<' ... is not valid JSON`、`Failed to fetch` 这类原文也照原样抛给用户（没有翻译成人话，看不出「应用服务正在重启或未就绪」）。19 份副本全部改为引用中央实现（11 个 Route Handler + 7 个工坊视图/管线 + `lib/film/orchestrator.ts`），失败提示统一拿到已有的空串修复与网络错误翻译。

## Changed

- **`lib/film/orchestrator.ts` 的三处日志文案改成显式兜底**：该文件原先用 `String(e)` 强转取 `message`，能容忍非 Error 抛值，与其余各处静默不一致。改为中央实现后显式传入 `"提交失败"` / `"合成失败"` 文案，日志不会出现空白行。
