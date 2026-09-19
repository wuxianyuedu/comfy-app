"use client";

import type React from "react";

/**
 * 「把一张媒体图变成可拖拽的源」的唯一出口。
 *
 * 此前这件事在 `HistoryPanel`（网格 / 列表两个视图）与
 * `MaterialLibraryPanel`（同两个视图）里**逐字重复了四遍** —— 每遍都是
 * `draggable` + 一个 `onDragStart`（内部 `dataTransfer.setData` 本项目自定义
 * MIME、载荷是 `{ url, displayName, mediaType }` 的 JSON、再把
 * `effectAllowed` 设成 `"copy"`）+ 写死 `cursor-grab active:cursor-grabbing`
 * 的类名拼接。
 *
 * 四处都编译、都运行、类型都对，而**真正的病灶不在重复**：
 *
 *  1. **跨组件的契约靠手抄**。消费端 `use-canvas-drop` 里 `MediaDropPayload`
 *     只有 `JSON.parse(raw) as MediaDropPayload` + 一个**类型断言** ——
 *     源端少写一个字段、把 `mediaType` 写成别的名字，编译期一个字都不会说，
 *     运行时是一次**静默丢投**（拖到画布上什么都不发生，也没报错）。
 *     把两端收进一处后，「谁产生 / 谁消费」由**同一份类型**约束。
 *  2. **`displayName` 的推导各写各的**。`HistoryPanel` 用
 *     `task.cover.split("/").pop() ?? task.id`、`MaterialLibraryPanel` 直接
 *     用 `item.name` —— 都对，但「文件名从路径里怎么取」这件事又多了两份实现。
 *     现在由出口给缺省（`/` 最后一段），调用处要自己的名字就显式传。
 *  3. **可拖 / 不可拖的判据散在两处**（`isDraggableCover(task)` 与
 *     `item.kind === "image" || item.kind === "video"`）。四处都是
 *     「`draggable` 一个判据、光标类另一个判据」，改一处漏一处；出口把它们
 *     收成一个「可拖才有光标」的说法。
 *
 * 出口是**纯函数**而不是 hook：它只做「给定这张图，产出该摊在元素上的属性」，
 * 没有状态也没有订阅，而调用点都在 `Array.map` 的回调里 —— 那里不能调 hook，
 * 硬做成 hook 会逼着每个列表项先拆成一个组件（那是纯粹的噪音，
 * 与「一次渲染属性推导」这件事无关）。
 *
 * 判据（§16.2.4.22）锚在**自定义 MIME 字面量**上：它是本项目「跨组件拖拽」的
 * 签名。组件内的拖拽（React Flow 节点、表单行排序）不跨组件、也不带这个 MIME，
 * 不该走本出口。
 */

/** 本应用跨组件拖拽使用的 MIME。放在这里而不是调用处 —— 两端共用一份。 */
export const MEDIA_DRAG_MIME = "application/x-comfyapp-media";

/** 落点（`use-canvas-drop`）期望收到的载荷。 */
export interface MediaDragPayload {
  url: string;
  displayName: string;
  /** image / video 才有对应节点；audio 与 doc 目前无载体（落点会给提示）。 */
  mediaType: "image" | "video" | "audio" | "doc";
}

export interface MediaDragSourceArgs {
  /** 媒体 URL；为空时不可拖（拖了也只会丢投）。 */
  url?: string | null;
  /** 落到画布后显示的名字；缺省从 `url` 取最后一段路径。 */
  displayName?: string;
  /** 媒体类型。 */
  kind: MediaDragPayload["mediaType"];
  /** 调用处自己额外的「可拖」判据，与出口的判据**都**要过。 */
  canDrag?: boolean;
  /** 调用处原本给这个元素的类名（光标类由出口追加）。 */
  className?: string;
}

export interface MediaDragSourceProps {
  draggable: boolean;
  onDragStart: (event: React.DragEvent<HTMLElement>) => void;
  className: string;
}

/** 从 URL 取「给人看的文件名」——最后一段路径，查询串与锚点先剥掉。 */
export function displayNameFromUrl(url: string): string {
  const withoutQuery = url.split(/[?#]/)[0] ?? url;
  const last = withoutQuery.split("/").pop();
  return last && last.length > 0 ? last : url;
}

/**
 * 用法：把返回值**整份**摊到「代表这张图的那个元素」上，不要只摊一半 ——
 * `draggable` 与光标类分开写就是此前四处那副样子。出口自己判可拖；
 * 调用处额外的判据（如「必须有封面」）走 `canDrag` 合进来：
 * `<div key={item.id} {...mediaDragSourceProps({ url: item.url, kind: item.kind, className: "rounded-lg border" })} />`。
 */
export function mediaDragSourceProps({
  url,
  displayName,
  kind,
  canDrag = true,
  className = "",
}: MediaDragSourceArgs): MediaDragSourceProps {
  const draggable = canDrag && !!url;
  return {
    draggable,
    onDragStart: (event) => {
      if (!url) {
        /* 理论上到不了这里（`draggable` 已挡住），但拖拽事件也可能被程序化
         * 触发 —— 静默丢投正是这条账要消灭的东西，所以显式返回。 */
        return;
      }
      const payload: MediaDragPayload = {
        url,
        displayName: displayName ?? displayNameFromUrl(url),
        mediaType: kind,
      };
      event.dataTransfer.setData(MEDIA_DRAG_MIME, JSON.stringify(payload));
      event.dataTransfer.effectAllowed = "copy";
    },
    className:
      className + (draggable ? " cursor-grab active:cursor-grabbing" : ""),
  };
}
