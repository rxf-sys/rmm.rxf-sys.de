/** Inline SVG icon set — replaces the unicode/emoji glyphs. Stroke icons
 * inherit `currentColor`; OS logos are filled marks. No icon-font or
 * dependency: everything ships inside the bundle. */

import type { CSSProperties } from 'react';

interface IconProps {
  size?: number;
  style?: CSSProperties;
}

function S({ size = 15, style, children }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ flexShrink: 0, verticalAlign: '-0.15em', ...style }}
      aria-hidden
    >
      {children}
    </svg>
  );
}

// --- Navigation ---------------------------------------------------------------

export const IconGrid = (p: IconProps) => (
  <S {...p}>
    <rect x="3" y="3" width="7" height="7" rx="1.5" />
    <rect x="14" y="3" width="7" height="7" rx="1.5" />
    <rect x="3" y="14" width="7" height="7" rx="1.5" />
    <rect x="14" y="14" width="7" height="7" rx="1.5" />
  </S>
);

export const IconMonitor = (p: IconProps) => (
  <S {...p}>
    <rect x="2" y="4" width="20" height="13" rx="2" />
    <path d="M8 21h8M12 17v4" />
  </S>
);

export const IconUsers = (p: IconProps) => (
  <S {...p}>
    <circle cx="9" cy="8" r="3.5" />
    <path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6" />
    <path d="M16.5 4.6a3.5 3.5 0 0 1 0 6.8M18 14.4c2.1.8 3.5 2.9 3.5 5.6" />
  </S>
);

export const IconBell = (p: IconProps) => (
  <S {...p}>
    <path d="M18 9a6 6 0 1 0-12 0c0 6-2.5 7-2.5 7h17S18 15 18 9" />
    <path d="M10 20a2.2 2.2 0 0 0 4 0" />
  </S>
);

export const IconShield = (p: IconProps) => (
  <S {...p}>
    <path d="M12 2.5 4.5 5.5v6c0 5 3.2 8.3 7.5 10 4.3-1.7 7.5-5 7.5-10v-6z" />
  </S>
);

export const IconShieldCheck = (p: IconProps) => (
  <S {...p}>
    <path d="M12 2.5 4.5 5.5v6c0 5 3.2 8.3 7.5 10 4.3-1.7 7.5-5 7.5-10v-6z" />
    <path d="m8.8 11.8 2.3 2.3 4.2-4.2" />
  </S>
);

export const IconTerminal = (p: IconProps) => (
  <S {...p}>
    <rect x="2" y="4" width="20" height="16" rx="2" />
    <path d="m6.5 9 3.5 3-3.5 3M12.5 15H17" />
  </S>
);

