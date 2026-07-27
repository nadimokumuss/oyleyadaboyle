CREATE TABLE `bonds` (
	`asset_id` text PRIMARY KEY NOT NULL,
	`issuer` text NOT NULL,
	`face_value` text NOT NULL,
	`coupon_rate` text DEFAULT '0' NOT NULL,
	`coupons_per_year` integer DEFAULT 2 NOT NULL,
	`purchase_price` text NOT NULL,
	`purchase_date` text NOT NULL,
	`maturity_date` text NOT NULL,
	`day_count` text DEFAULT 'ACT/365' NOT NULL,
	`market_price_pct` text,
	`market_price_date` text,
	`withholding_rate` text DEFAULT '0' NOT NULL,
	`note` text,
	FOREIGN KEY (`asset_id`) REFERENCES `assets`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `collectibles` (
	`asset_id` text PRIMARY KEY NOT NULL,
	`category` text DEFAULT 'other' NOT NULL,
	`maker` text,
	`year` integer,
	`purchase_price` text NOT NULL,
	`purchase_date` text NOT NULL,
	`appraisal_value` text,
	`appraisal_date` text,
	`annual_costs` text DEFAULT '0',
	`note` text,
	FOREIGN KEY (`asset_id`) REFERENCES `assets`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `pensions` (
	`asset_id` text PRIMARY KEY NOT NULL,
	`provider` text NOT NULL,
	`start_date` text NOT NULL,
	`participant_balance` text DEFAULT '0' NOT NULL,
	`state_contribution` text DEFAULT '0' NOT NULL,
	`monthly_contribution` text DEFAULT '0',
	`vesting_tiers` text DEFAULT '[]',
	`retirement_date` text,
	`note` text,
	FOREIGN KEY (`asset_id`) REFERENCES `assets`(`id`) ON UPDATE no action ON DELETE cascade
);
