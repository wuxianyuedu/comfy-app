ALTER TABLE `task` ADD `sortOrder` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX `task_claim_order_idx` ON `task` (`status`,`claimedBy`,`sortOrder`,`createdAt`);