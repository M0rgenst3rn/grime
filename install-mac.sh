#!/bin/bash
# Installs MS Distress via Adobe's own plugin installer (UPIA),
# so Creative Cloud knows the plugin and doesn't drop it from the list again.
# Restart Photoshop afterwards: Plugins > MS Distress.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
UPIA="/Library/Application Support/Adobe/Adobe Desktop Common/RemoteComponents/UPI/UnifiedPluginInstallerAgent/UnifiedPluginInstallerAgent.app/Contents/MacOS/UnifiedPluginInstallerAgent"

rm -f "$HERE/dist/MS-Distress.ccx"
mkdir -p "$HERE/dist"
(cd "$HERE/distress" && zip -qr "$HERE/dist/MS-Distress.ccx" . -x '.*')

# only remove if installed (removing a missing plugin hangs the installer)
if "$UPIA" --list all 2>/dev/null | grep -q "MS Distress "; then "$UPIA" --remove "MS Distress" >/dev/null 2>&1 || true; fi
"$UPIA" --install "$HERE/dist/MS-Distress.ccx"
echo "Done. Restart Photoshop > Plugins > MS Distress"
