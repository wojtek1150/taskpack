// Texts of the demo build only (kept out of src/i18n so the real app does not ship them).
import type { Lang, TaskStatus } from '@taskpack/api';

const STATUS: Record<Lang, Record<TaskStatus, string>> = {
  en: {
    inbox: 'inbox',
    todo: 'to do',
    in_progress: 'in progress',
    waiting: 'waiting',
    done: 'done',
    canceled: 'canceled',
  },
  pl: {
    inbox: 'inbox',
    todo: 'do zrobienia',
    in_progress: 'w toku',
    waiting: 'czeka',
    done: 'zrobione',
    canceled: 'anulowane',
  },
};

/** Change summaries of the activity log (packages/core/src/messages.ts, `change`). */
export function changeText(lang: Lang) {
  return lang === 'pl'
    ? {
        todoAdd: (n: number) => `+${n} todo`,
        todoDone: (n: number) => `todo odhaczone: ${n}`,
        todoUndone: (n: number) => `todo odznaczone: ${n}`,
        todoEdit: 'todo zmienione',
        taskCreate: (n: number) => `+${n} task`,
        status: (title: string, s: TaskStatus) => `«${title}»: ${STATUS.pl[s]}`,
        taskEdit: (title: string) => `«${title}» zmieniony`,
        stepAdd: (n: number) => `kroki: +${n}`,
        stepCheck: (n: number) => `kroki odhaczone: ${n}`,
        stepUncheck: (n: number) => `kroki odznaczone: ${n}`,
        note: (n: number) => `notatki: +${n}`,
        decision: (n: number) => `decyzje: +${n}`,
        summary: 'podsumowanie zaktualizowane',
        question: (n: number) => `pytania: +${n}`,
        answer: (n: number) => `odpowiedzi: ${n}`,
        session: 'notatka z sesji',
      }
    : {
        todoAdd: (n: number) => `+${n} todo`,
        todoDone: (n: number) => `todos done: ${n}`,
        todoUndone: (n: number) => `todos unticked: ${n}`,
        todoEdit: 'todo edited',
        taskCreate: (n: number) => `+${n} task`,
        status: (title: string, s: TaskStatus) => `"${title}": ${STATUS.en[s]}`,
        taskEdit: (title: string) => `"${title}" edited`,
        stepAdd: (n: number) => `steps: +${n}`,
        stepCheck: (n: number) => `steps checked: ${n}`,
        stepUncheck: (n: number) => `steps unticked: ${n}`,
        note: (n: number) => `notes: +${n}`,
        decision: (n: number) => `decisions: +${n}`,
        summary: 'summary updated',
        question: (n: number) => `questions: +${n}`,
        answer: (n: number) => `answers: ${n}`,
        session: 'session note',
      };
}

/** Messages of the demo backend. */
export function demoText(lang: Lang) {
  return lang === 'pl'
    ? {
        undone: 'Ta sesja jest już cofnięta.',
        undoOnlySimulated:
          'W demo da się cofnąć tylko sesję z przycisku „Symuluj Claude”. Lokalnie Taskpack cofa każdą sesję agenta (git revert).',
        undoneLog: (file: string) => `cofnięto sesję ${file}`,
        pinLimit: 'Aktualnych obrazów może być najwyżej 5.',
        imageType: 'W demo można dodać tylko obraz (JPEG, PNG, WebP, GIF, SVG).',
        localOnly: 'To działa tylko w lokalnej instalacji Taskpack.',
      }
    : {
        undone: 'This session is undone already.',
        undoOnlySimulated:
          'In the demo only the session from "Simulate Claude" can be undone. Installed locally, Taskpack undoes any agent session (git revert).',
        undoneLog: (file: string) => `session ${file} undone`,
        pinLimit: 'At most 5 current images.',
        imageType: 'The demo takes images only (JPEG, PNG, WebP, GIF, SVG).',
        localOnly: 'This works only in a local install of Taskpack.',
      };
}

