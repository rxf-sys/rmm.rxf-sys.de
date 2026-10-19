"""Die Herkunft, die der Client gesehen hat.

Hinter dem Cloudflare-Tunnel ist das nicht die Adresse, unter der dieser
Prozess lauscht. Alles, was eine URL erzeugt, die später wieder beim Server
ankommen soll — Enrollment-Skripte, MDM-Profile —, muss sie von hier holen.
"""

from __future__ import annotations

from fastapi import Request

from .config import get_settings


def public_base(request: Request) -> str:
    """Origin the CLIENT used, reconstructed behind the Cloudflare tunnel
    (X-Forwarded-Proto) so generated URLs point at https://rmm.rxf-sys.de,
    not the container-internal address.

    In production the public origin is always HTTPS — even when the
    forwarded header is missing (e.g. Caddy stripped it because
    TRUSTED_PROXY_CIDR isn't configured yet). An http:// base would break
    enrollment: the redirect to https turns the enroll POST into a GET
    (405)."""
    proto = request.headers.get("x-forwarded-proto") or request.url.scheme
    host = request.headers.get("host") or request.url.netloc
    if get_settings().app_env == "production":
        proto = "https"
    return f"{proto}://{host}"
