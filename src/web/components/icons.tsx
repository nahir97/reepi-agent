/**
 * Hand-drawn inline SVGs. One stroke weight, one grid, `currentColor`
 * throughout — no icon library, no emoji, nothing that needs a font.
 *
 * Every icon is presentational: the control that owns it carries the label.
 */

import type { SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function Glyph({ size = 14, children, ...rest }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.4}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {children}
    </svg>
  );
}

export const IconBook = (props: IconProps) => (
  <Glyph {...props}>
    <path d="M2.5 2.5h5a2 2 0 0 1 2 2v9a1.5 1.5 0 0 0-1.5-1.5h-5.5z" />
    <path d="M13.5 2.5h-5a2 2 0 0 0-2 2v9a1.5 1.5 0 0 1 1.5-1.5h5.5z" />
  </Glyph>
);

export const IconFeather = (props: IconProps) => (
  <Glyph {...props}>
    <path d="M12.5 3.5c-2 0-4.5 1-6 3s-1.5 4-1.5 5.5" />
    <path d="M3.5 13.5c0-4 2.5-9 9-10" />
    <path d="M6 8.5h4" />
    <path d="M5 11h3.5" />
  </Glyph>
);

export const IconLayers = (props: IconProps) => (
  <Glyph {...props}>
    <path d="M8 1.8 14 5l-6 3.2L2 5z" />
    <path d="M2 8.4l6 3.2 6-3.2" />
    <path d="M2 11.6 8 14.8l6-3.2" />
  </Glyph>
);

export const IconUsers = (props: IconProps) => (
  <Glyph {...props}>
    <circle cx="6" cy="5.6" r="2.4" />
    <path d="M1.8 13.6c0-2.3 1.9-3.8 4.2-3.8s4.2 1.5 4.2 3.8" />
    <path d="M10.6 3.6a2.2 2.2 0 0 1 0 4.2" />
    <path d="M11.6 10.2c1.6.3 2.6 1.5 2.6 3.4" />
  </Glyph>
);

export const IconUser = (props: IconProps) => (
  <Glyph {...props}>
    <circle cx="8" cy="5.4" r="2.7" />
    <path d="M2.8 14c0-2.7 2.3-4.4 5.2-4.4S13.2 11.3 13.2 14" />
  </Glyph>
);

export const IconScroll = (props: IconProps) => (
  <Glyph {...props}>
    <path d="M4.2 2.5h7.6a1.7 1.7 0 0 1 1.7 1.7v7.5a1.8 1.8 0 0 1-1.8 1.8H4.2" />
    <path d="M4.2 2.5A1.7 1.7 0 0 0 2.5 4.2v1.3h1.7z" />
    <path d="M5.8 6.4h4.4M5.8 9h3" />
  </Glyph>
);

/** A page with braces on it: reusable prompt text, not a document. */
export const IconTemplate = (props: IconProps) => (
  <Glyph {...props}>
    <path d="M9.6 2.5H4.6a1.6 1.6 0 0 0-1.6 1.6v7.8a1.6 1.6 0 0 0 1.6 1.6h6.8a1.6 1.6 0 0 0 1.6-1.6V5.6z" />
    <path d="M9.6 2.5v3.1h3.4" />
    <path d="M6.3 8.5c-.7 0-1.1.4-1.1 1.1v.5c0 .4-.2.6-.6.6.4 0 .6.2.6.6v.5c0 .7.4 1.1 1.1 1.1" />
    <path d="M9.7 8.5c.7 0 1.1.4 1.1 1.1v.5c0 .4.2.6.6.6-.4 0-.6.2-.6.6v.5c0 .7-.4 1.1-1.1 1.1" />
  </Glyph>
);

export const IconBrain = (props: IconProps) => (
  <Glyph {...props}>
    <path d="M6.5 2.6a2 2 0 0 0-2 2 1.9 1.9 0 0 0-1.2 3.2A2 2 0 0 0 4 11.4a2 2 0 0 0 2.5 2z" />
    <path d="M9.5 2.6a2 2 0 0 1 2 2 1.9 1.9 0 0 1 1.2 3.2A2 2 0 0 1 12 11.4a2 2 0 0 1-2.5 2z" />
    <path d="M8 2.4v11.4" />
  </Glyph>
);

