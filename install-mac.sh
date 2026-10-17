#!/bin/bash
# Installiert MS Distress über Adobes eigenen Plugin-Installer (UPIA),
# damit Creative Cloud das Plugin kennt und es nicht wieder aus der Liste streicht.
# Danach Photoshop neu starten: Zusatzmodule (Plugins) > MS Distress.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
UPIA="/Library/Application Support/Adobe/Adobe Desktop Common/RemoteComponents/UPI/UnifiedPluginInstallerAgent/UnifiedPluginInstallerAgent.app/Contents/MacOS/UnifiedPluginInstallerAgent"

rm -f "$HERE/dist/MS-Distress.ccx"
mkdir -p "$HERE/dist"
(cd "$HERE/distress" && zip -qr "$HERE/dist/MS-Distress.ccx" . -x '.*')

# nur entfernen, wenn installiert (ein fehlendes Plugin zu entfernen lässt den Installer hängen)
if "$UPIA" --list all 2>/dev/null | grep -q "MS Distress "; then "$UPIA" --remove "MS Distress" >/dev/null 2>&1 || true; fi
"$UPIA" --install "$HERE/dist/MS-Distress.ccx"
echo "Fertig. Photoshop neu starten > Zusatzmodule (Plugins) > MS Distress"
