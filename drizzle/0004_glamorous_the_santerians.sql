CREATE UNIQUE INDEX `wmtt_tag_wt_uniq` ON `workflowModelTag_workflowTemplate` (`workflowModelTag`,`workflowTemplate`);--> statement-breakpoint
CREATE UNIQUE INDEX `character_series_name_uniq` ON `character` (`seriesId`,`name`);--> statement-breakpoint
CREATE UNIQUE INDEX `episode_season_number_uniq` ON `episode` (`seasonId`,`episodeNumber`);--> statement-breakpoint
CREATE UNIQUE INDEX `season_series_number_uniq` ON `season` (`seriesId`,`seasonNumber`);