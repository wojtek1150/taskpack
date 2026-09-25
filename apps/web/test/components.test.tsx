import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { BoardCard, BoardView, ImageView, StepView } from '@taskpack/api';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { toast } from 'sonner';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TaskCardBody } from '../src/features/board/TaskCard';
import { canPin, Gallery } from '../src/features/project/Gallery';
import { StepsChecklist } from '../src/features/task/StepsChecklist';
import { moveCard } from '../src/lib/queries';
import { WeightBars } from '../src/ui/WeightBars';

vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }) }));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

function withQuery(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

describe('WeightBars', () => {
  it('lights as many of the five rising bars as the weight, with an accessible label', () => {
    render(<WeightBars weight={3} label="Waga 3/5" />);
    const bars = screen.getByRole('img', { name: 'Waga 3/5' });
    const spans = [...bars.children] as HTMLElement[];
    expect(spans).toHaveLength(5);
    expect(spans.map((s) => s.dataset.on)).toEqual(['true', 'true', 'true', 'false', 'false']);
    expect(spans.map((s) => s.style.height)).toEqual(['6px', '8px', '10px', '12px', '14px']);
  });
});

describe('StepsChecklist', () => {
  const steps: StepView[] = [
    { id: 'st_a', text: 'Produkt w StoreKit', done: true, next: false },
    { id: 'st_b', text: 'Przywracanie zakupów', done: false, next: true },
    { id: 'st_c', text: 'Listwy', done: false, next: false },
  ];

  it('marks the first open step as next and shows progress', () => {
    render(<StepsChecklist steps={steps} onToggle={vi.fn()} onMove={vi.fn()} onAdd={vi.fn()} />);
    const items = screen.getAllByRole('listitem');
    expect(within(items[1] as HTMLElement).getByText('następny')).toBeInTheDocument();
    expect(within(items[0] as HTMLElement).queryByText('następny')).toBeNull();
    expect(screen.getByText('1/3 · 33%')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Produkt w StoreKit' })).toBeChecked();
  });

  it('ticks, reorders (1-based target) and adds steps', async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    const onMove = vi.fn();
    const onAdd = vi.fn();
    render(<StepsChecklist steps={steps} onToggle={onToggle} onMove={onMove} onAdd={onAdd} />);

    await user.click(screen.getByRole('checkbox', { name: 'Przywracanie zakupów' }));
    expect(onToggle).toHaveBeenCalledWith('st_b', true);

    expect(screen.getByRole('button', { name: 'Przesuń wyżej: Produkt w StoreKit' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Przesuń niżej: Listwy' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Przesuń wyżej: Listwy' }));
    expect(onMove).toHaveBeenCalledWith('st_c', 2);
    await user.click(screen.getByRole('button', { name: 'Przesuń niżej: Produkt w StoreKit' }));
    expect(onMove).toHaveBeenCalledWith('st_a', 2);

    await user.type(screen.getByRole('textbox', { name: 'Nowy krok' }), 'Olejowanie{Enter}');
    expect(onAdd).toHaveBeenCalledWith('Olejowanie');
    expect(screen.getByRole('textbox', { name: 'Nowy krok' })).toHaveValue('');
  });
});

describe('Gallery pin limit', () => {
  const image = (file: string, pinned: boolean): ImageView => ({
    file,
    title: file,
    category: 'visualization',
    caption: '',
    pinned,
    ...(pinned ? { pinnedRank: 'abcde'.indexOf(file[0] ?? '') + 1 } : {}),
    tasks: [],
    ref: `taskpack://premiera-proof/images/${file}`,
    url: `/api/files/premiera-proof/images/${file}`,
    thumbUrl: `/api/img/thumb/premiera-proof/${file}`,
    agentUrl: `/api/img/agent/premiera-proof/${file}`,
    placeholder: false,
    exists: true,
  });
  const five = ['a', 'b', 'c', 'd', 'e'].map((f) => image(`${f}.svg`, true));

  it('allows at most five pinned images', () => {
    expect(canPin(five.slice(0, 4))).toBe(true);
    expect(canPin(five)).toBe(false);
  });

  it('refuses a sixth pin with a friendly message and no request', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const user = userEvent.setup();
    withQuery(
      <Gallery
        project="premiera-proof"
        images={[...five, image('f.svg', false)]}
        tasks={[]}
        view="all"
        onView={vi.fn()}
        onCat={vi.fn()}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Przypnij f.svg jako aktualny' }));
    expect(toast.error).toHaveBeenCalledWith('Aktualnych obrazów może być najwyżej 5. Najpierw odepnij jeden.');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('unpins through the API', async () => {
    const fetch = vi.fn(
      async () => new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } }),
    );
    vi.stubGlobal('fetch', fetch);
    const user = userEvent.setup();
    withQuery(
      <Gallery project="premiera-proof" images={five} tasks={[]} view="current" onView={vi.fn()} onCat={vi.fn()} />,
    );
    const pin = screen.getByRole('button', { name: 'Odepnij a.svg' });
    expect(pin).toHaveAttribute('aria-pressed', 'true');
    await user.click(pin);
    await vi.waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(fetch).toHaveBeenCalledWith('/api/projects/premiera-proof/images/a.svg', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pinned: false }),
    });
  });
});

