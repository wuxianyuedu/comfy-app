## Fixed

- **BGM 文件名做路径收口，不再可读 films/bgm 之外的任意本机文件**（ISSUE #4738）：
  `film.compose` 的 `bgmName` 此前是裸 `z.string()`，composeFilm 直接
  `path.join(filmBgmRoot(), bgmName)` 进 ffmpeg 输入——tRPC 直调传 `../../x.mp3`
  可把 films/bgm 根外的任意本机文件混进成片音轨。
  - 路由入参改为 `bgmNameSchema`（`isSafeBgmName`：单段文件名、拒分隔符与
    `.` / `..`、限长 255），create / createFromProject 两个入口同一份判据。
  - composeFilm 侧补根内包含校验（`isWithinGeneratedRoot(bgm, filmBgmRoot())`）：
    历史行或绕过路由的调用方给来越界名时记 warn 并跳过配乐（无配乐版本照常出片），
    不做任何根外读取。判据唯一出处 `~/lib/film/bgm-name.ts`，两处共用。
