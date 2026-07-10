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
      <ellipse cx="12" cy="14.5" rx="3.4" ry="4.2" fill="var(--panel, #fff)" opacity="0.85" />
      <circle cx="10.4" cy="6.6" r="0.9" fill="var(--panel, #fff)" />
      <circle cx="13.6" cy="6.6" r="0.9" fill="var(--panel, #fff)" />
      <path fill="#e8a33d" d="M10.6 8.4h2.8L12 10.2z" />
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

/** The right OS mark for a device. */
export function OsIcon({ os, size = 13, style }: { os: string } & IconProps) {
  if (os === 'windows') return <WindowsLogo size={size} style={style} />;
  if (os === 'darwin') return <AppleLogo size={size} style={style} />;
  return <LinuxLogo size={size} style={style} />;
}
