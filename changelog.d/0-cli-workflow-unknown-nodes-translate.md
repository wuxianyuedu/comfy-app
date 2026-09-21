## Fixed

comfy-cli 1.20.0（setup 脚本不锁版本）在 UI→API 转换后对照服务端 `object_info` 校验产生 `workflow_unknown_nodes` 错误时，本仓库此前只把原始英文 envelope 丢给用户（如节点 `459:452` 的 autogrow 输入 `images` 零连线 → `autogrow_no_slots`）。现特判该错误码，把 `error.details.errors` 翻成中文可操作提示（含 autogrow 需逐根连线 `images.image_1、images.image_2…` 的指引），而不是裸英文 envelope。本仓库的 `node_errors` 深搜拿不到这种形态，故在 `executor-cli-stream.ts` 的收口逻辑里补这层翻译。
