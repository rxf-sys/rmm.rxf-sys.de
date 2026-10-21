#!/bin/sh
# Wrapper around scepserver. scepserver reads all flags from SCEP_* variables.
#
# Without a challenge password scepserver signs every CSR it receives, so
# anyone who can reach /scep would get a certificate NanoMDM trusts. Refuse to
# serve in that case instead of relying on someone noticing an empty .env.
#
# "ca ..." (e.g. "ca -init") is passed through unchecked: it only creates the
# CA in the depot and does not serve anything.
set -eu

if [ "${1:-}" = "ca" ]; then
	exec /usr/local/bin/scepserver "$@"
fi

if [ -z "${SCEP_CHALLENGE_PASSWORD:-}" ]; then
	echo "scep: SCEP_CHALLENGE_PASSWORD is empty, refusing to start (see docs/MDM-SETUP.md, part 4)" >&2
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
