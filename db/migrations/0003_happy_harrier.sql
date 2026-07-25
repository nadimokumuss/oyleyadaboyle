CREATE TABLE `login_attempts` (
	`id` text PRIMARY KEY NOT NULL,
	`ip` text,
	`user_agent` text,
	`success` integer NOT NULL,
	`reason` text,
	`at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `login_attempts_at_idx` ON `login_attempts` (`at`);--> statement-breakpoint
ALTER TABLE `settings` ADD `totp_secret` text;--> statement-breakpoint
ALTER TABLE `settings` ADD `totp_enabled` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `settings` ADD `recovery_codes` text DEFAULT '[]';--> statement-breakpoint
ALTER TABLE `settings` ADD `allowed_ips` text;