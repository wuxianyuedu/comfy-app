## Added
- 词级字幕时间轴（ISSUE #5277，借鉴 OpenMontage word-level captions）：`film.wordSubtitleOn` 显式开关（默认整句口径，老数据不破），打开后 SRT 每条压到一个词、带毫秒时间戳；有 TTS 回写的 `audioWords` 优先用，否则按标点断句 + 字数权重均匀切分的可解释降级，导出与烧录仍同源。补 5 条纯函数用例，产品 FR-QA-06 与阶段⑥同步更新。
