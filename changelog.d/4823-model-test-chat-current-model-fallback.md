## Fixed

- **测试模型页「对话」候选补「当前生效主模型」兜底**（#4823）：设置页刻意把主模型
  排除在候选清单外（播种过滤 + 保存不并回），而测试页此前只读 `extraModels` ——
  只设了「当前模型」、没勾候选的单模型 Ollama 配置在对话页签永远空态，工坊文本
  下拉却能看到它。兜底判据抽成共享纯函数 `chatFallbackGroupForCurrentModel`
  （`src/lib/llm/types.ts`），工坊下拉（`use-llm-config`）与测试页（`use-model-test`）
  两处同口径：生效提供方 local 归本地组、remote 归远端组（明确 image / video
  用途的主模型不归入对话）；测试页候选的 extraModels 拆分同步改走
  `splitExtraModels`，读边界口径与库里唯一实现对齐。同批把对话空态文案里的
  「用途为 对话」对齐设置弹窗的现行词表「文本」（#3577 改了设置侧、漏了这处指引）。
