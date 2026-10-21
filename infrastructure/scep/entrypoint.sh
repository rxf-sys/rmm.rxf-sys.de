#!/bin/sh
# Wrapper around scepserver. scepserver reads all flags from SCEP_* variables.
#
# Without any challenge check scepserver signs every CSR it receives, so
# anyone who can reach /scep would get a certificate NanoMDM trusts. Exactly
# one of two modes must be configured, otherwise the container refuses to
# serve instead of relying on someone noticing an empty .env:
#
# - SCEP_VERIFY_TOKEN set (from MDM_SCEP_VERIFY_TOKEN): every CSR goes to
#   scep-csr-verifier, which asks the backend whether its challenge belongs
#   to an open enrollment. One-time challenges per device; the normal mode.
# - SCEP_CHALLENGE_PASSWORD set: one static challenge for every profile.
#   Only for the manual test profile (infrastructure/_archiv/).
#
# Both at once cannot work: scepserver would demand the static challenge AND
# a backend-issued one from the same CSR. That is refused too.
#
# "ca ..." (e.g. "ca -init") is passed through unchecked: it only creates the
# CA in the depot and does not serve anything.
set -eu

if [ "${1:-}" = "ca" ]; then
	exec /usr/local/bin/scepserver "$@"
fi

if [ -n "${SCEP_VERIFY_TOKEN:-}" ] && [ -n "${SCEP_CHALLENGE_PASSWORD:-}" ]; then
	echo "scep: both MDM_SCEP_VERIFY_TOKEN and SCEP_CHALLENGE_PASSWORD are set; remove SCEP_CHALLENGE_PASSWORD from .env (see docs/MDM-SETUP.md, part 6)" >&2
	exit 1
fi
if [ -n "${SCEP_VERIFY_TOKEN:-}" ]; then
	export SCEP_CSR_VERIFIER_EXEC=/usr/local/bin/scep-csr-verifier
elif [ -z "${SCEP_CHALLENGE_PASSWORD:-}" ]; then
	echo "scep: neither MDM_SCEP_VERIFY_TOKEN nor SCEP_CHALLENGE_PASSWORD is set, refusing to start (see docs/MDM-SETUP.md, part 4)" >&2
	exit 1
fi
if [ -z "${SCEP_CA_PASS:-}" ]; then
	echo "scep: SCEP_CA_PASS is empty, cannot read the encrypted ca.key (see docs/MDM-SETUP.md, part 4)" >&2
	exit 1
fi
if [ ! -r "${SCEP_FILE_DEPOT:-depot}/ca.key" ]; then
	echo "scep: ${SCEP_FILE_DEPOT:-depot}/ca.key missing or not readable for uid $(id -u)" >&2
	exit 1
fi

exec /usr/local/bin/scepserver "$@"
