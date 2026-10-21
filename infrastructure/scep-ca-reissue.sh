#!/usr/bin/env bash
# scep-ca-reissue.sh — re-issue the SCEP CA certificate with Key Encipherment.
#
# Run inside the LXC:  bash infrastructure/scep-ca-reissue.sh
#
# Why: `scepserver ca -init` (micromdm/scep v2.3.0, file depot) creates the CA
# with Key Usage "Digital Signature, Certificate Sign, CRL Sign" only. Apple's
# SCEP client encrypts its request to a certificate marked for Key
# Encipherment; with none on offer, iOS aborts the profile installation with
# "Die SCEP-Serverkonfiguration wird nicht unterstützt" before it ever sends
# a request. (micromdm/scep's own bolt depot sets the bit for this reason,
# commit b29dc20.)
#
# What: a new self-signed certificate for the SAME key and the SAME subject,
# valid until the old one expires, with Key Encipherment added. Certificates
# already issued to devices keep verifying, because issuer name and key do not
# change — nothing has to be re-enrolled. The old ca.pem files are kept next
# to the new ones as ca.pem.<date>.bak.
#
# Inputs: scep-depot/ca.key, scep-depot/ca.pem, SCEP_CA_PASS from .env.
# Writes: scep-depot/ca.pem and mdm/ca.pem, then restarts scep and nanomdm.
# Running it again on a fixed CA changes nothing.
set -euo pipefail

cd "$(dirname "$0")"

DEPOT=scep-depot
MDM=mdm
STAMP=$(date +%Y-%m-%d-%H%M%S)

die() {
	echo "scep-ca-reissue: $*" >&2
	exit 1
}

[ -r "$DEPOT/ca.key" ] || die "$DEPOT/ca.key not readable (run as root in infrastructure/)"
[ -r "$DEPOT/ca.pem" ] || die "$DEPOT/ca.pem not readable"
command -v openssl >/dev/null || die "openssl not installed"

if openssl x509 -in "$DEPOT/ca.pem" -noout -ext keyUsage | grep -q 'Key Encipherment'; then
	echo "scep-ca-reissue: $DEPOT/ca.pem already has Key Encipherment, nothing to do"
	exit 0
fi

pass=$(grep '^SCEP_CA_PASS=' .env | cut -d= -f2- || true)
[ -n "$pass" ] || die "SCEP_CA_PASS is empty in .env"

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
umask 077

# Days until the old certificate expires: the new one ends on the same day.
not_after=$(openssl x509 -in "$DEPOT/ca.pem" -noout -enddate | cut -d= -f2)
days=$(( ($(date -d "$not_after" +%s) - $(date +%s)) / 86400 ))
[ "$days" -gt 0 ] || die "the CA has expired ($not_after) — a new CA is needed, see docs/MDM-SETUP.md part 4"

# The Subject Key Identifier is copied, not recomputed: micromdm/scep derives
# it differently from openssl, and every device certificate names it in its
# Authority Key Identifier. A new value would orphan them all.
ski=$(openssl x509 -in "$DEPOT/ca.pem" -noout -ext subjectKeyIdentifier | sed -n '2p' | tr -d ' ')
case "$ski" in
	*:*) ;;
	*) die "could not read the Subject Key Identifier of $DEPOT/ca.pem" ;;
esac

cat > "$work/ext.cnf" <<EOF
[v3_ca]
basicConstraints = critical, CA:TRUE, pathlen:0
keyUsage = critical, digitalSignature, keyEncipherment, keyCertSign, cRLSign
subjectKeyIdentifier = $ski
EOF

# -signkey keeps the subject of the input certificate and makes it the issuer
# as well; -clrext drops the old extensions so the file above is the whole set.
# A random serial cannot collide with the device certificates, which
# scepserver numbers from 2 upwards.
openssl x509 -in "$DEPOT/ca.pem" -signkey "$DEPOT/ca.key" -passin fd:3 3<<<"$pass" \
	-clrext -extfile "$work/ext.cnf" -extensions v3_ca \
	-days "$days" -set_serial "0x$(openssl rand -hex 8)" -sha256 \
	-out "$work/ca.pem" 2>"$work/err" || { cat "$work/err" >&2; die "openssl failed"; }

# Same key, subject and key identifier — otherwise stop before touching
# anything.
same() {
	[ "$(openssl x509 -in "$work/ca.pem" -noout "$@")" = "$(openssl x509 -in "$DEPOT/ca.pem" -noout "$@")" ]
}
same -pubkey || die "new certificate has a different public key"
same -subject || die "new certificate has a different subject"
same -ext subjectKeyIdentifier || die "new certificate has a different Subject Key Identifier"

# Every device certificate in the depot must still verify against the new CA.
checked=0
for cert in "$DEPOT"/*.pem; do
	[ "$cert" = "$DEPOT/ca.pem" ] && continue
	openssl x509 -in "$cert" -noout 2>/dev/null || continue
	openssl verify -CAfile "$work/ca.pem" "$cert" >/dev/null \
		|| die "$cert does not verify against the new CA — nothing was changed"
	checked=$((checked + 1))
done
echo "scep-ca-reissue: $checked device certificate(s) verify against the new CA"

# Keep the old files; overwrite in place so owner and mode stay as they are.
cp -p "$DEPOT/ca.pem" "$DEPOT/ca.pem.$STAMP.bak"
cat "$work/ca.pem" > "$DEPOT/ca.pem"
if [ -e "$MDM/ca.pem" ]; then
	cp -p "$MDM/ca.pem" "$MDM/ca.pem.$STAMP.bak"
fi
cat "$work/ca.pem" > "$MDM/ca.pem"

openssl x509 -in "$DEPOT/ca.pem" -noout -subject -enddate -ext keyUsage
echo "scep-ca-reissue: SHA-256 fingerprint $(openssl x509 -in "$DEPOT/ca.pem" -noout -fingerprint -sha256 | cut -d= -f2)"

docker compose --profile mdm restart scep nanomdm
echo "scep-ca-reissue: done — old certificates kept as ca.pem.$STAMP.bak"
