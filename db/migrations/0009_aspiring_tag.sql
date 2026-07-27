CREATE TABLE `goals` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`target_amount` text NOT NULL,
	`currency` text NOT NULL,
	`target_date` text NOT NULL,
	`kind` text DEFAULT 'other' NOT NULL,
	`priority` integer DEFAULT 1 NOT NULL,
	`count_kinds` text DEFAULT '[]',
	`achieved_at` text,
	`note` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `goals_target_date_idx` ON `goals` (`target_date`);