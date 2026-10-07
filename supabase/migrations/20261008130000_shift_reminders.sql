-- Shifts on the day (src/lib/shifts.ts): when the volunteer was told their shift is starting, so the scheduler tells
-- them once. A shift's assignments are read by start time, around now.
alter table shift_assignments add column reminded_at timestamptz;
create index on shifts (ends_at);
