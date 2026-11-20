CREATE TABLE `taskLog` (
	`taskId` text NOT NULL,
	`seq` integer NOT NULL,
	`t` integer NOT NULL,
	`level` text NOT NULL,
	`msg` text NOT NULL,
	`src` text,
	PRIMARY KEY(`taskId`, `seq`),
	FOREIGN KEY (`taskId`) REFERENCES `task`(`id`) ON UPDATE no action ON DELETE cascade
);
