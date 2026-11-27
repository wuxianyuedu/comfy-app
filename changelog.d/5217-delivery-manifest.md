## Added
- 集级交付清单（ISSUE #5217，借鉴同类工作台的作品库/成片归档）：`episode.delivery` JSON 列 + 迁移，`series.updateEpisode` 可写封面/成片路径/字幕 stem/镜头版本；新增 `GET /api/episodes/[id]/delivery` 只读导出 JSON 清单与同源 SRT，越权按 404 同形，字幕 stem 只认单段安全名。补纯函数与 router 写入用例；产品 FR-SR-05 同步更新，界面导出按钮待接。
