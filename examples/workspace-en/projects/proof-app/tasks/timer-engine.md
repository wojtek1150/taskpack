---
title: Timer engine and notifications
status: done
weight: 5
order: 4
created: 2026-09-05
created_by: user
done_at: 2026-09-19
---

## Description

Feeding, bulk and proof timers survive restarts; local notifications fire even when the app is closed. The kitchen temperature adjusts the bulk time.

## Steps

- [x] Timer model with persisted start times <!-- id:st_k1pr done:2026-09-14 -->
- [x] Local notifications with "Fed" and "Snooze" actions <!-- id:st_k2wr done:2026-09-15 -->
- [x] Temperature-adjusted bulk time <!-- id:st_k3kl done:2026-09-17 -->
- [x] Tests for time zone and daylight saving changes <!-- id:st_k4sz done:2026-09-19 -->
