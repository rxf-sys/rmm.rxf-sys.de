"""Das Enrollment-Profil zum Herunterladen.

Ein Download, ein Profil für alle Telefone: welches Gerät dahintersteckt,
klärt die Registrierung selbst. Der Endpunkt ist operator-only, weil das
Profil die SCEP-Challenge im Klartext enthält — wer sie hat, kann sich ein
Gerätezertifikat ausstellen lassen und gilt damit bei NanoMDM als Gerät.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request, Response

from .. import mdm
from ..audit import record as audit_record
from ..auth import require_operator
from ..config import Settings, get_settings
from ..origin import public_base

router = APIRouter(prefix="/api/mdm", tags=["mdm"])


@router.get("/profile")
async def enrollment_profile(
    request: Request,
    user: dict = Depends(require_operator),
    settings: Settings = Depends(get_settings),
) -> Response:
    """Das ``.mobileconfig``, das ein Telefon bei uns anmeldet.

    409 mit Klartext, solange etwas fehlt — Push-Zertifikat oder Challenge.
    Das ist kein Fehler, sondern der Stand der Einrichtung."""
    try:
        topic = mdm.topic_from_push_cert(settings.mdm_push_cert_path)
        profile = mdm.build_profile(
            base_url=public_base(request),
            topic=topic,
            challenge=settings.scep_challenge_password,
            organization=settings.mdm_organization,
        )
    except mdm.ProfileError as e:
        raise HTTPException(status_code=409, detail=str(e)) from e

    await audit_record("mdm.profile_downloaded", user=user["username"], topic=topic)
    return Response(
        content=profile,
        media_type="application/x-apple-aspen-config",
        headers={"Content-Disposition": 'attachment; filename="vulpexa-enrollment.mobileconfig"'},
    )
