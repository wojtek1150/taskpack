import type { ImageCategory, ImageView } from '@taskpack/api';
import styles from './ImageArt.module.css';

const BACKGROUNDS = ['#C2410C', '#ECEAE5', '#7C2D12', '#77716A', '#EAB308'];
const LIGHT = new Set(['#ECEAE5', '#EAB308']);

function hash(text: string): number {
  let h = 0;
  for (const ch of text) h = (h * 31 + (ch.codePointAt(0) ?? 0)) >>> 0;
  return h;
}

/** Line drawing per category, as in the design's gallery tiles. */
function Glyph({ category, ink, size }: { category: ImageCategory; ink: string; size: number }) {
  const common = { fill: 'none', stroke: ink, strokeLinecap: 'round' as const };
  switch (category) {
    case 'visualization':
      return (
        <svg
          aria-hidden="true"
          width={size * 0.6}
          height={size}
          viewBox="0 0 60 100"
          strokeWidth={1.4}
          strokeLinejoin="round"
          {...common}
        >
          <rect x="6" y="6" width="48" height="82" rx="1" />
          <line x1="30" y1="6" x2="30" y2="88" />
          <rect x="10" y="10" width="16" height="74" />
          <rect x="34" y="10" width="16" height="74" />
          <path d="M10 34h16M10 58h16M34 34h16M34 58h16M27.5 44v8M32.5 44v8M9 88v7M51 88v7" />
        </svg>
      );
    case 'drawing':
      return (
        <svg aria-hidden="true" width={size * 0.8} height={size} viewBox="0 0 80 100" strokeWidth={1.2} {...common}>
          <rect x="20" y="10" width="40" height="76" />
          <line x1="20" y1="48" x2="60" y2="48" strokeDasharray="2 2" />
          <path d="M10 10v76M7 10h6M7 86h6M20 94h40M20 91v6M60 91v6" />
        </svg>
      );
    case 'inspiration':
      return (
        <svg aria-hidden="true" width={size} height={size} viewBox="0 0 100 100" strokeWidth={1.6} {...common}>
          <path d="M10 30c20-8 30 8 50 0s25-4 30 0M10 50c20-8 30 8 50 0s25-4 30 0M10 70c20-8 30 8 50 0s25-4 30 0" />
          <ellipse cx="60" cy="52" rx="6" ry="3" />
        </svg>
      );
    case 'progress':
      return (
        <svg
          aria-hidden="true"
          width={size}
          height={size}
          viewBox="0 0 100 100"
          strokeWidth={1.6}
          strokeLinejoin="round"
          {...common}
        >
          <rect x="12" y="22" width="76" height="58" rx="4" />
          <circle cx="34" cy="42" r="7" />
          <path d="M12 72l22-18 16 12 14-10 24 18" />
        </svg>
      );
    default:
      return (
        <svg aria-hidden="true" width={size} height={size} viewBox="0 0 100 100" strokeWidth={1.6} {...common}>
          <path d="M20 80V25h45v18h15v37z" />
          <line x1="65" y1="43" x2="65" y2="80" strokeDasharray="3 3" />
          <path d="M80 43h8M80 25h8M84 25v18" />
        </svg>
      );
  }
}

/**
 * Drawings, SVGs and generated placeholder cards (PDF, HEIC) are shown whole on a tinted
 * background; cropping them would cut off dimensions or text. Photos fill the tile.
 */
export const showWhole = (image: Pick<ImageView, 'file' | 'category'>) =>
  image.category === 'drawing' || /\.(svg|pdf|heic|heif)$/i.test(image.file);

/**
 * The picture area of an image tile: the 480 px thumbnail from `.taskpack/thumbs` (SVGs are
 * rasterized, PDFs get a generated card), or, when the file is missing, a styled placeholder
 * with a category drawing.
 */
export function ImageArt({ image, size = 100 }: { image: ImageView; size?: number }) {
  if (!image.placeholder) {
    const contain = showWhole(image);
    return (
      <div className={contain ? `${styles.art} ${styles.tinted}` : styles.art}>
        <img
          className={contain ? `${styles.img} ${styles.contain}` : styles.img}
          src={image.thumbUrl}
          alt={image.caption || image.title}
          loading="lazy"
        />
      </div>
    );
  }
  const bg = BACKGROUNDS[hash(image.file) % BACKGROUNDS.length] ?? '#ECEAE5';
  const ink = LIGHT.has(bg) ? '#1C1917' : '#FFF7E6';
  return (
    <div
      className={styles.art}
      style={{ background: `var(--grad-tile-sheen), ${bg}` }}
      role="img"
      aria-label={image.caption || image.title}
      title={image.exists ? undefined : image.file}
    >
      <Glyph category={image.category} ink={ink} size={size} />
      {!image.exists && <span className={styles.missing}>{image.file}</span>}
    </div>
  );
}

export const tileBackground = (file: string) => BACKGROUNDS[hash(file) % BACKGROUNDS.length] ?? '#ECEAE5';
