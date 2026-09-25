@AGENTS.md

## Claude Code w tym workspace

- Jesteś `claude-code`: `.claude/settings.json` ustawia `TASKPACK_ACTOR=claude-code`, więc zwykłe komendy `{{TASKPACK}} …` są zapisywane na Ciebie. Przez MCP używaj serwera `taskpack` z `.mcp.json` (zatwierdź go raz).
- Komendy: `/taskpack-start <projekt>` (kontekst, streszczenie, propozycja następnego kroku), `/taskpack-add <projekt> <todo>`, `/taskpack-status`, `/taskpack-wrap` (notatka sesji + podsumowanie; uruchom przed zakończeniem).
- Skille ładują się same: `taskpack-workspace` (format, waga, statusy), `taskpack-session`, `taskpack-capture` (rozmowa → todo/taski), `taskpack-images`.
- Subagenci: `taskpack-librarian` (zwięzły brief dużego projektu), `taskpack-scribe` (zbiera zmiany z tej sesji i pisze notatkę sesji), `taskpack-planner` (rozbija task na kroki z wagami).
- Hooki: krótki dashboard na starcie sesji; `taskpack://…` w wiadomości automatycznie dołącza context pack; zapisy do `.taskpack/` i usuwanie plików w `projects/` są blokowane; każdy edytowany plik workspace'u jest walidowany (gdy edycja zostanie odrzucona, popraw wypisane błędy); przed zakończeniem, jeśli pliki projektu się zmieniły, a nie ma notatki sesji, dostaniesz raz prośbę o `/taskpack-wrap`.
- Odpowiadaj użytkownikowi i pisz do workspace'u po polsku.
