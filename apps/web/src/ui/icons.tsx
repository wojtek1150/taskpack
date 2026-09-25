// Line icons from the designs (24×24, round caps). Decorative: callers label the control.

type IconProps = { size?: number; strokeWidth?: number };

const svg = (size: number, strokeWidth: number, children: React.ReactNode, fill = 'none') => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill={fill}
    stroke="currentColor"
    strokeWidth={strokeWidth}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    focusable="false"
  >
    {children}
  </svg>
);

export const PlusIcon = ({ size = 16, strokeWidth = 2.6 }: IconProps) =>
  svg(size, strokeWidth, <path d="M12 5v14M5 12h14" />);
export const BackIcon = ({ size = 16, strokeWidth = 2.2 }: IconProps) =>
  svg(size, strokeWidth, <path d="M15 6l-6 6 6 6" />);
export const ArrowIcon = ({ size = 14, strokeWidth = 2.4 }: IconProps) =>
  svg(size, strokeWidth, <path d="M7 17L17 7M9 7h8v8" />);
export const CalendarIcon = ({ size = 13, strokeWidth = 2 }: IconProps) =>
  svg(
    size,
    strokeWidth,
    <>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M3 10h18M8 3v4M16 3v4" />
    </>,
  );
export const CheckIcon = ({ size = 13, strokeWidth = 2 }: IconProps) =>
  svg(size, strokeWidth, <path d="M4 12l5 5L20 6" />);
export const SearchIcon = ({ size = 16, strokeWidth = 2 }: IconProps) =>
  svg(
    size,
    strokeWidth,
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-3.5-3.5" />
    </>,
  );
export const PinIcon = ({ size = 14, strokeWidth = 2, filled = false }: IconProps & { filled?: boolean }) =>
  svg(
    size,
    strokeWidth,
    <>
      <path d="M9 3h6l-1 6 4 4H6l4-4z" />
      <path d="M12 13v8" />
    </>,
    filled ? 'currentColor' : 'none',
  );
export const UpIcon = ({ size = 14, strokeWidth = 2.2 }: IconProps) =>
  svg(size, strokeWidth, <path d="M6 15l6-6 6 6" />);
export const DownIcon = ({ size = 14, strokeWidth = 2.2 }: IconProps) =>
  svg(size, strokeWidth, <path d="M6 9l6 6 6-6" />);
export const BoardIcon = ({ size = 18, strokeWidth = 2 }: IconProps) =>
  svg(
    size,
    strokeWidth,
    <>
      <rect x="3" y="4" width="5" height="16" rx="1.5" />
      <rect x="10" y="4" width="5" height="11" rx="1.5" />
      <rect x="17" y="4" width="4" height="7" rx="1.5" />
    </>,
  );
export const GridIcon = ({ size = 18, strokeWidth = 2 }: IconProps) =>
  svg(
    size,
    strokeWidth,
    <>
      <rect x="3" y="3" width="8" height="8" rx="2" />
      <rect x="13" y="3" width="8" height="8" rx="2" />
      <rect x="3" y="13" width="8" height="8" rx="2" />
      <rect x="13" y="13" width="8" height="8" rx="2" />
    </>,
  );
export const PlugIcon = ({ size = 18, strokeWidth = 2 }: IconProps) =>
  svg(size, strokeWidth, <path d="M9 3v5M15 3v5M6 8h12v3a6 6 0 0 1-12 0zM12 17v4" />);
export const SettingsIcon = ({ size = 18, strokeWidth = 2 }: IconProps) =>
  svg(
    size,
    strokeWidth,
    <>
      <path d="M4 7h9M17 7h3M4 17h3M11 17h9" />
      <circle cx="15" cy="7" r="2" />
      <circle cx="9" cy="17" r="2" />
    </>,
  );
export const SunIcon = ({ size = 18, strokeWidth = 2 }: IconProps) =>
  svg(
    size,
    strokeWidth,
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5L19 19M5 19l1.5-1.5M17.5 6.5L19 5" />
    </>,
  );
export const QuestionIcon = ({ size = 18, strokeWidth = 2 }: IconProps) =>
  svg(
    size,
    strokeWidth,
    <>
      <path d="M4 5h16v11H9l-5 4z" />
      <path d="M10 9.2a2 2 0 1 1 2.6 1.9c-.4.2-.6.5-.6.9M12 13.5v.1" />
    </>,
  );
export const NotesIcon = ({ size = 18, strokeWidth = 2 }: IconProps) =>
  svg(
    size,
    strokeWidth,
    <>
      <path d="M6 3h9l4 4v14H6z" />
      <path d="M14 3v5h5M9 12h7M9 16h5" />
    </>,
  );
export const LogoMark = () => (
  <svg
    width="18"
    height="18"
    viewBox="0 0 24 24"
    fill="none"
    stroke="#FFF7E6"
    strokeWidth="2.6"
    strokeLinecap="round"
    aria-hidden="true"
  >
    <path d="M5 9c4-2 10-2 14 0" />
    <path d="M6.5 13c3.2-1.4 7.8-1.4 11 0" />
    <path d="M8 17c2.4-.9 5.6-.9 8 0" />
  </svg>
);
