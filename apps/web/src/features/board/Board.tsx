import {
  type Announcements,
  closestCorners,
  DndContext,
  type DragEndEvent,
  type DragOverEvent,
  DragOverlay,
  type DragStartEvent,
  KeyboardSensor,
  PointerSensor,
  useDroppable,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Link } from '@tanstack/react-router';
import type { BoardCard, BoardStatus, BoardView } from '@taskpack/api';
import { BOARD_COLUMNS } from '@taskpack/api';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMoveTask } from '../../lib/queries';
import type { BoardFilter } from '../../router';
import { PlusIcon } from '../../ui/icons';
import styles from './Board.module.css';
import { cardClass, cardStyles, TaskCardBody } from './TaskCard';

const DOT: Record<BoardStatus, string> = {
  inbox: 'var(--subtle)',
  todo: 'var(--mustard)',
  in_progress: 'var(--accent)',
  waiting: 'var(--brown)',
};

type Items = Record<BoardStatus, string[]>;

const keep = (filter: BoardFilter | undefined) => (c: BoardCard) =>
  !filter || (filter === 'heavy' && c.weight >= 4) || (filter === 'agent' && Boolean(c.agent));

function itemsFrom(board: BoardView, filter: BoardFilter | undefined): Items {
  const out = { inbox: [], todo: [], in_progress: [], waiting: [] } as Items;
  for (const col of board.columns) out[col.status] = col.cards.filter(keep(filter)).map((c) => c.id);
  return out;
}

const SORT_TRANSITION = { duration: 200, easing: 'cubic-bezier(0.23, 1, 0.32, 1)' };

function SortableCard({
  card,
  fresh,
  suppressClick,
}: {
  card: BoardCard;
  /** Appeared after the board was first shown (an agent or another window added it). */
  fresh: boolean;
  suppressClick: () => boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: card.id,
    transition: SORT_TRANSITION,
  });
  const [project = '', task = ''] = card.id.split('/');
  return (
    <Link
      ref={setNodeRef}
      to="/p/$project/t/$task"
      params={{ project, task }}
      draggable={false}
      className={cardClass(card, `${isDragging ? cardStyles.dragging : ''} ${fresh ? cardStyles.enter : ''}`)}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      data-card={card.id}
      onClick={(e) => {
        if (suppressClick()) e.preventDefault();
      }}
      {...attributes}
      {...listeners}
      // The link is the drag handle too: keep link semantics for screen readers.
      role="link"
    >
      <TaskCardBody card={card} />
    </Link>
  );
}

function Column({
  status,
  ids,
  cards,
  fresh,
  suppressClick,
  onAdd,
}: {
  status: BoardStatus;
  ids: string[];
  cards: Map<string, BoardCard>;
  fresh: Set<string>;
  suppressClick: () => boolean;
  onAdd: (status: BoardStatus) => void;
}) {
  const { t } = useTranslation();
  const { setNodeRef, isOver } = useDroppable({ id: status });
  const name = t(`status.${status}`);
  return (
    <section className={styles.column} aria-label={name} data-column={status}>
      <div className={styles.head}>
        <span className="dot" style={{ background: DOT[status] }} />
        <h2 className={styles.name}>{name}</h2>
        <span className={styles.count}>{ids.length}</span>
        <button
          type="button"
          className={styles.add}
          aria-label={t('board.addTaskTo', { column: name })}
          onClick={() => onAdd(status)}
        >
          <PlusIcon size={14} strokeWidth={2.4} />
        </button>
      </div>
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        <div ref={setNodeRef} className={`${styles.list} ${isOver ? styles.over : ''}`}>
          {ids.map((id) => {
            const card = cards.get(id);
            return card ? (
              <SortableCard key={id} card={card} fresh={fresh.has(id)} suppressClick={suppressClick} />
            ) : null;
          })}
          {ids.length === 0 && <div className={styles.empty}>{t('board.emptyColumn')}</div>}
        </div>
      </SortableContext>
    </section>
  );
}

