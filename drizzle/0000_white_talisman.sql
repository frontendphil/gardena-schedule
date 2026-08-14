CREATE TABLE `run_steps` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`run_id` integer NOT NULL,
	`valve_id` text NOT NULL,
	`valve_name` text NOT NULL,
	`position` integer NOT NULL,
	`duration_minutes` integer NOT NULL,
	`started_at` integer,
	`finished_at` integer,
	`status` text NOT NULL,
	`detail` text,
	`moisture_reading` integer,
	`moisture_target` integer,
	FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `runs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`schedule_id` integer NOT NULL,
	`scheduled_date` text NOT NULL,
	`started_at` integer NOT NULL,
	`finished_at` integer,
	`status` text NOT NULL,
	FOREIGN KEY (`schedule_id`) REFERENCES `schedules`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `schedule_steps` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`schedule_id` integer NOT NULL,
	`valve_id` text NOT NULL,
	`duration_minutes` integer NOT NULL,
	`position` integer NOT NULL,
	FOREIGN KEY (`schedule_id`) REFERENCES `schedules`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`valve_id`) REFERENCES `valves`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `schedules` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`start_time` text NOT NULL,
	`recurrence` text DEFAULT 'weekly' NOT NULL,
	`days_of_week` integer DEFAULT 127 NOT NULL,
	`interval_days` integer DEFAULT 2 NOT NULL,
	`anchor_date` text,
	`enabled` integer DEFAULT true NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`id` integer PRIMARY KEY DEFAULT 1 NOT NULL,
	`master_enabled` integer DEFAULT true NOT NULL,
	`sensor_gate_enabled` integer DEFAULT false NOT NULL,
	`global_moisture_target` integer DEFAULT 30 NOT NULL,
	`sensor_id` text,
	`timezone` text DEFAULT 'Europe/Berlin' NOT NULL
);
--> statement-breakpoint
CREATE TABLE `valves` (
	`id` text PRIMARY KEY NOT NULL,
	`api_name` text NOT NULL,
	`display_name` text,
	`hidden` integer DEFAULT false NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`moisture_target` integer,
	`last_seen_at` integer
);