export type DemoText = ReturnType<typeof demoText>;

/** i18n keys of the demo UI (`demo.*`), added to the app's i18next resources at start. */
export const uiStrings: Record<Lang, Record<string, string>> = {
  en: {
    label: 'Demo',
    text: 'runs in your browser, nothing is saved.',
    install: 'Install locally to use it with your agents →',
    simulate: '▶ Simulate Claude',
    simulating: 'Claude is working…',
    simulateHint:
      'Plays a short Claude session on the first project: todos, a ticked step, a summary, a session note and a question. Undo it from the timeline.',
    connect:
      'This is the demo: the MCP server runs on your computer, so nothing can connect here. Install Taskpack locally, then the snippets below are what Claude, Codex and Cursor get.',
  },
  pl: {
    label: 'Demo',
    text: 'działa w Twojej przeglądarce, nic nie jest zapisywane.',
    install: 'Zainstaluj lokalnie, żeby pracować z agentami →',
    simulate: '▶ Symuluj Claude',
    simulating: 'Claude pracuje…',
    simulateHint:
      'Odtwarza krótką sesję Claude na pierwszym projekcie: todo, odhaczony krok, podsumowanie, notatka z sesji i pytanie. Cofniesz ją z osi czasu.',
    connect:
      'To jest demo: serwer MCP działa na Twoim komputerze, więc tu nic się nie połączy. Po lokalnej instalacji Taskpack poniższe fragmenty dostaną Claude, Codex i Cursor.',
  },
};

/** What the simulated Claude session writes, per workspace language. */
export const SCRIPT: Record<
  Lang,
  {
    todos: string[];
    note: string;
    summary: { body: string; now: string };
    session: string;
    question: { question: string; context: string; options: string[]; task: string };
  }
> = {
  en: {
    todos: ['Test Restore purchases on a second device', 'Add a "Restore purchases" link to Settings'],
    note: 'Restore works with a sandbox account on two devices; the second one needs a fresh install.',
    summary: {
      body: 'Timers, notifications and restore purchases work. The paywall copy remains; submission still waits for the Paid Apps agreement.',
      now: 'Paywall copy and the "Maybe later" state',
    },
    session:
      'Restore purchases works: tested with a sandbox account on two devices. Next: the paywall copy and the "Maybe later" state. Submission still waits for the Paid Apps agreement.',
    question: {
      question: 'Show the price on the last onboarding screen?',
      context:
        'Onboarding ends with the notification permission. Mentioning "€12.99, one-time" there sets expectations before the paywall appears after the third bake.',
      options: ['Yes, show it', 'No, only on the paywall'],
      task: 'onboarding',
    },
  },
  pl: {
    todos: ['Sprawdzić przywracanie zakupów na drugim telefonie', 'Dodać link „Przywróć zakupy” w Ustawieniach'],
    note: 'Przywracanie działa z kontem testowym na dwóch telefonach; drugi wymaga świeżej instalacji.',
    summary: {
      body: 'Minutniki, powiadomienia i przywracanie zakupów działają. Zostały teksty na paywallu; zgłoszenie wciąż czeka na umowę Paid Apps.',
      now: 'Teksty na paywallu i stan „Może później”',
    },
    session:
      'Przywracanie zakupów działa: sprawdzone z kontem testowym na dwóch telefonach. Dalej: teksty na paywallu i stan „Może później”. Zgłoszenie wciąż czeka na umowę Paid Apps.',
    question: {
      question: 'Pokazać cenę na ostatnim ekranie onboardingu?',
      context:
        'Onboarding kończy się pytaniem o powiadomienia. Wzmianka „12,99 €, jednorazowo” ustawi oczekiwania, zanim po trzecim wypieku pojawi się paywall.',
      options: ['Tak, pokaż', 'Nie, tylko na paywallu'],
      task: 'ekrany-powitalne',
    },
  },
};
