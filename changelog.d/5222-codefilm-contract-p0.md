## Added

- 代码驱动视频生成（CodeFilm）的 P0 合同层（#5222）：新增 `src/lib/codefilm` 子域，含制片合同唯一 Zod
  schema、静态 QA（时间轴连续性 / 实体引用 / 动作节拍顺序 / 成本上限）、合同→工坊 Shot 与运行入参的
  纯翻译；新增 `codeFilm` router 的 `compile` / `validate` / `toShots` 三个无副作用口与对应客户端封装。
  P0 不落库、不接 LLM / ComfyUI，故可独立验证。设计规格落
  `docs/superpowers/specs/2026-11-28-code-driven-video-generation-design.md`。
