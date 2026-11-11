CREATE TABLE `llmProvider` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`baseUrl` text DEFAULT '' NOT NULL,
	`apiFormat` text DEFAULT 'chat-completions' NOT NULL,
	`apiKey` text,
	`createdAt` text NOT NULL,
	`updatedAt` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `llmProvider_name_uniq` ON `llmProvider` (`name`);--> statement-breakpoint
ALTER TABLE `remoteModel` ADD `providerId` text;--> statement-breakpoint
ALTER TABLE `remoteModel` ADD `apiFormat` text;--> statement-breakpoint
ALTER TABLE `remoteModel` ADD `enabled` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `remoteModel` ADD `contextWindow` integer;--> statement-breakpoint
ALTER TABLE `remoteModel` ADD `maxOutputTokens` integer;--> statement-breakpoint
ALTER TABLE `remoteModel` ADD `inputTypes` text;--> statement-breakpoint
ALTER TABLE `remoteModel` ADD `outputTypes` text;--> statement-breakpoint
ALTER TABLE `remoteModel` ADD `capabilities` text;--> statement-breakpoint
ALTER TABLE `remoteModel` ADD `reasoningLevels` text;--> statement-breakpoint
ALTER TABLE `remoteModel` ADD `reasoningParamMapping` text;--> statement-breakpoint
ALTER TABLE `remoteModel` ADD `smartConfig` integer DEFAULT true NOT NULL;--> statement-breakpoint
CREATE INDEX `remoteModel_provider_idx` ON `remoteModel` (`providerId`);