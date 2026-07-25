CREATE TABLE `accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`institution` text NOT NULL,
	`country` text NOT NULL,
	`type` text NOT NULL,
	`currency` text NOT NULL,
	`note` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `alerts` (
	`id` text PRIMARY KEY NOT NULL,
	`symbol` text NOT NULL,
	`condition` text NOT NULL,
	`threshold` text NOT NULL,
	`currency` text NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`fired_at` text,
	`note` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `assets` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`name` text NOT NULL,
	`symbol` text,
	`account_id` text,
	`currency` text NOT NULL,
	`country` text,
	`status` text DEFAULT 'active' NOT NULL,
	`liquidity` text DEFAULT 'days' NOT NULL,
	`tags` text DEFAULT '[]',
	`note` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `assets_kind_idx` ON `assets` (`kind`);--> statement-breakpoint
CREATE INDEX `assets_status_idx` ON `assets` (`status`);--> statement-breakpoint
CREATE TABLE `deposits` (
	`asset_id` text PRIMARY KEY NOT NULL,
	`principal` text NOT NULL,
	`annual_rate` text NOT NULL,
	`compounding` text DEFAULT 'simple' NOT NULL,
	`day_count` text DEFAULT 'ACT/365' NOT NULL,
	`start_date` text NOT NULL,
	`maturity_date` text,
	`withholding_rate_override` text,
	`auto_renew` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`asset_id`) REFERENCES `assets`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `fx_rates` (
	`id` text PRIMARY KEY NOT NULL,
	`base` text NOT NULL,
	`quote` text NOT NULL,
	`rate` text NOT NULL,
	`date` text NOT NULL,
	`source` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `fx_unique` ON `fx_rates` (`base`,`quote`,`date`);--> statement-breakpoint
CREATE TABLE `holdings_cache` (
	`asset_id` text PRIMARY KEY NOT NULL,
	`quantity` text NOT NULL,
	`wac_cost` text NOT NULL,
	`total_cost` text NOT NULL,
	`fifo_lots` text DEFAULT '[]',
	`realized_pnl` text DEFAULT '0' NOT NULL,
	`currency` text NOT NULL,
	`last_computed_at` text NOT NULL,
	FOREIGN KEY (`asset_id`) REFERENCES `assets`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `index_series` (
	`id` text PRIMARY KEY NOT NULL,
	`index_key` text NOT NULL,
	`period` text NOT NULL,
	`value` text NOT NULL,
	`source` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `index_unique` ON `index_series` (`index_key`,`period`);--> statement-breakpoint
CREATE TABLE `price_cache` (
	`symbol` text PRIMARY KEY NOT NULL,
	`price` text NOT NULL,
	`currency` text NOT NULL,
	`change_pct_24h` text,
	`source` text NOT NULL,
	`fetched_at` text NOT NULL,
	`stale` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE `properties` (
	`asset_id` text PRIMARY KEY NOT NULL,
	`address_line` text,
	`city` text NOT NULL,
	`country` text NOT NULL,
	`lat` real,
	`lng` real,
	`purchase_price` text NOT NULL,
	`purchase_date` text NOT NULL,
	`closing_costs` text DEFAULT '0',
	`renovation_cost` text DEFAULT '0',
	`index_key` text,
	`manual_value` text,
	`manual_value_date` text,
	`monthly_rent` text DEFAULT '0',
	`occupancy_rate` text DEFAULT '1',
	`monthly_costs` text DEFAULT '{}',
	FOREIGN KEY (`asset_id`) REFERENCES `assets`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`id` text PRIMARY KEY DEFAULT 'singleton' NOT NULL,
	`base_currency` text DEFAULT 'USD' NOT NULL,
	`locale` text DEFAULT 'tr-TR' NOT NULL,
	`monthly_living_cost` text DEFAULT '0',
	`living_cost_currency` text DEFAULT 'USD',
	`risk_profile` text DEFAULT 'balanced' NOT NULL,
	`idle_cash_threshold` text DEFAULT '50000',
	`concentration_threshold` text DEFAULT '0.25',
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`date` text NOT NULL,
	`total_usd` text NOT NULL,
	`breakdown` text DEFAULT '{}',
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `snapshot_date_unique` ON `snapshots` (`date`);--> statement-breakpoint
CREATE TABLE `targets` (
	`id` text PRIMARY KEY NOT NULL,
	`dimension` text NOT NULL,
	`key` text NOT NULL,
	`target_pct` text NOT NULL,
	`tolerance_pct` text DEFAULT '0.05' NOT NULL
);
--> statement-breakpoint
CREATE TABLE `transactions` (
	`id` text PRIMARY KEY NOT NULL,
	`asset_id` text NOT NULL,
	`type` text NOT NULL,
	`date` text NOT NULL,
	`quantity` text,
	`price_per_unit` text,
	`amount` text NOT NULL,
	`currency` text NOT NULL,
	`fx_rate_to_usd` text,
	`fee` text,
	`note` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`asset_id`) REFERENCES `assets`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `tx_asset_idx` ON `transactions` (`asset_id`);--> statement-breakpoint
CREATE INDEX `tx_date_idx` ON `transactions` (`date`);--> statement-breakpoint
CREATE INDEX `tx_type_idx` ON `transactions` (`type`);--> statement-breakpoint
CREATE TABLE `vehicles` (
	`asset_id` text PRIMARY KEY NOT NULL,
	`make` text NOT NULL,
	`model` text NOT NULL,
	`year` integer NOT NULL,
	`odometer` integer DEFAULT 0,
	`country` text NOT NULL,
	`segment` text DEFAULT 'mid' NOT NULL,
	`purchase_price` text NOT NULL,
	`purchase_date` text NOT NULL,
	`manual_value` text,
	`manual_value_date` text,
	`annual_costs` text DEFAULT '{}',
	FOREIGN KEY (`asset_id`) REFERENCES `assets`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `ventures` (
	`asset_id` text PRIMARY KEY NOT NULL,
	`legal_name` text NOT NULL,
	`country` text NOT NULL,
	`sector` text,
	`ownership_pct` text NOT NULL,
	`committed_capital` text NOT NULL,
	`called_capital` text DEFAULT '0' NOT NULL,
	`valuation` text,
	`valuation_date` text,
	`monthly_revenue` text DEFAULT '0',
	`monthly_burn` text DEFAULT '0',
	`cash_on_hand` text DEFAULT '0',
	`stage` text,
	FOREIGN KEY (`asset_id`) REFERENCES `assets`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `withholding_rates` (
	`id` text PRIMARY KEY NOT NULL,
	`currency` text NOT NULL,
	`max_term_days` integer,
	`rate` text NOT NULL,
	`effective_from` text NOT NULL,
	`note` text
);
