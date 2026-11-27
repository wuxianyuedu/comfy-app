CREATE TABLE `episode_asset` (
	`id` text PRIMARY KEY NOT NULL,
	`episodeId` text NOT NULL,
	`assetId` text NOT NULL,
	`createdAt` text NOT NULL,
	FOREIGN KEY (`episodeId`) REFERENCES `episode`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`assetId`) REFERENCES `seriesAsset`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `episode_asset_episode_idx` ON `episode_asset` (`episodeId`);--> statement-breakpoint
CREATE INDEX `episode_asset_asset_idx` ON `episode_asset` (`assetId`);--> statement-breakpoint
CREATE UNIQUE INDEX `episode_asset_uniq` ON `episode_asset` (`episodeId`,`assetId`);--> statement-breakpoint
CREATE TABLE `seriesAsset` (
	`id` text PRIMARY KEY NOT NULL,
	`seriesId` text NOT NULL,
	`kind` text NOT NULL,
	`name` text NOT NULL,
	`alias` text,
	`data` text DEFAULT '{}' NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`refCount` integer DEFAULT 0 NOT NULL,
	`createdAt` text NOT NULL,
	`updatedAt` text NOT NULL,
	FOREIGN KEY (`seriesId`) REFERENCES `series`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `series_asset_series_idx` ON `seriesAsset` (`seriesId`);--> statement-breakpoint
CREATE UNIQUE INDEX `series_asset_series_kind_name_uniq` ON `seriesAsset` (`seriesId`,`kind`,`name`);