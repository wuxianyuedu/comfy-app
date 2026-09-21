import {
  defaultShouldDehydrateQuery,
  QueryClient,
} from "@tanstack/react-query";
import SuperJSON from "superjson";

export const createQueryClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: {
        // SSR 场景下我们通常把默认 staleTime 设成
        // 大于 0，避免客户端立刻重新拉取
        staleTime: 30 * 1000,
        // 桌面壳（WebView2）里每次 alt-tab / 重新获得焦点都会触发 RQ 默认的
        // 「聚焦即重取」，把全部 stale 查询（含 task.list 带图、project.outputs
        // 等重接口）一次性打回网络，表现为「切回来就卡一下」。关掉全局默认，
        // 新鲜度交给 30s staleTime 与页面/前台时的显式刷新动作。
        refetchOnWindowFocus: false,
      },
      dehydrate: {
        serializeData: SuperJSON.serialize,
        shouldDehydrateQuery: (query) =>
          defaultShouldDehydrateQuery(query) ||
          query.state.status === "pending",
      },
      hydrate: {
        deserializeData: SuperJSON.deserialize,
      },
    },
  });