/** The four columns with drag and drop between and within them (mouse, touch and keyboard). */
export function Board({
  board,
  filter,
  onAdd,
}: {
  board: BoardView;
  filter: BoardFilter | undefined;
  onAdd: (status: BoardStatus) => void;
}) {
  const { t } = useTranslation();
  const move = useMoveTask();
  const [items, setItems] = useState<Items>(() => itemsFrom(board, filter));
  const [active, setActive] = useState<string | null>(null);
  const dragEnded = useRef(0);
  const origin = useRef<{ status: BoardStatus; index: number } | null>(null);

  const cards = useMemo(() => new Map(board.columns.flatMap((c) => c.cards).map((c) => [c.id, c])), [board]);
  // Cards seen so far: only cards that arrive later (SSE) get the enter animation.
  const known = useRef<Set<string> | null>(null);
  const fresh = new Set(known.current ? [...cards.keys()].filter((id) => !known.current?.has(id)) : []);
  useEffect(() => {
    known.current = new Set([...(known.current ?? []), ...cards.keys()]);
  }, [cards]);
  /** Keyboard drags drop in place, without the settle animation. */
  const [keyboardDrag, setKeyboardDrag] = useState(false);
  // Follow server data (SSE, refetch) except in the middle of a drag.
  useEffect(() => {
    if (!active) setItems(itemsFrom(board, filter));
  }, [board, filter, active]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    // Enter keeps opening the card (it is a link); Space picks it up.
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
      keyboardCodes: { start: ['Space'], cancel: ['Escape'], end: ['Space', 'Enter'] },
    }),
  );

  const containerOf = (id: string): BoardStatus | undefined =>
    (BOARD_COLUMNS as readonly string[]).includes(id)
      ? (id as BoardStatus)
      : BOARD_COLUMNS.find((s) => items[s].includes(id));

  const onDragStart = ({ active: a, activatorEvent }: DragStartEvent) => {
    const id = String(a.id);
    setKeyboardDrag(activatorEvent instanceof KeyboardEvent);
    setActive(id);
    const status = containerOf(id);
    if (status) origin.current = { status, index: items[status].indexOf(id) };
  };

  const onDragOver = ({ active: a, over }: DragOverEvent) => {
    if (!over) return;
    const id = String(a.id);
    const from = containerOf(id);
    const to = containerOf(String(over.id));
    if (!from || !to || from === to) return;
    setItems((prev) => {
      const target = prev[to];
      const overIndex = target.indexOf(String(over.id));
      const index = overIndex >= 0 ? overIndex : target.length;
      return {
        ...prev,
        [from]: prev[from].filter((x) => x !== id),
        [to]: [...target.slice(0, index), id, ...target.slice(index)],
      };
    });
  };

  const onDragEnd = ({ active: a, over }: DragEndEvent) => {
    const id = String(a.id);
    dragEnded.current = Date.now();
    setActive(null);
    const status = over ? containerOf(String(over.id)) : undefined;
    if (!over || !status) {
      setItems(itemsFrom(board, filter));
      return;
    }
    let list = items[status];
    const oldIndex = list.indexOf(id);
    const overIndex = list.indexOf(String(over.id));
    if (oldIndex >= 0 && overIndex >= 0 && oldIndex !== overIndex) list = arrayMove(list, oldIndex, overIndex);
    setItems((prev) => ({ ...prev, [status]: list }));

    const position = list.indexOf(id);
    if (origin.current && origin.current.status === status && origin.current.index === position) return;
    // The server orders the whole column; map the place in the (maybe filtered) list to it.
    const full = (board.columns.find((c) => c.status === status)?.cards ?? []).map((c) => c.id).filter((x) => x !== id);
    const before = list[position - 1];
    const after = list[position + 1];
    const index = before ? full.indexOf(before) + 1 : after ? Math.max(full.indexOf(after), 0) : full.length;
    move.mutate({ id, status, index });
  };

  const announcements: Announcements = {
    onDragStart: ({ active: a }) => t('dnd.picked', { title: cards.get(String(a.id))?.title }),
    onDragOver: ({ active: a, over }) =>
      over
        ? t('dnd.over', { title: cards.get(String(a.id))?.title, column: t(`status.${containerOf(String(over.id))}`) })
        : undefined,
    onDragEnd: ({ active: a, over }) =>
      over
        ? t('dnd.dropped', {
            title: cards.get(String(a.id))?.title,
            column: t(`status.${containerOf(String(over.id))}`),
          })
        : t('dnd.cancelled'),
    onDragCancel: () => t('dnd.cancelled'),
  };

  const activeCard = active ? cards.get(active) : undefined;
  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragEnd={onDragEnd}
      onDragCancel={() => {
        setActive(null);
        setItems(itemsFrom(board, filter));
      }}
      accessibility={{ announcements, screenReaderInstructions: { draggable: t('dnd.instructions') } }}
    >
      <div className={styles.board}>
        {BOARD_COLUMNS.map((status) => (
          <Column
            key={status}
            status={status}
            ids={items[status]}
            cards={cards}
            onAdd={onAdd}
            fresh={fresh}
            suppressClick={() => Date.now() - dragEnded.current < 250}
          />
        ))}
      </div>
      <DragOverlay
        dropAnimation={
          keyboardDrag || (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches)
            ? null
            : { duration: 200, easing: 'cubic-bezier(0.23, 1, 0.32, 1)' }
        }
      >
        {activeCard ? (
          <div className={cardClass(activeCard, cardStyles.overlay)}>
            <TaskCardBody card={activeCard} />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
