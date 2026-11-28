## Added
- 一集多语字幕与配音地基（ISSUE #5280，借鉴 OpenMontage Localization & Dub）：以同源 SRT 为唯一文本源，用人工校对的译文表逐条替换时间轴文本，缺译文保留原文并标 `[未翻译:<语言>]`；角色声音绑定新增可选 `language` 并下发给 TTS 参数；`episode.delivery.localizations` 记录各语版字幕/音轨路径并在交付清单里回读。不调用外部翻译 API、不猜译文。补 6 条纯函数用例，产品 FR-SR-05 同步更新。
