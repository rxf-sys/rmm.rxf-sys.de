import { useMemo } from 'react';
import { qrPath } from './qrPath';

/**
 * A QR code as plain SVG — no canvas, no data URL, nothing the CSP has to
 * allow. Dark on light in both themes: a light-on-dark code is not read by
 * every camera.
 */
export function QrCode({ value, label, size = 208 }: { value: string; label: string; size?: number }) {
  const { size: n, d } = useMemo(() => qrPath(value), [value]);
  return (
    <svg
      className="qr"
      role="img"
      aria-label={label}
      width={size}
      height={size}
      viewBox={`0 0 ${n} ${n}`}
      shapeRendering="crispEdges"
    >
      <rect className="qr-bg" width={n} height={n} />
      <path className="qr-fg" d={d} />
    </svg>
  );
}
