CREATE TABLE `asset` (
	`id` text PRIMARY KEY NOT NULL,
	`userId` text NOT NULL,
	`name` text NOT NULL,
	`mediaType` text DEFAULT 'image' NOT NULL,
	`category` text DEFAULT 'reference' NOT NULL,
	`scope` text DEFAULT 'public' NOT NULL,
	`projectId` text,
	`subdir` text,
	`localPath` text NOT NULL,
	`width` integer,
	`height` integer,
	`sourceTaskId` text,
	`prompt` text,
	`negativePrompt` text,
	`params` text,
	`workflowName` text,
	`createdAt` text NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `asset_user_created_idx` ON `asset` (`userId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `asset_scope_category_idx` ON `asset` (`scope`,`category`);