export const IconClapper = (props: IconProps) => (
  <Glyph {...props}>
    <path d="M2.2 6.2h11.6v6.2a1.4 1.4 0 0 1-1.4 1.4H3.6a1.4 1.4 0 0 1-1.4-1.4z" />
    <path d="M2.2 6.2l1-3.2 10.6 2.3-1 3.1" />
    <path d="M5.4 3.3 4.4 6.2M8.6 4 7.6 6.2" />
  </Glyph>
);

export const IconSpark = (props: IconProps) => (
  <Glyph {...props}>
    <path d="M8 1.8 9.4 6l4.2 1.4L9.4 8.8 8 13l-1.4-4.2L2.4 7.4 6.6 6z" />
  </Glyph>
);

export const IconChart = (props: IconProps) => (
  <Glyph {...props}>
    <path d="M2.2 13.4h11.6" />
    <path d="M4 11.2V8M6.8 11.2V4.6M9.6 11.2V6.4M12.4 11.2V2.8" />
  </Glyph>
);

export const IconGauge = (props: IconProps) => (
  <Glyph {...props}>
    <path d="M2 11.4a6 6 0 1 1 12 0" />
    <path d="M8 11.4 11 7.2" />
  </Glyph>
);

export const IconClock = (props: IconProps) => (
  <Glyph {...props}>
    <circle cx="8" cy="8" r="5.8" />
    <path d="M8 4.6V8l2.4 1.6" />
  </Glyph>
);

export const IconFlame = (props: IconProps) => (
  <Glyph {...props}>
    <path d="M8 1.8c2.2 2.4 4.2 4.3 4.2 7.1A4.2 4.2 0 0 1 8 14.2a4.2 4.2 0 0 1-4.2-5.3c.5-1.9 1.8-3.2 2.6-4.4.5.9.9 1.4 1.6 1.9.2-1.4-.1-3 0-4.6z" />
  </Glyph>
);

export const IconSnow = (props: IconProps) => (
  <Glyph {...props}>
    <path d="M8 2v12M3 5l10 6M13 5 3 11" />
    <path d="M8 2 6.6 3.6M8 2l1.4 1.6M8 14l-1.4-1.6M8 14l1.4-1.6" />
  </Glyph>
);

export const IconSend = (props: IconProps) => (
  <Glyph {...props}>
    <path d="M14 2 7.2 8.9" />
    <path d="M14 2 9.8 14.2 7.2 8.9 2 6.2z" />
  </Glyph>
);

export const IconStop = (props: IconProps) => (
  <Glyph {...props}>
    <rect x="4" y="4" width="8" height="8" rx="1.4" />
  </Glyph>
);

export const IconArrowDown = (props: IconProps) => (
  <Glyph {...props}>
    <path d="M8 3v10" />
    <path d="M4 9.2 8 13.2l4-4" />
  </Glyph>
);

export const IconChevronLeft = (props: IconProps) => (
  <Glyph {...props}>
    <path d="M10 3.5 5.5 8l4.5 4.5" />
  </Glyph>
);

export const IconChevronRight = (props: IconProps) => (
  <Glyph {...props}>
    <path d="M6 3.5 10.5 8 6 12.5" />
  </Glyph>
);

export const IconChevronDown = (props: IconProps) => (
  <Glyph {...props}>
    <path d="M3.5 6 8 10.5 12.5 6" />
  </Glyph>
);

export const IconPlus = (props: IconProps) => (
  <Glyph {...props}>
    <path d="M8 3v10M3 8h10" />
  </Glyph>
);


export const IconClose = (props: IconProps) => (
  <Glyph {...props}>
    <path d="M3.5 3.5 12.5 12.5M12.5 3.5 3.5 12.5" />
  </Glyph>
);

