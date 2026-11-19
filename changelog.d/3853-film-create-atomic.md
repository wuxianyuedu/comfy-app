## Fixed

- **成片创建原子性（#3853 / #3848）**：`persistFilmWithShots` 将 `film_project` 与 `film_shot` 的创建收敛到同一 immediate 事务内（`FilmRepository.create`/`FilmShotRepository.createMany` 支持事务执行器），镜头插入失败时整体回滚，不再残留无镜头的孤儿成片。补充仓储事务回滚回归测试。
