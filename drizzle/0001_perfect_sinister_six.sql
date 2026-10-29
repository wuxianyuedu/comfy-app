CREATE TABLE `character` (
	`id` text PRIMARY KEY NOT NULL,
	`seriesId` text NOT NULL,
	`name` text NOT NULL,
	`ageGender` text DEFAULT '' NOT NULL,
	`appearance` text DEFAULT '' NOT NULL,
	`costume` text DEFAULT '' NOT NULL,
	`personality` text DEFAULT '' NOT NULL,
	`temperament` text DEFAULT '' NOT NULL,
	`styleTags` text DEFAULT '[]' NOT NULL,
	`skillSlug` text,
	`positivePrompt` text DEFAULT '' NOT NULL,
	`negativePrompt` text DEFAULT '' NOT NULL,
	`params` text DEFAULT '{}' NOT NULL,
	`portraitUrl` text,
	`portraits` text DEFAULT '[]' NOT NULL,
	`createdAt` text NOT NULL,
	`updatedAt` text NOT NULL,
	FOREIGN KEY (`seriesId`) REFERENCES `series`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `character_series_idx` ON `character` (`seriesId`);--> statement-breakpoint
CREATE TABLE `episode` (
	`id` text PRIMARY KEY NOT NULL,
	`seasonId` text NOT NULL,
	`projectId` text,
	`episodeNumber` integer DEFAULT 1 NOT NULL,
	`title` text DEFAULT '' NOT NULL,
	`synopsis` text DEFAULT '' NOT NULL,
	`coverUrl` text,
	`targetDurationSec` integer,
	`status` text DEFAULT 'draft' NOT NULL,
	`createdAt` text NOT NULL,
	`updatedAt` text NOT NULL,
	FOREIGN KEY (`seasonId`) REFERENCES `season`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `episode_season_idx` ON `episode` (`seasonId`);--> statement-breakpoint
CREATE UNIQUE INDEX `episode_project_uniq` ON `episode` (`projectId`);--> statement-breakpoint
CREATE TABLE `episode_character` (
	`id` text PRIMARY KEY NOT NULL,
	`episodeId` text NOT NULL,
	`characterId` text NOT NULL,
	`role` text DEFAULT '' NOT NULL,
	`createdAt` text NOT NULL,
	FOREIGN KEY (`episodeId`) REFERENCES `episode`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`characterId`) REFERENCES `character`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `episode_character_episode_idx` ON `episode_character` (`episodeId`);--> statement-breakpoint
CREATE UNIQUE INDEX `episode_character_uniq` ON `episode_character` (`episodeId`,`characterId`);--> statement-breakpoint
CREATE TABLE `season` (
	`id` text PRIMARY KEY NOT NULL,
	`seriesId` text NOT NULL,
	`seasonNumber` integer DEFAULT 1 NOT NULL,
	`title` text DEFAULT '' NOT NULL,
	`createdAt` text NOT NULL,
	`updatedAt` text NOT NULL,
	FOREIGN KEY (`seriesId`) REFERENCES `series`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `season_series_idx` ON `season` (`seriesId`);--> statement-breakpoint
CREATE TABLE `series` (
	`id` text PRIMARY KEY NOT NULL,
	`userId` text NOT NULL,
	`title` text DEFAULT '未命名系列' NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`coverUrl` text,
	`styleSlug` text,
	`createdAt` text NOT NULL,
	`updatedAt` text NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `series_user_idx` ON `series` (`userId`);--> statement-breakpoint
ALTER TABLE `production` ADD `scriptReview` text DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE `task` ADD `parentId` text;--> statement-breakpoint
ALTER TABLE `taskImage` ADD `humanRating` integer;--> statement-breakpoint
ALTER TABLE `taskImage` ADD `isFavorite` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `workshopSession` ADD `projectId` text;