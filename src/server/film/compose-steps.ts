// ── 影片合成的纯步函数（ffmpeg 参数 / 滤镜 / 字幕构造）───────────────────
// 从 `orchestrator.ts` 的 `composeFilm` 里抽出的**纯函数**：只吃参数、吐字符串 /
// 数组，不碰 IO / DB / 时钟。抽出来的理由有两条，都是「收口不收全」的反面教材：
//
//   ① 逐镜归一化的 ffmpeg 参数在合成循环里写了**两遍**（带字幕 / 字幕烧录失败后
//      的重试各一份），两者只差一个 `subtitles=` 滤镜，是 §12.12 的孪生形状——
//      改一个忘改另一个就会让「有无字幕」走出两条不同的编码参数。这里收成一份
//      `buildNormalizeArgs`，用 `srtPath` 是否为 null 决定接不接字幕滤镜。
//   ② `composeFilm` 连同这些长参数数组逼近文件行数上限，把纯字符串算术
//      下沉到本模块后，编排文件只留「取事实 → 调 ffmpeg → 落库」的骨架。
import { normalizeSlashes } from "~/lib/path-display";
import { fixed } from "~/lib/number-format";
import { artifactDiskPath, generatedRoot } from "~/lib/media/output-paths";

/** ffmpeg 滤镜表达式里的字符转义（单引号与冒号）。 */
function escapeFilter(s: string): string {
  return s.replace(/'/g, "\\'").replace(/:/g, "\\:");
}

/** 单个镜头归一化到统一画幅 / 帧率并首尾淡入淡出的 `vf` 滤镜串。
 *
 *  `fadeOut` 是淡出起始时刻（调用方已算好，保证 `-t` 与 fade 时刻同一口径）。 */
export function buildSegmentVf(opts: {
  width: number;
  height: number;
  fps: number;
  fadeOut: number;
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
export function buildSrtBody(opts: { text: string; dur: number }): string {
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
  vf: string;
  dur: number;
  out: string;
  srtPath: string | null;
}): string[] {
  const { clip, vf, dur, out, srtPath } = opts;
  const vfWithSub =
    srtPath !== null
      ? `${vf},subtitles='${escapeFilter(normalizeSlashes(srtPath))}'`
      : vf;
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

/** 把镜头的 `videoPath` 解析成产物根下的绝对文件路径。
 *
 *  解析本身只有 `~/lib/media/output-paths` 那一处（两种历史形状都吃、越界返回 null）。
 *  这一句原先写的是 `path.join(cwd, "public", 去掉前导斜杠)`，而执行器写进
 *  `TaskImage.localPath` 的是 `/api/generated/…`，于是算出 `<cwd>/public/api/generated/…`：
 *  那个目录不存在，ffmpeg 每个镜头都报找不到输入，「合成成片」对每一条镜头必败
 *  （台账 A8 那条 ENOENT 的第二处幸存 —— 删除侧当年修了，这一侧没修）。
 *
 *  `videoPath` 可空由类型层挡在调用方（见 `compose-film` 的显式守卫）；
 *  返回 `null` 表示「这不是一个落在产物根内的地址」，处置同样留在调用点。 */
export function clipPathOf(cwd: string, videoPath: string): string | null {
  return artifactDiskPath(videoPath, generatedRoot(cwd));
}
