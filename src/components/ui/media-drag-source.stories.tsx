import type { Meta, StoryObj } from "@storybook/nextjs";

import {
  displayNameFromUrl,
  MEDIA_DRAG_MIME,
  mediaDragSourceProps,
  type MediaDragPayload,
} from "~/components/ui/media-drag-source";
/* 样例地址走**唯一出口** `artifactUrl()`，不手拼 `/api/generated/...` 字面量 ——
   那是产物地址的第二处来源（`tests/artifact-layout-single-source.test.ts` 判）。
   story 里的样例值同样是「会被抄走的代码」，所以它也得照出口写。 */
import { artifactUrl } from "~/lib/media/output-layout";

/**
 * `mediaDragSourceProps` 是「把一张媒体图变成可拖拽的源」的**唯一出口**。
 *
 * 它替代的是四处逐字重复的 `draggable` + `onDragStart`（`HistoryPanel` 与
 * `MaterialLibraryPanel` 各两个视图）—— 而**真正的病灶不在重复**：
 *
 * 1. **跨组件的契约靠手抄**：消费端 `use-canvas-drop` 里
 *    `JSON.parse(raw) as MediaDropPayload` —— 源端少写一个字段、把 `mediaType`
 *    写成别的名字，编译期一个字都不会说，运行时是一次**静默丢投**
 *    （拖到画布上什么都不发生、也没报错）。收进一处后，两端由**同一份类型**约束。
 * 2. **`displayName` 的推导各写各的**：出口给缺省（路径最后一段），
 *    调用处要自己的名字就显式传 —— `displayNameFromUrl()` 就是那一处。
 * 3. **「可拖 / 不可拖」的判据散在两处**（`draggable` 一个、光标类另一个）。
 *    出口把它们收成「可拖才有光标」。
 *
 * 出口是**纯函数而非 hook**：没有状态、没有订阅，而调用点都在 `Array.map`
 * 里（那里不能调 hook）。所以 story 用一节**真能拖的**卡片来展示它 ——
 * 返回值整份摊在一个元素上（`{...mediaDragSourceProps({...})}`）。
 *
 * 判据（§16.2.4.22）锚在**自定义 MIME 字面量**上：它是本项目「跨组件拖拽」
 * 的签名 —— 组件内的拖拽（React Flow 节点、表单行排序）不跨组件、不带这个
 * MIME，不该走本出口。
 *
 * ⚠️ Storybook 画布上拖拽**不会触发画布的落点逻辑**（那在应用里）。
 * 这一条 story 要验的是「可拖元素带不带正确属性」：能看到 `cursor-grab`、
 * 并且 `draggable` 属性为真。
 */
const meta = {
  title: "UI/MediaDragSource",
  component: MediaDragCard,
  args: { url: null, kind: "image" },
  render: (args) => <MediaDragCard {...args} />,
} satisfies Meta<typeof MediaDragCard>;

export default meta;

type Story = StoryObj<typeof meta>;

/** 一张真能拖的卡：`{...mediaDragSourceProps({...})}` 整份摊开。 */
function MediaDragCard({
  url,
  kind,
  canDrag = true,
}: {
  url?: string | null;
  kind: MediaDragPayload["mediaType"];
  canDrag?: boolean;
}) {
  return (
    <div
      {...mediaDragSourceProps({
        url,
        kind,
        canDrag,
        className:
          "flex h-32 w-48 flex-col items-center justify-center gap-1 rounded-lg border bg-surface-2 p-3 text-center",
      })}
    >
      <span className="text-sm font-medium">
        {url === null || url === undefined
          ? "没有图（不可拖）"
          : displayNameFromUrl(url)}
      </span>
      <span className="text-ink-muted font-mono text-[11px]">
        mediaType = {kind}
      </span>
      <span className="text-ink-muted text-[11px]">
        把鼠标放上来：可拖时是抓取光标
      </span>
    </div>
  );
}

/** 可拖（有 url）：`cursor-grab`，且 `draggable` 为真。 */
export const Draggable: Story = {
  args: {
    url: artifactUrl(["ComfyUI_00042_.png"]),
    kind: "image",
  },
};

/** 不可拖（没有 url）：出口自己判掉 `draggable`，也**不带**抓取光标
 *  —— 「可拖才有光标」这条就是收掉的第三件事。 */
export const NotDraggableWithoutUrl: Story = {
  args: { url: null, kind: "image" },
};

/** 调用处自己的判据：`canDrag` 与出口的判据是**都要过**（不覆盖）。
 *  这一档演示「有 url 但调用处说不能拖」（如没有封面、正在上传）。 */
export const NotDraggableByCanDrag: Story = {
  args: {
    url: artifactUrl(["ComfyUI_00042_.png"]),
    kind: "image",
    canDrag: false,
  },
};

/** 四种 `mediaType` 并列：`image` / `video` 有对应节点可落，
 *  `audio` / `doc` **目前无载体**（落点会给提示）—— 这是本件载荷类型里的
 *  一句真话，写在这里免得下一个人以为四种都能落。 */
export const MediaTypes: Story = {
  render: () => (
    <div className="flex flex-wrap gap-4">
      {(
        [
          ["image", artifactUrl(["cover.png"])],
          ["video", artifactUrl(["clip.mp4"])],
          ["audio", artifactUrl(["bgm.mp3"])],
          ["doc", artifactUrl(["notes.txt"])],
        ] as const
      ).map(([kind, url]) => (
        <MediaDragCard key={kind} kind={kind} url={url} />
      ))}
    </div>
  ),
};

/** 跨组件的**签名**：载荷以本项目自定义的 MIME 发送，两端共用同一份类型。
 *  这一条把名字与形状显式摆出来（它是这条账的判据锚点）；真拖到画布上的
 *  行为由应用侧的 `use-canvas-drop` 消费，不在 storybook 的职责里。 */
export const PayloadContract: Story = {
  render: () => {
    const payload: MediaDragPayload = {
      url: artifactUrl(["ComfyUI_00042_.png"]),
      displayName: "ComfyUI_00042_.png",
      mediaType: "image",
    };
    return (
      <div className="flex w-xl flex-col gap-2 rounded-lg border p-3">
        <span className="text-ink-muted font-mono text-[11px]">
          dataTransfer MIME = {MEDIA_DRAG_MIME}
        </span>
        <pre className="text-ink-muted font-mono text-xs whitespace-pre-wrap">
          {JSON.stringify(payload, null, 2)}
        </pre>
        <p className="text-ink-muted text-xs">
          {`displayNameFromUrl("${artifactUrl(["ComfyUI_00042_.png"])}") = ${displayNameFromUrl(artifactUrl(["ComfyUI_00042_.png"]))}`}
        </p>
      </div>
    );
  },
};
