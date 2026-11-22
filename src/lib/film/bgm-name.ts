/** BGM 文件名的安全判据（唯一出处）。
 *
 *  合法名是 `/api/film/bgm` 上传口生成的**单段文件名**：
 *  `bgm-<时间戳>_<消毒后展示名>.<ext>`（展示名经 `safeDisplayName`，保留 CJK）。
 *
 *  #4738：bgmName 会被 composeFilm 拿去 `path.join(filmBgmRoot(), …)` 进 ffmpeg
 *  输入——带路径分隔符的值能把读取位置挪到 films/bgm 之外（tRPC 直调 / MCP 可达）；
 *  无分隔符的 `.` / `..` 也会被 `path.join` 解析到根自身或父目录，一并拒绝。
 *  路由侧用它做**输入边界**校验；composeFilm 侧另有根内包含校验兜底
 *  （防历史行与未来绕过路由的调用方）。两处判据都引到这里，不各写一份。 */
export function isSafeBgmName(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= 255 &&
    !/[/\\]/.test(value) &&
    value !== "." &&
    value !== ".."
  );
}
