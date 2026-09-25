import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { QuestionView } from '@taskpack/api';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fold } from '../src/features/palette/Palette';
import { QuestionAnswer } from '../src/features/questions/QuestionAnswer';
import en from '../src/i18n/en.json';
import pl from '../src/i18n/pl.json';
import { showWhole } from '../src/ui/ImageArt';

vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }) }));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

/** Translation keys without plural suffixes (`_one`, `_few`…), which differ between languages. */
function keys(obj: object, prefix = ''): Set<string> {
  const out = new Set<string>();
  for (const [k, v] of Object.entries(obj)) {
    const key = `${prefix}${k.replace(/_(zero|one|two|few|many|other)$/, '')}`;
    if (v && typeof v === 'object') for (const nested of keys(v, `${key}.`)) out.add(nested);
    else out.add(key);
  }
  return out;
}

describe('i18n', () => {
  it('Polish and English have the same keys', () => {
    const a = keys(pl);
    const b = keys(en);
    expect([...a].filter((k) => !b.has(k))).toEqual([]);
    expect([...b].filter((k) => !a.has(k))).toEqual([]);
  });

  it('Polish plurals have one/few/many/other, English one/other', () => {
    const plurals = (obj: object, lang: 'pl' | 'en', prefix = ''): string[] =>
      Object.entries(obj).flatMap(([k, v]) => {
        if (v && typeof v === 'object') return plurals(v, lang, `${prefix}${k}.`);
        if (!k.endsWith('_other')) return [];
        const base = k.slice(0, -'_other'.length);
        const need = lang === 'pl' ? ['one', 'few', 'many'] : ['one'];
        return need.filter((f) => !(`${base}_${f}` in obj)).map((f) => `${prefix}${base}_${f}`);
      });
    expect(plurals(pl, 'pl')).toEqual([]);
    expect(plurals(en, 'en')).toEqual([]);
  });
});

describe('palette search folding', () => {
  it('folds Polish letters so "szklo" matches "szkło"', () => {
    expect(fold('Zamówić SZKŁO hartowane')).toBe('zamowic szklo hartowane');
    expect(fold('Łódka źdźbło')).toBe('lodka zdzblo');
  });
});

describe('gallery tiles', () => {
  it('shows drawings, SVGs and PDFs whole; photos fill the tile', () => {
    expect(showWhole({ file: 'wymiary.svg', category: 'visualization' })).toBe(true);
    expect(showWhole({ file: 'plan.png', category: 'drawing' })).toBe(true);
    expect(showWhole({ file: 'oferta.pdf', category: 'other' })).toBe(true);
    expect(showWhole({ file: 'postep.jpg', category: 'progress' })).toBe(false);
  });
});

describe('QuestionAnswer', () => {
  const q: QuestionView = {
    id: 'q_abc1',
    question: 'Olej czy wosk?',
    context: '',
    options: ['Olej', 'Wosk'],
    answer: '',
    status: 'open',
  };
  const withQuery = (ui: ReactNode) =>
    render(<QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>);

  it('answers with an option or free text through the API', async () => {
    const user = userEvent.setup();
    const fetch = vi.fn(async () => new Response(JSON.stringify({ status: 'answered' }), { status: 200 }));
    vi.stubGlobal('fetch', fetch);
    withQuery(<QuestionAnswer q={q} expanded />);
    await user.click(screen.getByRole('button', { name: 'Wosk' }));
    expect(fetch).toHaveBeenCalledWith(
      '/api/questions/q_abc1/answer',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ answer: 'Wosk' }) }),
    );
    await user.type(screen.getByRole('textbox', { name: 'Odpowiedź: Olej czy wosk?' }), 'Olej twardy{Enter}');
    expect(fetch).toHaveBeenLastCalledWith(
      '/api/questions/q_abc1/answer',
      expect.objectContaining({ body: JSON.stringify({ answer: 'Olej twardy' }) }),
    );
  });
});
