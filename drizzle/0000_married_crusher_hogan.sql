CREATE TABLE `account` (
	`id` text PRIMARY KEY NOT NULL,
	`accountId` text NOT NULL,
	`providerId` text NOT NULL,
	`issuer` text,
	`userId` text NOT NULL,
	`accessToken` text,
	`refreshToken` text,
	`idToken` text,
	`accessTokenExpiresAt` text,
	`refreshTokenExpiresAt` text,
	`scope` text,
	`password` text,
	`createdAt` text NOT NULL,
	`updatedAt` text NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `auditLog` (
	`id` text PRIMARY KEY NOT NULL,
	`event` text NOT NULL,
	`userId` text,
	`ip` text,
	`meta` text,
	`createdAt` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `audit_event_idx` ON `auditLog` (`event`);--> statement-breakpoint
CREATE INDEX `audit_user_idx` ON `auditLog` (`userId`);--> statement-breakpoint
CREATE INDEX `audit_created_idx` ON `auditLog` (`createdAt`);--> statement-breakpoint
CREATE TABLE `favorite` (
	`id` text PRIMARY KEY NOT NULL,
	`userId` text NOT NULL,
	`modelId` text NOT NULL,
	`createdAt` text NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`modelId`) REFERENCES `model`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `fav_user_model_uniq` ON `favorite` (`userId`,`modelId`);--> statement-breakpoint
CREATE TABLE `filmProject` (
	`id` text PRIMARY KEY NOT NULL,
	`userId` text NOT NULL,
	`projectId` text,
	`title` text NOT NULL,
	`script` text NOT NULL,
	`type` text DEFAULT 'short_video' NOT NULL,
	`styleSlug` text,
	`size` text DEFAULT '1280x720' NOT NULL,
	`fps` integer DEFAULT 16 NOT NULL,
	`framesPerShot` integer DEFAULT 49 NOT NULL,
	`subtitleOn` integer DEFAULT true NOT NULL,
	`bgmName` text,
	`status` text DEFAULT 'PARSING' NOT NULL,
	`progress` integer DEFAULT 0 NOT NULL,
	`finalVideo` text,
	`logs` text,
	`error` text,
	`createdAt` text NOT NULL,
	`updatedAt` text NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `film_user_created_idx` ON `filmProject` (`userId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `film_project_idx` ON `filmProject` (`projectId`);--> statement-breakpoint
CREATE TABLE `filmShot` (
	`id` text PRIMARY KEY NOT NULL,
	`filmId` text NOT NULL,
	`shotId` text,
	`order` integer NOT NULL,
	`heading` text,
	`prompt` text NOT NULL,
	`negative` text,
	`params` text,
	`taskId` text,
	`status` text DEFAULT 'IDLE' NOT NULL,
	`progress` integer DEFAULT 0 NOT NULL,
	`videoPath` text,
	`duration` real,
	`createdAt` text NOT NULL,
	`updatedAt` text NOT NULL,
	FOREIGN KEY (`filmId`) REFERENCES `filmProject`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `film_shot_film_order_idx` ON `filmShot` (`filmId`,`order`);--> statement-breakpoint
CREATE TABLE `llmConfig` (
	`id` text PRIMARY KEY NOT NULL,
	`provider` text DEFAULT 'local' NOT NULL,
	`baseUrl` text DEFAULT 'http://127.0.0.1:11434/v1' NOT NULL,
	`model` text DEFAULT '' NOT NULL,
	`extraModels` text,
	`apiKey` text,
	`temperature` real DEFAULT 0.7 NOT NULL,
	`temperatureByTask` text,
	`maxTokens` integer DEFAULT 2048 NOT NULL,
	`updatedAt` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `model` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`fileName` text NOT NULL,
	`folder` text,
	`subfolder` text,
	`baseModel` text,
	`coverUrl` text,
	`description` text,
	`category` text,
	`isAvailable` integer DEFAULT false NOT NULL,
	`source` text DEFAULT 'LOCAL' NOT NULL,
	`createdAt` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `model_file_folder_uniq` ON `model` (`fileName`,`folder`);--> statement-breakpoint
CREATE INDEX `model_type_idx` ON `model` (`type`);--> statement-breakpoint
CREATE INDEX `model_folder_idx` ON `model` (`folder`);--> statement-breakpoint
CREATE INDEX `model_avail_idx` ON `model` (`isAvailable`);--> statement-breakpoint
CREATE TABLE `post` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`createdAt` text NOT NULL,
	`updatedAt` text NOT NULL,
	`createdById` text NOT NULL,
	FOREIGN KEY (`createdById`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `post_name_idx` ON `post` (`name`);--> statement-breakpoint
CREATE TABLE `production` (
	`id` text PRIMARY KEY NOT NULL,
	`userId` text NOT NULL,
	`title` text DEFAULT '未命名项目' NOT NULL,
	`type` text DEFAULT 'short_video' NOT NULL,
	`tone` text DEFAULT '' NOT NULL,
	`logline` text DEFAULT '' NOT NULL,
	`scriptMarkdown` text DEFAULT '' NOT NULL,
	`scenes` text DEFAULT '[]' NOT NULL,
	`characters` text DEFAULT '[]' NOT NULL,
	`shots` text DEFAULT '[]' NOT NULL,
	`progress` text DEFAULT '{}' NOT NULL,
	`run` text DEFAULT '{}' NOT NULL,
	`createdAt` text NOT NULL,
	`updatedAt` text NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `production_user_updated_idx` ON `production` (`userId`,`updatedAt`);--> statement-breakpoint
CREATE TABLE `project` (
	`id` text PRIMARY KEY NOT NULL,
	`userId` text NOT NULL,
	`name` text NOT NULL,
	`nodes` text DEFAULT '[]' NOT NULL,
	`edges` text DEFAULT '[]' NOT NULL,
	`createdAt` text NOT NULL,
	`updatedAt` text NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `project_user_updated_idx` ON `project` (`userId`,`updatedAt`);--> statement-breakpoint
CREATE TABLE `remoteModel` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`baseUrl` text,
	`apiKey` text,
	`kind` text DEFAULT 'chat' NOT NULL,
	`workshopAdapters` text,
	`createdAt` text NOT NULL,
	`updatedAt` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `remoteModel_name_uniq` ON `remoteModel` (`name`);--> statement-breakpoint
CREATE INDEX `remoteModel_kind_idx` ON `remoteModel` (`kind`);--> statement-breakpoint
CREATE TABLE `session` (
	`id` text PRIMARY KEY NOT NULL,
	`expiresAt` text NOT NULL,
	`token` text NOT NULL,
	`createdAt` text NOT NULL,
	`updatedAt` text NOT NULL,
	`ipAddress` text,
	`userAgent` text,
	`userId` text NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `session_token_unique` ON `session` (`token`);--> statement-breakpoint
CREATE TABLE `skill` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`description` text NOT NULL,
	`icon` text DEFAULT '✨' NOT NULL,
	`category` text DEFAULT 'style' NOT NULL,
	`promptTemplate` text NOT NULL,
	`negativePrompt` text,
	`defaultParams` text,
	`recommendedModel` text,
	`tags` text DEFAULT '[]',
	`coverUrl` text,
	`isBuiltIn` integer DEFAULT false NOT NULL,
	`sortOrder` integer DEFAULT 0 NOT NULL,
	`isActive` integer DEFAULT true NOT NULL,
	`createdAt` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `skill_slug_unique` ON `skill` (`slug`);--> statement-breakpoint
CREATE INDEX `skill_cat_idx` ON `skill` (`category`);--> statement-breakpoint
CREATE INDEX `skill_active_idx` ON `skill` (`isActive`);--> statement-breakpoint
CREATE INDEX `skill_builtin_idx` ON `skill` (`isBuiltIn`);--> statement-breakpoint
CREATE TABLE `task` (
	`id` text PRIMARY KEY NOT NULL,
	`userId` text NOT NULL,
	`type` text NOT NULL,
	`prompt` text NOT NULL,
	`negativePrompt` text,
	`params` text NOT NULL,
	`workflowName` text NOT NULL,
	`workflowSnapshot` text,
	`projectId` text,
	`shotId` text,
	`referenceImages` text,
	`status` text DEFAULT 'QUEUED' NOT NULL,
	`promptId` text,
	`progress` integer DEFAULT 0 NOT NULL,
	`resultImages` text,
	`logs` text,
	`rawCli` text,
	`error` text,
	`validationErrors` text,
	`createdAt` text NOT NULL,
	`finishedAt` text,
	`claimedBy` text,
	`claimedAt` text,
	`execPayload` text,
	`progressNode` text,
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `task_user_created_idx` ON `task` (`userId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `task_project_shot_idx` ON `task` (`projectId`,`shotId`);--> statement-breakpoint
CREATE INDEX `task_status_finished_idx` ON `task` (`status`,`finishedAt`);--> statement-breakpoint
CREATE INDEX `task_prompt_id_idx` ON `task` (`promptId`);--> statement-breakpoint
CREATE INDEX `task_claimed_by_idx` ON `task` (`status`,`claimedBy`);--> statement-breakpoint
CREATE TABLE `taskImage` (
	`id` text PRIMARY KEY NOT NULL,
	`taskId` text NOT NULL,
	`localPath` text NOT NULL,
	`mediaType` text DEFAULT 'image' NOT NULL,
	`seed` text,
	`width` integer,
	`height` integer,
	`isCover` integer DEFAULT false NOT NULL,
	`sortIndex` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`taskId`) REFERENCES `task`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `taskimage_task_idx` ON `taskImage` (`taskId`);--> statement-breakpoint
CREATE TABLE `user` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text,
	`email` text NOT NULL,
	`emailVerified` integer DEFAULT false NOT NULL,
	`image` text,
	`password` text,
	`createdAt` text NOT NULL,
	`updatedAt` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_email_unique` ON `user` (`email`);--> statement-breakpoint
CREATE TABLE `userModelConfig` (
	`id` text PRIMARY KEY NOT NULL,
	`userId` text NOT NULL,
	`folder` text NOT NULL,
	`label` text,
	`type` text NOT NULL,
	`types` text DEFAULT '[]' NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`isCustom` integer DEFAULT false NOT NULL,
	`createdAt` text NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `umc_user_folder_uniq` ON `userModelConfig` (`userId`,`folder`);--> statement-breakpoint
CREATE INDEX `umc_user_idx` ON `userModelConfig` (`userId`);--> statement-breakpoint
CREATE TABLE `verification` (
	`id` text PRIMARY KEY NOT NULL,
	`identifier` text NOT NULL,
	`value` text NOT NULL,
	`expiresAt` text NOT NULL,
	`createdAt` text NOT NULL,
	`updatedAt` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `workflowModelTag` (
	`id` text PRIMARY KEY NOT NULL,
	`userId` text NOT NULL,
	`name` text NOT NULL,
	`createdAt` text NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `wmt_user_name_uniq` ON `workflowModelTag` (`userId`,`name`);--> statement-breakpoint
CREATE INDEX `wmt_user_idx` ON `workflowModelTag` (`userId`);--> statement-breakpoint
CREATE TABLE `workflowModelTag_workflowTemplate` (
	`workflowModelTag` text NOT NULL,
	`workflowTemplate` text NOT NULL,
	FOREIGN KEY (`workflowModelTag`) REFERENCES `workflowModelTag`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workflowTemplate`) REFERENCES `workflowTemplate`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `wmtt_wt_idx` ON `workflowModelTag_workflowTemplate` (`workflowTemplate`);--> statement-breakpoint
CREATE INDEX `wmtt_tag_idx` ON `workflowModelTag_workflowTemplate` (`workflowModelTag`);--> statement-breakpoint
CREATE TABLE `workflowTemplate` (
	`id` text PRIMARY KEY NOT NULL,
	`userId` text NOT NULL,
	`name` text NOT NULL,
	`taskType` text DEFAULT 'TXT2IMG' NOT NULL,
	`modes` text DEFAULT '[]' NOT NULL,
	`defaultMode` text,
	`paramMap` text,
	`workflowIO` text,
	`rawJson` text,
	`positions` text,
	`sourcePath` text,
	`sourceChecksum` text,
	`sourceMtime` integer,
	`createdAt` text NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `wt_user_idx` ON `workflowTemplate` (`userId`);--> statement-breakpoint
CREATE INDEX `wt_user_created_idx` ON `workflowTemplate` (`userId`,`createdAt`);--> statement-breakpoint
CREATE TABLE `workshopDraft` (
	`id` text PRIMARY KEY NOT NULL,
	`userId` text,
	`title` text DEFAULT '未命名工坊项目' NOT NULL,
	`type` text DEFAULT 'short_video' NOT NULL,
	`tone` text DEFAULT '' NOT NULL,
	`logline` text DEFAULT '' NOT NULL,
	`scriptMarkdown` text DEFAULT '' NOT NULL,
	`scenes` text DEFAULT '[]' NOT NULL,
	`characters` text DEFAULT '[]' NOT NULL,
	`shots` text DEFAULT '[]' NOT NULL,
	`createdAt` text NOT NULL,
	`updatedAt` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `workshop_draft_user_updated_idx` ON `workshopDraft` (`userId`,`updatedAt`);--> statement-breakpoint
CREATE TABLE `workshopSession` (
	`id` text PRIMARY KEY NOT NULL,
	`userId` text,
	`title` text DEFAULT '未命名工坊项目' NOT NULL,
	`type` text DEFAULT 'short_video' NOT NULL,
	`tone` text DEFAULT '' NOT NULL,
	`logline` text DEFAULT '' NOT NULL,
	`idea` text DEFAULT '' NOT NULL,
	`scriptMarkdown` text DEFAULT '' NOT NULL,
	`scenes` text DEFAULT '[]' NOT NULL,
	`characters` text DEFAULT '[]' NOT NULL,
	`shots` text DEFAULT '[]' NOT NULL,
	`stage` text DEFAULT 'script' NOT NULL,
	`createdAt` text NOT NULL,
	`updatedAt` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `workshop_session_user_idx` ON `workshopSession` (`userId`);--> statement-breakpoint
CREATE INDEX `workshop_session_updated_idx` ON `workshopSession` (`updatedAt`);