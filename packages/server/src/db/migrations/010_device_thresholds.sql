-- Per-device on/off detection tuning, matching Sense's own "Standby to On
-- threshold" and "Minimum On/Off duration" device settings. NULL means "use
-- the global default" so existing devices don't need a backfill.
ALTER TABLE devices ADD COLUMN on_threshold_w REAL;
ALTER TABLE devices ADD COLUMN min_duration_s INTEGER;