export const IconCheck = (props: IconProps) => (
  <Glyph {...props}>
    <path d="M3 8.4 6.4 11.8 13 5" />
  </Glyph>
);

export const IconAlert = (props: IconProps) => (
  <Glyph {...props}>
    <path d="M8 2.4 14.4 13H1.6z" />
    <path d="M8 6.6v3.2M8 11.6v.1" />
  </Glyph>
);

export const IconLock = (props: IconProps) => (
  <Glyph {...props}>
    <rect x="3.2" y="7" width="9.6" height="6.6" rx="1.4" />
    <path d="M5.6 7V5.2a2.4 2.4 0 0 1 4.8 0V7" />
  </Glyph>
);

export const IconEyeOff = (props: IconProps) => (
  <Glyph {...props}>
    <path d="M2.2 8s2.4-4 5.8-4c1 0 1.9.3 2.7.7" />
    <path d="M13.2 6.2c.4.7.6 1.3.6 1.8 0 0-2.4 4-5.8 4-.9 0-1.7-.2-2.4-.6" />
    <path d="M2.8 2.8 13.2 13.2" />
  </Glyph>
);

export const IconPen = (props: IconProps) => (
  <Glyph {...props}>
    <path d="M11.4 2.6 13.4 4.6 5.6 12.4 2.8 13.2l.8-2.8z" />
    <path d="M9.6 4.4 11.6 6.4" />
  </Glyph>
);

export const IconCopy = (props: IconProps) => (
  <Glyph {...props}>
    <rect x="5.4" y="5.4" width="8" height="8" rx="1.4" />
    <path d="M10.6 5.4V4a1.4 1.4 0 0 0-1.4-1.4H4a1.4 1.4 0 0 0-1.4 1.4v5.2A1.4 1.4 0 0 0 4 10.6h1.4" />
  </Glyph>
);

export const IconTrash = (props: IconProps) => (
  <Glyph {...props}>
    <path d="M2.6 4.4h10.8" />
    <path d="M4.2 4.4 5 13a1 1 0 0 0 1 .9h4a1 1 0 0 0 1-.9l.8-8.6" />
    <path d="M6.4 4.4V3a1 1 0 0 1 1-1h1.2a1 1 0 0 1 1 1v1.4" />
  </Glyph>
);

export const IconSplit = (props: IconProps) => (
  <Glyph {...props}>
    <circle cx="4" cy="4" r="1.8" />
    <circle cx="4" cy="12" r="1.8" />
    <circle cx="12" cy="8" r="1.8" />
    <path d="M5.8 4c2 .4 3.4 1.8 4.4 4M5.8 12c2-.4 3.4-1.8 4.4-4" />
  </Glyph>
);

export const IconSkip = (props: IconProps) => (
  <Glyph {...props}>
    <path d="M3.4 3.4v9.2l7-4.6z" />
    <path d="M12.2 3.4v9.2" />
  </Glyph>
);

export const IconRefresh = (props: IconProps) => (
  <Glyph {...props}>
    <path d="M13.2 8a5.2 5.2 0 1 1-1.5-3.6" />
    <path d="M13.4 2.4v3.2h-3.2" />
  </Glyph>
);

export const IconDownload = (props: IconProps) => (
  <Glyph {...props}>
    <path d="M8 2.4v7.4" />
    <path d="M4.8 6.8 8 10l3.2-3.2" />
    <path d="M2.8 12.6h10.4" />
  </Glyph>
);

export const IconUpload = (props: IconProps) => (
  <Glyph {...props}>
    <path d="M8 10V2.6" />
    <path d="M4.8 5.8 8 2.6l3.2 3.2" />
    <path d="M2.8 12.6h10.4" />
  </Glyph>
);

export const IconSettings = (props: IconProps) => (
  <Glyph {...props}>
    <circle cx="8" cy="8" r="2.2" />
    <path d="M8 1.6v1.6M8 12.8v1.6M3.5 3.5l1.1 1.1M11.4 11.4l1.1 1.1M1.6 8h1.6M12.8 8h1.6M3.5 12.5l1.1-1.1M11.4 4.6l1.1-1.1" />
  </Glyph>
);

