/**
 * `repository-post.ts` — Post 仓储（Drizzle 版）
 * @module core/repository-post
 */
import "server-only";

import { db } from "~/lib/db";
import { post, type Post } from "~/server/db/schema";
import { desc } from "drizzle-orm";

export class PostRepository {
  async getLatest(): Promise<Post | null> {
    const rows = await db
      .select()
      .from(post)
      .orderBy(desc(post.createdAt))
      .limit(1);
    return rows[0] ?? null;
  }

  async create(input: { name: string; createdById: string }): Promise<Post> {
    const rows = await db.insert(post).values(input).returning();
    return rows[0]!;
  }
}

export const postRepository = new PostRepository();
