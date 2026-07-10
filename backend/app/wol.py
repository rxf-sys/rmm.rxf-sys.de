"""Wake-on-LAN: send a magic packet to a device's MAC address.

The RMM server sits on the same LAN as the fleet (Proxmox LXC), so it can
broadcast a UDP magic packet that a sleeping NIC listens for. MAC addresses
come from the hardware inventory the agent reports. Best-effort: WoL depends
on the target's BIOS/NIC being configured for it, which the server can't
verify — a successful send is not a guaranteed wake.
"""

from __future__ import annotations

import re
import socket
import structlog

log = structlog.get_logger("wol")

_MAC_RE = re.compile(r"^[0-9A-Fa-f]{2}([:-][0-9A-Fa-f]{2}){5}$")

# Ports commonly used for WoL; 9 (discard) is the classic, 7 (echo) a fallback.
_PORTS = (9, 7)


def normalize_mac(mac: str) -> str | None:
    """Return the 12 hex chars of a MAC, or None if it doesn't parse."""
    if not _MAC_RE.match(mac.strip()):
        return None
    return re.sub(r"[:-]", "", mac.strip()).lower()


def _magic_packet(mac_hex: str) -> bytes:
    return b"\xff" * 6 + bytes.fromhex(mac_hex) * 16


def wake(macs: list[str], broadcast: str = "255.255.255.255") -> int:
    """Broadcast a magic packet for each valid MAC. Returns how many were
    sent. Raises OSError only if the socket itself can't be opened."""
    sent = 0
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
        for mac in macs:
            mac_hex = normalize_mac(mac)
            if mac_hex is None:
                continue
            packet = _magic_packet(mac_hex)
            for port in _PORTS:
                try:
                    sock.sendto(packet, (broadcast, port))
                except OSError as e:  # one bad port shouldn't abort the rest
                    log.warning("wol.send_failed", mac=mac, port=port, error=str(e))
            sent += 1
    log.info("wol.sent", count=sent)
    return sent