export const IconMenu = (props: IconProps) => (
  <Glyph {...props}>
    <path d="M2.4 4.2h11.2M2.4 8h11.2M2.4 11.8h11.2" />
  </Glyph>
);

/** A row's overflow: three dots rather than three buttons. Filled, not stroked —
    at this radius a 1.4px outline is a ring, not a dot. */
export const IconMore = (props: IconProps) => (
  <Glyph {...props}>
    <circle cx="3.4" cy="8" r="1.15" fill="currentColor" stroke="none" />
    <circle cx="8" cy="8" r="1.15" fill="currentColor" stroke="none" />
    <circle cx="12.6" cy="8" r="1.15" fill="currentColor" stroke="none" />
  </Glyph>
);

export const IconPanelRight = (props: IconProps) => (
  <Glyph {...props}>
    <rect x="1.8" y="2.8" width="12.4" height="10.4" rx="1.4" />
    <path d="M9.8 2.8v10.4" />
  </Glyph>
);

export const IconPin = (props: IconProps) => (
  <Glyph {...props}>
    <path d="M6 2.4h4l-.5 3.4 2.5 2.2H4l2.5-2.2z" />
    <path d="M8 8v5.6" />
  </Glyph>
);

export const IconSearch = (props: IconProps) => (
  <Glyph {...props}>
    <circle cx="7" cy="7" r="4.2" />
    <path d="M10.2 10.2 14 14" />
  </Glyph>
);

export const IconWand = (props: IconProps) => (
  <Glyph {...props}>
    <path d="M3 13 11.4 4.6" />
    <path d="M9.8 3 13 6.2" />
    <path d="M12.4 9.6v2.2M11.3 10.7h2.2M4.2 2.4v1.8M3.3 3.3h1.8" />
  </Glyph>
);

export const IconNote = (props: IconProps) => (
  <Glyph {...props}>
    <path d="M3 2.6h10v7.4l-3.4 3.4H3z" />
    <path d="M13 10h-3.4v3.4" />
    <path d="M5.4 5.6h5.2M5.4 8h3.4" />
  </Glyph>
);

export const IconWarm = (props: IconProps) => (
  <IconFlame {...props} />
);


export const IconGlobe = (props: IconProps) => (
  <Glyph {...props}>
    <circle cx="8" cy="8" r="5.8" />
    <path d="M2.2 8h11.6" />
    <path d="M8 2.2c1.6 1.7 2.5 3.7 2.5 5.8S9.6 12.1 8 13.8C6.4 12.1 5.5 10.1 5.5 8S6.4 3.9 8 2.2z" />
  </Glyph>
);

export const IconAlertCircle = (props: IconProps) => (
  <Glyph {...props}>
    <circle cx="8" cy="8" r="5.8" />
    <path d="M8 4.8v3.6M8 10.8v.1" />
  </Glyph>
);

export const IconCheckCircle = (props: IconProps) => (
  <Glyph {...props}>
    <circle cx="8" cy="8" r="5.8" />
    <path d="M5.4 8.2 7.2 10l3.4-3.8" />
  </Glyph>
);

export const IconQuote = (props: IconProps) => (
  <Glyph {...props}>
    <path d="M6.4 3.4C4.4 4.2 3.2 6 3.2 8.2c0 2.2 1.2 3.6 2.8 3.6 1.3 0 2.2-.9 2.2-2.1 0-1.1-.8-2-1.9-2-.2 0-.4 0-.5.1.2-1.1 1-2 2.1-2.5z" />
    <path d="M12.8 3.4c-2 .8-3.2 2.6-3.2 4.8 0 2.2 1.2 3.6 2.8 3.6 1.3 0 2.2-.9 2.2-2.1 0-1.1-.8-2-1.9-2-.2 0-.4 0-.5.1.2-1.1 1-2 2.1-2.5z" />
  </Glyph>
);