export const IconClock = (p: IconProps) => (
  <S {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3.5 2" />
  </S>
);

export const IconList = (p: IconProps) => (
  <S {...p}>
    <path d="M8.5 6h13M8.5 12h13M8.5 18h13" />
    <path d="M3 6h.01M3 12h.01M3 18h.01" />
  </S>
);

export const IconSettings = (p: IconProps) => (
  <S {...p}>
    <circle cx="12" cy="12" r="3.2" />
    <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1.03 1.56V21a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1.11-1.56 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.58 15a1.7 1.7 0 0 0-1.56-1.03H3a2 2 0 1 1 0-4h.09A1.7 1.7 0 0 0 4.65 8.86a1.7 1.7 0 0 0-.34-1.87l-.06-.06A2 2 0 1 1 7.08 4.1l.06.06a1.7 1.7 0 0 0 1.87.34h.08A1.7 1.7 0 0 0 10.12 3V2.9a2 2 0 1 1 4 0V3a1.7 1.7 0 0 0 1.03 1.56h.08a1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87v.08A1.7 1.7 0 0 0 21.1 10.1h.09a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.56 1.03z" />
  </S>
);

// --- Actions -------------------------------------------------------------------

export const IconSun = (p: IconProps) => (
  <S {...p}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
  </S>
);

export const IconMoon = (p: IconProps) => (
  <S {...p}>
    <path d="M20.5 14.5A8.5 8.5 0 1 1 9.5 3.5a7 7 0 0 0 11 11" />
  </S>
);

export const IconLogout = (p: IconProps) => (
  <S {...p}>
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
    <path d="m16 17 5-5-5-5M21 12H9" />
  </S>
);

export const IconMenu = (p: IconProps) => (
  <S {...p}>
    <path d="M3 6h18M3 12h18M3 18h18" />
  </S>
);

export const IconSearch = (p: IconProps) => (
  <S {...p}>
    <circle cx="11" cy="11" r="7" />
    <path d="m21 21-4.2-4.2" />
  </S>
);

export const IconPower = (p: IconProps) => (
  <S {...p}>
    <path d="M12 2v9" />
    <path d="M18.4 6.6a9 9 0 1 1-12.8 0" />
  </S>
);

export const IconWrench = (p: IconProps) => (
  <S {...p}>
    <path d="M14.7 6.3a4.5 4.5 0 0 0 5.9 5.9l-6.8 6.8a2.12 2.12 0 0 1-3-3l6.8-6.8a4.5 4.5 0 0 0-5.9-5.9l2.3 2.3-3 3z" transform="rotate(90 12 12)" />
  </S>
);

export const IconKey = (p: IconProps) => (
  <S {...p}>
    <circle cx="7.5" cy="15.5" r="4.5" />
    <path d="m11 12 9.5-9.5M16 4l3.5 3.5M13 7l2.5 2.5" />
  </S>
);

export const IconFileCode = (p: IconProps) => (
  <S {...p}>
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <path d="M14 2v6h6" />
    <path d="m9.5 13-2 2 2 2M14.5 13l2 2-2 2" />
  </S>
);

export const IconDownload = (p: IconProps) => (
  <S {...p}>
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <path d="m7 10 5 5 5-5M12 15V3" />
  </S>
);

export const IconActivity = (p: IconProps) => (
  <S {...p}>
    <path d="M22 12h-4l-3 8-6-16-3 8H2" />
  </S>
);

export const IconBook = (p: IconProps) => (
  <S {...p}>
    <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
    <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
  </S>
);

export const IconCopy = (p: IconProps) => (
  <S {...p}>
    <rect x="9" y="9" width="13" height="13" rx="2" />
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
  </S>
);

// --- Status (always paired with a word; the shape alone must differ) -------

export const IconStatusOk = (p: IconProps) => (
  <S {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="m8.5 12.5 2.5 2.5 4.5-5" />
  </S>
);
export const IconStatusWarn = (p: IconProps) => (
  <S {...p}>
    <path d="M10.3 3.9 2.4 17.6A2 2 0 0 0 4.1 20.6h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
    <path d="M12 9v4M12 17h.01" />
  </S>
);
export const IconStatusDanger = (p: IconProps) => (
  <S {...p}>
    <path d="M7.9 2.5h8.2l5.4 5.4v8.2l-5.4 5.4H7.9l-5.4-5.4V7.9Z" />
    <path d="M12 8v4.5M12 16h.01" />
  </S>
);
export const IconStatusOff = (p: IconProps) => (
  <S {...p}>
    <circle cx="12" cy="12" r="9" strokeDasharray="3.2 2.6" />
    <path d="M9 9l6 6M15 9l-6 6" />
  </S>
);
export const IconInfo = (p: IconProps) => (
  <S {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 11v5M12 8h.01" />
  </S>
);

// --- Actions and navigation ------------------------------------------------

export const IconChevronLeft = (p: IconProps) => (
  <S {...p}>
    <path d="m15 18-6-6 6-6" />
  </S>
);
export const IconChevronRight = (p: IconProps) => (
  <S {...p}>
    <path d="m9 18 6-6-6-6" />
  </S>
);
export const IconChevronDown = (p: IconProps) => (
  <S {...p}>
    <path d="m6 9 6 6 6-6" />
  </S>
);
export const IconChevronUp = (p: IconProps) => (
  <S {...p}>
    <path d="m18 15-6-6-6 6" />
  </S>
);
export const IconSort = (p: IconProps) => (
  <S {...p}>
    <path d="m7 15 5 5 5-5M7 9l5-5 5 5" />
  </S>
);
export const IconMore = (p: IconProps) => (
  <S {...p}>
    <circle cx="5" cy="12" r="1" />
    <circle cx="12" cy="12" r="1" />
    <circle cx="19" cy="12" r="1" />
  </S>
);
export const IconRestart = (p: IconProps) => (
  <S {...p}>
    <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
    <path d="M3 3v5h5" />
  </S>
);
export const IconPlay = (p: IconProps) => (
  <S {...p}>
    <path d="M7 4.5v15l12-7.5Z" />
  </S>
);
export const IconPlus = (p: IconProps) => (
  <S {...p}>
    <path d="M12 5v14M5 12h14" />
  </S>
);
export const IconX = (p: IconProps) => (
  <S {...p}>
    <path d="M18 6 6 18M6 6l12 12" />
  </S>
);
export const IconCheck = (p: IconProps) => (
  <S {...p}>
    <path d="m5 12.5 4.5 4.5L19 7.5" />
  </S>
);
export const IconFilter = (p: IconProps) => (
  <S {...p}>
    <path d="M3 5h18l-7 8.5V19l-4 2v-7.5Z" />
  </S>
);
export const IconBookmark = (p: IconProps) => (
  <S {...p}>
    <path d="M6 3.5h12v17l-6-4-6 4Z" />
  </S>
);
export const IconExternal = (p: IconProps) => (
  <S {...p}>
    <path d="M14 4h6v6M20 4l-9 9" />
    <path d="M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5" />
  </S>
);
export const IconPackage = (p: IconProps) => (
  <S {...p}>
    <path d="M21 8 12 3 3 8v8l9 5 9-5Z" />
    <path d="M3 8l9 5 9-5M12 13v8M7.5 5.5l9 5" />
  </S>
);
export const IconHistory = (p: IconProps) => (
  <S {...p}>
    <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
    <path d="M3 3v5h5M12 7v5l3 2" />
  </S>
);
export const IconKeyboard = (p: IconProps) => (
  <S {...p}>
    <rect x="2.5" y="5.5" width="19" height="13" rx="2" />
    <path d="M6.5 9.5h.01M10 9.5h.01M13.5 9.5h.01M17 9.5h.01M7 14.5h10" />
  </S>
);
export const IconTag = (p: IconProps) => (
  <S {...p}>
    <path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8Z" />
    <path d="M7.5 7.5h.01" />
  </S>
);
export const IconLaptop = (p: IconProps) => (
  <S {...p}>
    <rect x="4" y="4.5" width="16" height="11" rx="1.5" />
    <path d="M2 19.5h20" />
  </S>
);
export const IconArrowRight = (p: IconProps) => (
  <S {...p}>
    <path d="M5 12h14M13 6l6 6-6 6" />
  </S>
);
export const IconUpgrade = (p: IconProps) => (
  <S {...p}>
    <path d="M12 19V5M6 11l6-6 6 6" />
  </S>
);
export const IconEye = (p: IconProps) => (
  <S {...p}>
    <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z" />
    <circle cx="12" cy="12" r="3" />
  </S>
);
export const IconWake = (p: IconProps) => (
  <S {...p}>
    <path d="M13 2 4 14h7l-1 8 9-12h-7Z" />
  </S>
);

// Brand-Artwork lebt in public/favicon.svg (Vulpexa-Fuchs) — Sidebar/Login
// binden es als <img> ein, damit Tab-Icon und App-Logo identisch sind.

// --- OS logos (filled marks) ---------------------------------------------------

export function WindowsLogo({ size = 13, style }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" style={{ flexShrink: 0, verticalAlign: '-0.1em', ...style }} aria-hidden>
      <path d="M3 5.5 10.5 4.4v7.1H3zM3 18.5v-6h7.5v7.1zM11.5 4.25 21 3v8.5h-9.5zM11.5 12.5H21V21l-9.5-1.25z" />
    </svg>
  );
}

export function AppleLogo({ size = 13, style }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" style={{ flexShrink: 0, verticalAlign: '-0.1em', ...style }} aria-hidden>
      <path d="M17.05 12.54c-.03-2.5 2.04-3.7 2.13-3.76-1.16-1.7-2.97-1.93-3.61-1.96-1.54-.16-3 .9-3.78.9-.77 0-1.98-.88-3.25-.86-1.67.03-3.22.97-4.08 2.47-1.74 3.01-.44 7.47 1.25 9.92.83 1.2 1.81 2.54 3.1 2.49 1.25-.05 1.72-.8 3.22-.8s1.93.8 3.25.78c1.34-.02 2.19-1.22 3.01-2.42.94-1.39 1.33-2.73 1.35-2.8-.03-.01-2.59-1-2.62-3.96zM14.56 4.9c.68-.83 1.15-1.98 1.02-3.13-.99.04-2.18.66-2.89 1.48-.63.73-1.19 1.9-1.04 3.02 1.1.09 2.23-.56 2.91-1.37z" />
    </svg>
  );
}

export function LinuxLogo({ size = 13, style }: IconProps) {
  // Simplified Tux silhouette: body + belly + feet, readable at 13px.
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ flexShrink: 0, verticalAlign: '-0.1em', ...style }} aria-hidden>
      <path
        fill="currentColor"
        d="M12 2c-2.6 0-4.2 1.9-4.2 4.6 0 1.5-.5 2.7-1.2 4-.8 1.4-1.8 3-1.8 5 0 1.3.4 2.4 1.1 3.3-.3.3-.5.8-.5 1.3 0 1 .9 1.8 2.1 1.8h9c1.2 0 2.1-.8 2.1-1.8 0-.5-.2-1-.5-1.3.7-.9 1.1-2 1.1-3.3 0-2-1-3.6-1.8-5-.7-1.3-1.2-2.5-1.2-4C16.2 3.9 14.6 2 12 2z"
      />
      <ellipse cx="12" cy="14.5" rx="3.4" ry="4.2" fill="var(--surface)" opacity="0.85" />
      <circle cx="10.4" cy="6.6" r="0.9" fill="var(--surface)" />
      <circle cx="13.6" cy="6.6" r="0.9" fill="var(--surface)" />
      <path fill="var(--warn)" d="M10.6 8.4h2.8L12 10.2z" />
    </svg>
  );
}

export function ServerRack({ size = 13, style }: IconProps) {
  return (
    <S size={size} style={style}>
      <rect x="3" y="3" width="18" height="7" rx="1.5" />
      <rect x="3" y="14" width="18" height="7" rx="1.5" />
      <path d="M7 6.5h.01M7 17.5h.01M11 6.5h4M11 17.5h4" />
    </S>
  );
}

export function IconPhone({ size = 13, style }: IconProps) {
  return (
    <S size={size} style={style}>
      <rect x="6.5" y="2.5" width="11" height="19" rx="2.5" />
      <path d="M10.5 18.5h3" />
    </S>
  );
}

/** The right OS mark for a device. */
export function OsIcon({ os, size = 13, style }: { os: string } & IconProps) {
  if (os === 'windows') return <WindowsLogo size={size} style={style} />;
  if (os === 'darwin' || os === 'ios' || os === 'ipados')
    return <AppleLogo size={size} style={style} />;
  if (os === 'android' || os === 'other') return <IconPhone size={size} style={style} />;
  return <LinuxLogo size={size} style={style} />;
}
