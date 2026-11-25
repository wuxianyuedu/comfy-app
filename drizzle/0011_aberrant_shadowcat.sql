CREATE TABLE `generationControl` (
	`id` text PRIMARY KEY NOT NULL,
	`paused` integer DEFAULT false NOT NULL,
	`pausedAt` text,
	`updatedAt` text
);
