ALTER TABLE `settings` ADD `lot_method` text DEFAULT 'fifo' NOT NULL;--> statement-breakpoint
ALTER TABLE `settings` ADD `long_term_days` integer DEFAULT 365 NOT NULL;