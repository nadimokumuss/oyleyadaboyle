CREATE TABLE `job_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`job_key` text NOT NULL,
	`run_key` text NOT NULL,
	`started_at` text DEFAULT (datetime('now')) NOT NULL,
	`finished_at` text,
	`ok` integer,
	`message` text
);
--> statement-breakpoint
CREATE INDEX `job_runs_started_idx` ON `job_runs` (`started_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `job_run_unique` ON `job_runs` (`job_key`,`run_key`);--> statement-breakpoint
CREATE TABLE `notifications` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`severity` text DEFAULT 'info' NOT NULL,
	`title` text NOT NULL,
	`body` text,
	`dedupe_key` text,
	`read_at` text,
	`delivered_at` text,
	`delivery_error` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `notifications_created_idx` ON `notifications` (`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `notification_dedupe_unique` ON `notifications` (`dedupe_key`);--> statement-breakpoint
CREATE TABLE `recurring_transactions` (
	`id` text PRIMARY KEY NOT NULL,
	`asset_id` text NOT NULL,
	`label` text NOT NULL,
	`type` text NOT NULL,
	`amount` text NOT NULL,
	`currency` text NOT NULL,
	`frequency` text NOT NULL,
	`start_date` text NOT NULL,
	`end_date` text,
	`next_run_date` text NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`last_run_at` text,
	`note` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`asset_id`) REFERENCES `assets`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `recurring_next_run_idx` ON `recurring_transactions` (`next_run_date`);--> statement-breakpoint
ALTER TABLE `liabilities` ADD `auto_pay` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `liabilities` ADD `payment_asset_id` text REFERENCES assets(id);--> statement-breakpoint
ALTER TABLE `settings` ADD `webhook_url` text;--> statement-breakpoint
ALTER TABLE `settings` ADD `scheduler_enabled` integer DEFAULT true NOT NULL;