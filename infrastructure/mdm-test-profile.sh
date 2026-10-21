#!/usr/bin/env bash
# mdm-test-profile.sh — writes an unsigned enrollment profile (.mobileconfig)
# to enroll a first test device against NanoMDM + scep.
#
# Run inside the LXC:  bash infrastructure/mdm-test-profile.sh [output-file]
#
# The profile carries the SCEP challenge password, so it is written with mode
# 600 outside the repository and must not be shared or committed. Generating
# per-device profiles from the dashboard is ROADMAP "Etappe 1", not this.
#
# Inputs: SCEP_CHALLENGE_PASSWORD from .env, the APNs topic from
# mdm/push.pem. BASE_URL can be overridden for a different host.
set -euo pipefail

cd "$(dirname "$0")"

BASE_URL="${BASE_URL:-https://rmm.rxf-sys.de}"
OUT="${1:-/root/mdm-enroll/vulpexa-enroll-test.mobileconfig}"

challenge=$(grep '^SCEP_CHALLENGE_PASSWORD=' .env | cut -d= -f2- || true)
if [ -z "$challenge" ]; then
	echo "mdm-test-profile: SCEP_CHALLENGE_PASSWORD is empty in .env" >&2
	exit 1
fi
# Restricting the alphabet keeps the value safe to embed in XML unescaped.
case "$challenge" in
	*[!A-Za-z0-9]*)
		echo "mdm-test-profile: challenge must be alphanumeric (openssl rand -hex 24)" >&2
		exit 1
		;;
esac

if [ ! -r mdm/push.pem ]; then
	echo "mdm-test-profile: mdm/push.pem not found (docs/MDM-SETUP.md, part 3)" >&2
	exit 1
fi
topic=$(openssl x509 -in mdm/push.pem -noout -subject -nameopt RFC2253 \
	| sed -n 's/^subject=.*UID=\([^,]*\).*$/\1/p')
case "$topic" in
	com.apple.mgmt.External.*) ;;
	*)
		echo "mdm-test-profile: no APNs topic (UID=com.apple.mgmt.External.*) in mdm/push.pem" >&2
		exit 1
		;;
esac

uuid() { tr 'a-f' 'A-F' < /proc/sys/kernel/random/uuid; }
scep_uuid=$(uuid)
mdm_uuid=$(uuid)
profile_uuid=$(uuid)

umask 077
mkdir -p "$(dirname "$OUT")"
cat > "$OUT" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>PayloadContent</key>
	<array>
		<dict>
			<key>PayloadContent</key>
			<dict>
				<key>URL</key>
				<string>${BASE_URL}/scep</string>
				<key>Challenge</key>
				<string>${challenge}</string>
				<key>Keysize</key>
				<integer>2048</integer>
				<key>Key Type</key>
				<string>RSA</string>
				<key>Key Usage</key>
				<integer>5</integer>
				<key>Subject</key>
				<array>
					<array><array><string>O</string><string>rxf-sys</string></array></array>
					<array><array><string>CN</string><string>Vulpexa MDM Identity</string></array></array>
				</array>
			</dict>
			<key>PayloadDisplayName</key>
			<string>MDM-Identität (SCEP)</string>
			<key>PayloadIdentifier</key>
			<string>de.rxf-sys.rmm.mdm.scep</string>
			<key>PayloadType</key>
			<string>com.apple.security.scep</string>
			<key>PayloadUUID</key>
			<string>${scep_uuid}</string>
			<key>PayloadVersion</key>
			<integer>1</integer>
		</dict>
		<dict>
			<key>AccessRights</key>
			<integer>8191</integer>
			<key>CheckInURL</key>
			<string>${BASE_URL}/mdm</string>
			<key>CheckOutWhenRemoved</key>
			<true/>
			<key>IdentityCertificateUUID</key>
			<string>${scep_uuid}</string>
			<key>PayloadDisplayName</key>
			<string>Vulpexa MDM</string>
			<key>PayloadIdentifier</key>
			<string>de.rxf-sys.rmm.mdm</string>
			<key>PayloadType</key>
			<string>com.apple.mdm</string>
			<key>PayloadUUID</key>
			<string>${mdm_uuid}</string>
			<key>PayloadVersion</key>
			<integer>1</integer>
			<key>ServerCapabilities</key>
			<array>
				<string>com.apple.mdm.per-user-connections</string>
			</array>
			<key>ServerURL</key>
			<string>${BASE_URL}/mdm</string>
			<key>SignMessage</key>
			<true/>
			<key>Topic</key>
			<string>${topic}</string>
		</dict>
	</array>
	<key>PayloadDescription</key>
	<string>Testprofil: registriert dieses Gerät bei Vulpexa MDM.</string>
	<key>PayloadDisplayName</key>
	<string>Vulpexa MDM (Test)</string>
	<key>PayloadIdentifier</key>
	<string>de.rxf-sys.rmm.enroll.test</string>
	<key>PayloadOrganization</key>
	<string>rxf-sys</string>
	<key>PayloadScope</key>
	<string>System</string>
	<key>PayloadType</key>
	<string>Configuration</string>
	<key>PayloadUUID</key>
	<string>${profile_uuid}</string>
	<key>PayloadVersion</key>
	<integer>1</integer>
</dict>
</plist>
EOF

echo "mdm-test-profile: wrote $OUT (topic $topic)"
