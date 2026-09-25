---
title: Paywall — one-time purchase
status: in_progress
weight: 4
due: 2026-09-28
estimate: ~4 h
order: 1
blocked_note: blocks App Store submission
created: 2026-09-14
created_by: user
---

## Description

One non-consumable product, `proof.pro`, unlocks unlimited starters and the bake log. StoreKit 2 with on-device verification, no server. The paywall appears after the third bake, never on first launch.

## Steps

- [x] StoreKit product and a sandbox purchase <!-- id:st_d1lw done:2026-09-21 -->
- [ ] Restore purchases <!-- id:st_d2pw -->
- [ ] Paywall copy and the "Maybe later" state <!-- id:st_d3ls -->

## Notes

- The sandbox purchase works on a device with a test account; the simulator needs the StoreKit configuration file. Keep it in sync with App Store Connect. <!-- by:user at:2026-09-22 -->

## Decisions

- One-time purchase at €12.99, no subscription — there are no server costs to cover. <!-- by:claude at:2026-09-22T21:40:00+02:00 -->
