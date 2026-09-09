import { createTRPCClient, httpBatchStreamLink } from "@trpc/client";
import SuperJSON from "superjson";

import type { AppRouter } from "~/server/api/root";

function getBaseUrl() {
  if (typeof window !== "undefined") return window.location.origin;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return `http://localhost:${process.env.COMFYAPP_PORT ?? process.env.PORT ?? 3100}`;
}

/**
 * Vanilla (non-React) tRPC client for plain TS modules that can't use the
 * React hooks from `~/trpc/react` (e.g. canvas-store persistence helpers).
 * Session cookies are forwarded automatically for same-origin requests, so
 * better-auth authentication works the same as the React client.
 */
export const vanillaApi = createTRPCClient<AppRouter>({
  links: [
    httpBatchStreamLink({
      transformer: SuperJSON,
      url: getBaseUrl() + "/api/trpc",
      headers: () => {
        const headers = new Headers();
        headers.set("x-trpc-source", "vanilla");
        return headers;
      },
    }),
  ],
});
