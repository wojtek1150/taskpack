---
title: Paywall — jednorazowy zakup
status: in_progress
weight: 4
due: 2026-09-28
estimate: ~4 h
order: 1
blocked_note: blokuje zgłoszenie do App Store
created: 2026-09-14
created_by: user
---

## Opis

Jeden produkt niekonsumowalny, `proof.pro`, odblokowuje dowolną liczbę zakwasów i dziennik wypieków. StoreKit 2 z weryfikacją na urządzeniu, bez serwera. Paywall pojawia się po trzecim wypieku, nigdy przy pierwszym uruchomieniu.

## Kroki

- [x] Produkt w StoreKit i zakup w sandboksie <!-- id:st_d1lw done:2026-09-21 -->
- [ ] Przywracanie zakupów <!-- id:st_d2pw -->
- [ ] Teksty na paywallu i stan „Może później” <!-- id:st_d3ls -->

## Notatki

- Zakup w sandboksie działa na telefonie z kontem testowym; symulator potrzebuje pliku konfiguracji StoreKit. Trzymać go w zgodzie z App Store Connect. <!-- by:user at:2026-09-22 -->

## Decyzje

- Jednorazowy zakup za 12,99 €, bez subskrypcji — nie ma kosztów serwera, które trzeba by pokrywać. <!-- by:claude at:2026-09-22T21:40:00+02:00 -->
