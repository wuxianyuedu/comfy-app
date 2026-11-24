CREATE TABLE `characterProfile` (
	`id` text PRIMARY KEY NOT NULL,
	`userId` text NOT NULL,
	`name` text NOT NULL,
	`archetype` text DEFAULT '' NOT NULL,
	`gender` text DEFAULT '' NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`tags` text DEFAULT '[]' NOT NULL,
	`portraitUrl` text,
	`portraits` text DEFAULT '[]' NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`source` text DEFAULT 'manual' NOT NULL,
	`taskId` text,
	`params` text,
	`width` integer,
	`height` integer,
	`createdAt` text NOT NULL,
	`updatedAt` text NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `characterProfile_user_created_idx` ON `characterProfile` (`userId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `characterProfile_user_status_idx` ON `characterProfile` (`userId`,`status`);--> statement-breakpoint
CREATE UNIQUE INDEX `characterProfile_user_name_uniq` ON `characterProfile` (`userId`,`name`);