import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { FilmStudioPreviewPanel, type FilmStudioPreviewPanelProps } from "./FilmStudioPreviewPanel";
import { FILM_SIZE, type Film, type FilmShot } from "./film-studio-config";

/** 面板 props 的控制器切片（与组件的 Pick 同源；Storybook 只需要这一小块）。 */
type PreviewController = FilmStudioPreviewPanelProps["c"];

function shot(order: number, status: FilmShot["status"], heading: string): FilmShot {
  return {
    duration: status === "SUCCEEDED" ? 3 : null,
    heading,
    id: `s${order}`,
    order,
    progress: status === "SUCCEEDED" ? 100 : 0,
    prompt: "电影感画面，柔和布光",
    status,
    videoPath: null,
  };
}

function filmWith(shots: Array<FilmShot>, status: Film["status"] = "DONE"): Film {
  return {
    bgmName: null,
    error: null,
    finalVideo: null,
    fps: 16,
    framesPerShot: 49,
    id: "f1",
    logs: [],
    progress: 100,
    script: "",
    shots,
    size: "16:9 横屏 1k",
    status,
    styleSlug: null,
    subtitleOn: false,
    title: "山间晨雾",
    type: "short_video",
  };
}

function controllerWith(film: Film | null): PreviewController {
  return { film, size: FILM_SIZE, fps: 16, running: false };
}

const meta = {
  title: "Studio/FilmStudioPreviewPanel",
  component: FilmStudioPreviewPanel,
} satisfies Meta<typeof FilmStudioPreviewPanel>;

export default meta;

type Story = StoryObj<typeof meta>;

/** 知情交付（ISSUE #4609）：部分镜头失败的成片，预览区顶部露出缺失说明。 */
export const PartialShotFailure: Story = {
  args: {
    c: controllerWith(
      filmWith([
        shot(0, "SUCCEEDED", "开场 · 云海"),
        shot(1, "FAILED", "转折 · 入林"),
        shot(2, "SUCCEEDED", "行进 · 溪谷"),
        shot(3, "FAILED", "收束 · 日出"),
      ]),
    ),
    isPlaying: false,
    onTogglePlay: () => undefined,
  },
};

/** 全部成功的成片：不出现失败提示（原形态不变）。 */
export const AllShotsSucceeded: Story = {
  args: {
    c: controllerWith(
      filmWith([shot(0, "SUCCEEDED", "开场 · 云海"), shot(1, "SUCCEEDED", "收束 · 日出")]),
    ),
    isPlaying: false,
    onTogglePlay: () => undefined,
  },
};
