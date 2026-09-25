// Demo build entry (`pnpm build:demo`, main.tsx imports it only when __TASKPACK_DEMO__): serves
// `/api/*` and `/api/events` from the in-browser backend instead of apps/server.
import type { ChangeEvent, DemoSeed, Lang } from '@taskpack/api';
import type { i18n as I18n } from 'i18next';
import { demoSlot } from '../lib/demo';
import { DemoBackend, freshSeed, stateFromSeed } from './backend';
import { DemoBanner } from './DemoBanner';
import { localDate } from './dates';
import { runtime } from './runtime';
import { uiStrings } from './strings';

const BASE = import.meta.env.BASE_URL;
const LANG_KEY = 'taskpack-demo-lang';

/** The language picked in Settings survives a reload (English otherwise). */
function savedLang(): Lang {
  try {
    return localStorage.getItem(LANG_KEY) === 'pl' ? 'pl' : 'en';
  } catch {
    return 'en';
  }
}

/** Fake `EventSource` for `/api/events`: the backend's `changed` events as SSE messages. */
function eventSourceFor(backend: DemoBackend, Real: typeof EventSource): typeof EventSource {
  // A plain function constructor: `new` returns the object it builds (a real EventSource for other URLs).
  function DemoEventSource(url: string | URL, init?: EventSourceInit): EventSource {
    if (!new URL(String(url), location.href).pathname.endsWith('/api/events')) return new Real(url, init);
    const source = new EventTarget() as EventTarget & { url: string; readyState: number; close: () => void };
    const stop = backend.subscribe((event: ChangeEvent) => {
      source.dispatchEvent(new MessageEvent('changed', { data: JSON.stringify(event) }));
    });
    source.url = String(url);
    source.readyState = 1;
    source.close = () => {
      source.readyState = 2;
      stop();
    };
    return source as unknown as EventSource;
  }
  return DemoEventSource as unknown as typeof EventSource;
}

/**
 * Start the demo: load the English seed (dates moved to today), answer the app's API calls
 * from memory and show the demo banner. Call before the app's first request.
 */
export async function installDemo(): Promise<{ ready: (i18n: I18n) => void }> {
  const realFetch = window.fetch.bind(window);
  const load = async (lang: Lang) => {
    const res = await realFetch(`${BASE}demo/seed-${lang}.json`);
    if (!res.ok) throw new Error(`demo seed ${lang}: HTTP ${res.status}`);
    const seed = freshSeed((await res.json()) as DemoSeed, localDate(new Date()));
    return stateFromSeed(seed, BASE);
  };
  const backend = new DemoBackend(await load(savedLang()), load);
  backend.subscribe(() => {
    try {
      localStorage.setItem(LANG_KEY, backend.state.lang);
    } catch {
      // private mode: English after a reload
    }
  });
  runtime.backend = backend;

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const path = new URL(url, location.href).pathname;
    if (!path.startsWith('/api/')) return realFetch(input, init);
    const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
    const raw = init?.body;
    const body = raw instanceof FormData ? raw : typeof raw === 'string' && raw ? JSON.parse(raw) : undefined;
    const res = await backend.request(method, `${path}${new URL(url, location.href).search}`, body);
    if (res.status === 204) return new Response(null, { status: 204 });
    return new Response(JSON.stringify(res.body), {
      status: res.status,
      headers: { 'Content-Type': 'application/json' },
    });
  };
  window.EventSource = eventSourceFor(backend, window.EventSource);
  demoSlot.Banner = DemoBanner;

  return {
    ready: (i18n) => {
      for (const lang of ['en', 'pl'] as const)
        i18n.addResourceBundle(lang, 'translation', { demo: uiStrings[lang] }, true);
    },
  };
}
