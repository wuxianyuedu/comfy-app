## Fixed
- 成片字幕源改用镜头台词（`Shot.dialogue`），不再拿标题/提示词冒充对白（借鉴 LocalMiniDrama / NovelVids 的台词-字幕同源做法）。台词随镜头落 params，烧录用逐镜 SRT、导出用同一份口径生成的整片 SRT（`film.subtitleSrt` 读 `generated/films/<id>.srt`）；台词缺失仍回落标题、再回落提示词。补纯函数用例覆盖三种来源与整片 SRT 时间轴累加，产品 FR-OP-04 与阶段⑥缺口同步更新。
