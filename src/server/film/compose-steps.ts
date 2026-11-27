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

/** 秒数 → SRT 时间戳 `hh:mm:ss,mmm`（按时 / 分 / 秒进位；毫秒沿用既有整秒口径，恒 000）。
 *
 *  #4739：此前按「秒永远两位数」拼（`padStart(2, "0")`），镜头时长 ≥60s 时
 *  产出 `00:00:75,000` 这类**非法 SRT**（秒位必须 00-59），字幕烧录失败、
 *  长镜头字幕被静默丢弃（只留一条 warn）。这里按全量进位格式化，时长多大都合法。 */
export function formatSrtTimestamp(seconds: number): string {
  const totalSec = Math.max(0, Math.floor(seconds));
  const s = totalSec % 60;
  const m = Math.floor(totalSec / 60) % 60;
  const h = Math.floor(totalSec / 3600);
  const p2 = (n: number): string => String(n).padStart(2, "0");
  return `${p2(h)}:${p2(m)}:${p2(s)},000`;
}

/** 一条字幕的 SRT 文件内容（单条：0 → 镜头时长）。
 *
 *  `text` 由调用方传入（镜头标题或提示词，已截断），本函数只管时间轴与格式。 */
export function buildSrtBody(opts: { dur: number; text: string }): string {
  const { text, dur } = opts;
  return `1\n00:00:00,000 --> ${formatSrtTimestamp(dur)}\n${text}\n`;
}

/** 字幕文本的唯一取法（ISSUE #5210）：角色台词优先，标题次之，提示词兜底。
 *  此前成片只读 `heading`/`prompt`，`dialogue` 在工坊模型里有却进不了 MP4。 */
export function subtitleTextOf(shot: {
  dialogue?: string | null;
  heading?: string | null;
  prompt: string;
}): string {
  const pick = (v: string | null | undefined): string =>
    typeof v === "string" && v.trim() !== "" ? v.trim() : "";
  return (pick(shot.dialogue) || pick(shot.heading) || pick(shot.prompt)).slice(0, 80);
}

/** 多镜合并 SRT：逐镜时长累加成时间轴，与单镜烧录用同一份文本口径。
 *  空文本的镜头跳过（不产出空字幕条目），全空时返回空串。 */
export function buildFilmSrt(items: Array<{ dur: number; text: string }>): string {
  let cursor = 0;
  const blocks: string[] = [];
  let index = 1;
  for (const item of items) {
    const dur = Math.max(0, item.dur);
    const text = item.text.trim();
    if (text !== "") {
      blocks.push(
        `${index}\n${formatSrtTimestamp(cursor)} --> ${formatSrtTimestamp(cursor + dur)}\n${text}\n`,
      );
      index += 1;
    }
    cursor += dur;
  }
  return blocks.join("\n");
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