describe('Gallery tiles and lightbox', () => {
  const image = (file: string, extra: Partial<ImageView> = {}): ImageView => ({
    file,
    title: `Title ${file}`,
    category: 'drawing',
    caption: `Caption ${file}`,
    pinned: false,
    tasks: [],
    ref: `taskpack://premiera-proof/images/${file}`,
    url: `/api/files/premiera-proof/images/${file}`,
    thumbUrl: `/api/img/thumb/premiera-proof/${file}`,
    agentUrl: `/api/img/agent/premiera-proof/${file}`,
    placeholder: false,
    exists: true,
    ...extra,
  });
  const tasks = [
    {
      slug: 'zakup-w-aplikacji',
      ref: 'taskpack://premiera-proof/zakup-w-aplikacji',
      title: 'Drzwiczki',
      status: 'todo',
      weight: 3,
      stepsDone: 0,
      stepsTotal: 0,
      description: '',
    },
  ] as const;

  it('shows thumbnails, the current images in pinned order and the agent badge', () => {
    withQuery(
      <Gallery
        project="premiera-proof"
        images={[
          image('a.png', { pinned: true, pinnedRank: 2 }),
          image('b.png', { pinned: true, pinnedRank: 1, createdBy: 'claude' }),
          image('c.png'),
        ]}
        tasks={[...tasks]}
        view="current"
        onView={vi.fn()}
        onCat={vi.fn()}
      />,
    );
    const imgs = screen.getAllByRole('img');
    expect(imgs.map((i) => i.getAttribute('src'))).toEqual([
      '/api/img/thumb/premiera-proof/b.png',
      '/api/img/thumb/premiera-proof/a.png',
    ]);
    expect(screen.getByText('od Claude')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /Przeciągnij, żeby zmienić kolejność/ })).toHaveLength(2);
  });

  it('edits a caption in the lightbox (only that field) and navigates with the keyboard', async () => {
    const fetch = vi.fn(
      async () => new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } }),
    );
    vi.stubGlobal('fetch', fetch);
    HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
      this.setAttribute('open', '');
    };
    const user = userEvent.setup();
    withQuery(
      <Gallery
        project="premiera-proof"
        images={[image('a.png'), image('b.png')]}
        tasks={[...tasks]}
        view="all"
        onView={vi.fn()}
        onCat={vi.fn()}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Otwórz Title a.png' }));
    const caption = screen.getByRole('textbox', { name: 'Podpis' });
    expect(caption).toHaveValue('Caption a.png');
    await user.clear(caption);
    await user.type(caption, 'Nowy podpis');
    await user.click(screen.getByRole('textbox', { name: 'Tytuł' }));
    await vi.waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(fetch).toHaveBeenCalledWith('/api/projects/premiera-proof/images/a.png', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ caption: 'Nowy podpis' }),
    });

    await user.click(screen.getByRole('checkbox', { name: 'Drzwiczki' }));
    await vi.waitFor(() =>
      expect(fetch).toHaveBeenLastCalledWith('/api/projects/premiera-proof/images/a.png', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tasks: ['zakup-w-aplikacji'] }),
      }),
    );

    screen.getByRole('button', { name: 'Następny obraz' }).focus();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('textbox', { name: 'Podpis' })).toHaveValue('Caption b.png');
    await user.keyboard('{ArrowLeft}');
    expect(screen.getByRole('textbox', { name: 'Tytuł' })).toHaveValue('Title a.png');
  });
});

const card = (id: string, extra: Partial<BoardCard> = {}): BoardCard => {
  const [project = '', slug = ''] = id.split('/');
  return {
    id,
    ref: `taskpack://${id}`,
    project: { slug: project, name: 'Witrynka', color: '#C2410C' },
    slug,
    title: slug,
    status: 'todo',
    weight: 2,
    stepsDone: 1,
    stepsTotal: 3,
    progress: 33,
    isNew: false,
    hasQuestion: false,
    ...extra,
  };
};

describe('TaskCard', () => {
  it('shows weight, project, due date, steps, progress and the agent badge', () => {
    render(
      <TaskCardBody
        card={card('premiera-proof/zakup-w-aplikacji', {
          status: 'in_progress',
          weight: 4,
          due: '2026-09-28',
          agent: 'claude',
          isNew: true,
        })}
      />,
    );
    expect(screen.getByRole('img', { name: 'Waga 4/5' })).toBeInTheDocument();
    expect(screen.getByText('Witrynka')).toBeInTheDocument();
    expect(screen.getByText('28 wrz')).toBeInTheDocument();
    expect(screen.getByText('1 z 3 kroków zrobione')).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '33');
    expect(screen.getByText('Claude')).toBeInTheDocument();
    expect(screen.getByText('nowe od agenta')).toBeInTheDocument();
  });

  it('prefers the question flag over "new from agent"', () => {
    render(<TaskCardBody card={card('premiera-proof/x', { isNew: true, hasQuestion: true })} />);
    expect(screen.getByText('pytanie')).toBeInTheDocument();
    expect(screen.queryByText('nowe od agenta')).toBeNull();
    expect(screen.queryByRole('progressbar')).toBeNull();
  });
});

describe('moveCard (optimistic drag and drop)', () => {
  const board = {
    columns: [
      { status: 'inbox', cards: [card('a/one')] },
      { status: 'todo', cards: [card('a/two'), card('a/three')] },
      { status: 'in_progress', cards: [] },
      { status: 'waiting', cards: [] },
    ],
  } as unknown as BoardView;

  it('moves a card between columns and sets its status', () => {
    const next = moveCard(board, 'a/three', 'in_progress', 0);
    expect(next.columns.map((c) => c.cards.map((x) => x.id))).toEqual([['a/one'], ['a/two'], ['a/three'], []]);
    expect(next.columns[2]?.cards[0]?.status).toBe('in_progress');
  });

  it('reorders within a column', () => {
    const next = moveCard(board, 'a/three', 'todo', 0);
    expect(next.columns[1]?.cards.map((x) => x.id)).toEqual(['a/three', 'a/two']);
  });
});
