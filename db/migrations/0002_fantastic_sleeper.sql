CREATE TABLE `liabilities` (
	`id` text PRIMARY KEY NOT NULL,
	`asset_id` text,
	`name` text NOT NULL,
	`lender` text,
	`currency` text NOT NULL,
	`principal` text NOT NULL,
	`annual_rate` text NOT NULL,
	`term_months` integer NOT NULL,
	`start_date` text NOT NULL,
	`payments_made` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`note` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`asset_id`) REFERENCES `assets`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `liabilities_asset_idx` ON `liabilities` (`asset_id`);--> statement-breakpoint
CREATE INDEX `liabilities_status_idx` ON `liabilities` (`status`);