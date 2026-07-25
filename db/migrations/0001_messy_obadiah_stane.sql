CREATE TABLE `watchlist` (
	`id` text PRIMARY KEY NOT NULL,
	`symbol` text NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`exchange` text,
	`currency` text,
	`note` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `watchlist_symbol_unique` ON `watchlist` (`symbol`);--> statement-breakpoint
ALTER TABLE `settings` ADD `horizon_years` integer DEFAULT 20;--> statement-breakpoint
ALTER TABLE `settings` ADD `pin_hash` text;--> statement-breakpoint
ALTER TABLE `settings` ADD `pin_salt` text;--> statement-breakpoint
ALTER TABLE `settings` ADD `session_secret` text;--> statement-breakpoint
ALTER TABLE `settings` ADD `setup_completed` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `settings` ADD `fundamentals_api_key` text;