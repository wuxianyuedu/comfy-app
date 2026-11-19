// ── 影片合成的纯步函数（ffmpeg 参数 / 滤镜 / 字幕构造）───────────────────
// 从 `orchestrator.ts` 的 `composeFilm` 抽出的纯函数：只吃参数、吐字符串 / 数组，不碰 IO / DB / 时钟。
// ① 逐镜归一化参数曾在合成循环写两遍（带字幕 / 烧录失败后的重试各一份，只差一个 `subtitles=` 滤镜，
//    §12.12 孪生形状：改一个忘改另一个 ⇒ 有无字幕走两条编码参数），现收成 `buildNormalizeArgs`，以
//    `srtPath` 是否为 null 决定接不接字幕滤镜；② 纯字符串算术下沉后，`composeFilm` 只留编排骨架。
import { normalizeSlashes } from "~/lib/path-display";
import { fixed } from "~/lib/number-format";
import { artifactDiskPath, generatedRoot } from "~/lib/media/output-paths";

/** ffmpeg 滤镜表达式里的字符转义（单引号与冒号）。 */
function escapeFilter(s: string): string {
  return s.replaceAll("'", String.raw`\'`).replaceAll(":", String.raw`\:`);
}

/** 单个镜头归一化到统一画幅 / 帧率并首尾淡入淡出的 `vf` 滤镜串。
 *
 *  `fadeOut` 是淡出起始时刻（调用方已算好，保证 `-t` 与 fade 时刻同一口径）。 */
export function buildSegmentVf(opts: {
  fadeOut: number;
  fps: number;
  height: number;
  width: number;
}): string {
  const { width: W, height: H, fps, fadeOut } = opts;
  return (
    `scale=${W}:${H}:force_original_aspect_ratio=decrease,` +
    `pad=${W}:${H}:(${W}-iw)/2:(${H}-ih)/2,setsar=1,` +
    `fps=${fps},` +
    `fade=t=in:st=0:d=0.3,fade=t=out:st=${fixed(fadeOut, 2) ?? "0"}:d=0.3`
  );
}

/** 一条字幕的 SRT 文件内容（单条：0 → 镜头时长）。
 *
 *  `text` 由调用方传入（镜头标题或提示词，已截断），本函数只管时间轴与格式。 */
export function buildSrtBody(opts: { dur: number; text: string }): string {
  const { text, dur } = opts;
  const endSec = String(Math.floor(dur)).padStart(2, "0");
  return `1\n00:00:00,000 --> 00:00:${endSec},000\n${text}\n`;
}

/** 逐镜归一化的 ffmpeg 参数（含 `-t` 时长）。
 *
 *  带字幕时（`srtPath` 非 null）在 `vf` 末尾接 `subtitles` 滤镜；字幕烧录失败
 *  后的重试传 `srtPath: null`，走同一份参数、只少这一个滤镜——正是把此前两份
 *  孪生参数数组合并为一的地方。 */
export function buildNormalizeArgs(opts: {
  clip: string;
  dur: number;
  out: string;
  srtPath: string | null;
  vf: string;
}): Array<string> {
  const { clip, vf, dur, out, srtPath } = opts;
  const vfWithSub =
    srtPath === null ? vf : `${vf},subtitles='${escapeFilter(normalizeSlashes(srtPath))}'`;
  return [
    "-y",
    "-i",
    clip,
    "-vf",
    vfWithSub,
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-movflags",
    "+faststart",
    "-c:a",
    "aac",
    "-b:a",
    "128k",
    // ffmpeg 的 `-t` 与 fade 时刻按两位小数写（`~/lib/number-format`）。
    "-t",
    fixed(dur, 2) ?? "0",
    out,
  ];
}

/** 把镜头的 `videoPath` 解析成产物根下的绝对文件路径（唯一解析点 `~/lib/media/output-paths`，
 *  两种历史形状都吃、越界返回 null）。原先写 `path.join(cwd, "public", 去掉前导斜杠)`，而执行器写进
 *  `TaskImage.localPath` 的是 `/api/generated/…` ⇒ 算出不存在的 `<cwd>/public/api/generated/…`，ffmpeg
 *  每个镜头都报找不到输入、「合成成片」对每条镜头必败（台账 A8 那条 ENOENT 的第二处幸存：删除侧已修此地未修）。
 *  `videoPath` 可空由调用方类型层挡（见 `compose-film` 的显式守卫）；返回 null 表示不在产物根内，处置留调用点。 */
export function clipPathOf(cwd: string, videoPath: string): string | null {
  return artifactDiskPath(videoPath, generatedRoot(cwd));
}
