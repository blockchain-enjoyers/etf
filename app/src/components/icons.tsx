import type { ReactNode } from "react";

// Small line icons (currentColor) for module headers — sized to sit left of a title, matching the
// terminal mockup's `.iconw` glyphs.
function Svg({ children }: { children: ReactNode }) {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {children}
    </svg>
  );
}

export const IconChart = () => (
  <Svg>
    <path d="M3 17l5-6 4 4 7-9" />
  </Svg>
);
export const IconCheck = () => (
  <Svg>
    <path d="M3 12l4 4 14-12" />
  </Svg>
);
export const IconGrid = () => (
  <Svg>
    <rect x="3" y="3" width="7" height="7" rx="1.5" />
    <rect x="14" y="3" width="7" height="7" rx="1.5" />
    <rect x="3" y="14" width="7" height="7" rx="1.5" />
    <rect x="14" y="14" width="7" height="7" rx="1.5" />
  </Svg>
);
export const IconDownload = () => (
  <Svg>
    <path d="M12 3v12M7 11l5 5 5-5M5 21h14" />
  </Svg>
);
export const IconUpload = () => (
  <Svg>
    <path d="M12 21V9M7 13l5-5 5 5M5 3h14" />
  </Svg>
);
export const IconDollar = () => (
  <Svg>
    <path d="M12 2v20M16 6.5C16 4.5 14.2 3.5 12 3.5S8 4.6 8 6.7c0 4.6 8 2.3 8 6.8 0 2.1-1.8 3.2-4 3.2s-4-1.1-4-3.1" />
  </Svg>
);
export const IconTicket = () => (
  <Svg>
    <path d="M4 8a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2 2 2 0 0 0 0 4 2 2 0 0 1-2 2H6a2 2 0 0 1-2-2 2 2 0 0 0 0-4z" />
  </Svg>
);
export const IconChecklist = () => (
  <Svg>
    <path d="M9 6h11M9 12h11M9 18h11M4 6l1 1 2-2M4 12l1 1 2-2M4 18l1 1 2-2" />
  </Svg>
);
export const IconClock = () => (
  <Svg>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </Svg>
);
export const IconCoins = () => (
  <Svg>
    <ellipse cx="9" cy="7" rx="6" ry="3" />
    <path d="M3 7v5c0 1.7 2.7 3 6 3M15 12c3.3 0 6 1.3 6 3s-2.7 3-6 3-6-1.3-6-3" />
  </Svg>
);
export const IconGauge = () => (
  <Svg>
    <path d="M12 14l4-4M5 18a9 9 0 1 1 14 0" />
  </Svg>
);
export const IconEdit = () => (
  <Svg>
    <path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
  </Svg>
);
export const IconSwap = () => (
  <Svg>
    <path d="M7 4l-4 4 4 4M3 8h14M17 20l4-4-4-4M21 16H7" />
  </Svg>
);
export const IconHistory = () => (
  <Svg>
    <path d="M3 12a9 9 0 1 0 3-6.7L3 8M3 4v4h4M12 8v4l3 2" />
  </Svg>
);
