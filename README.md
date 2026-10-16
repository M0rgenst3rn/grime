# MS Distress – Photoshop-Plugin (UXP)

Gibt beliebigen Ebenen (Text, Formen, Smartobjekte, Pixel, auch mehrere gleichzeitig) einen
Distressed-Look. Der Effekt landet **nicht-destruktiv als Ebenenmaske**. Die Schrift bleibt also editierbar.
Mit ⌘Z machst du ihn rückgängig, mit „Entfernen“ wirst du ihn wieder los.

Voraussetzung: Photoshop 2023 (24.2) oder neuer. Getestet wird für Photoshop 2026.

## Installation

**Variante A – Script (dauerhaft, empfohlen auf dem Mac)**
1. Photoshop beenden.
2. Im Terminal: `bash install-mac.sh`
3. Photoshop starten → *Fenster › Zusatzmodule (Plugins) › MS Distress*

**Variante B – .ccx-Datei:** `dist/MS Distress-Pro.ccx` doppelklicken. Die Datei ist nicht von Adobe signiert.
Je nach Creative-Cloud-Version gibt es eine Warnung oder die Installation wird abgelehnt.
Dann Variante A oder C nehmen.

**Variante C – UXP Developer Tool:** Über die Creative-Cloud-App „UXP Developer Tools“ installieren.
In Photoshop unter *Einstellungen › Zusatzmodule* den Entwicklermodus aktivieren.
Im Tool dann *Add Plugin* → `distress/manifest.json` → *Load*.

## Regler

| Regler | Wirkung |
|---|---|
| **Textur** | 36 prozedurale Texturen + „Eigene Ebene“ (eine beliebige Ebene im Dokument als Textur) |
| **Scale / Rotation** | Größe (10–500 %) und Drehung der Textur |
| **Shape Distress** | Wie viel an den Kanten der Form abgetragen wird |
| **Shape Meld** | Härte des Übergangs: 0 = harte Stempelkanten, 100 = weich verschmolzen |
| **Edge Roughness** | Fransige/angeknabberte Außenkante in Pixeln |
| **Inner Distress** | Wie viel im Inneren der Form abgetragen wird |
| **Inner Edge Size** | Breite der Kantenzone (px), in der *Shape Distress* gilt; dahinter gilt *Inner Distress* |
| **Fade Amount / Style** | Lässt den Effekt verlaufen (oben, unten, links, rechts, diagonal, radial, Rahmen, Wolken) |
| **Wirkt auf** | Der Fade wirkt auf Distress, auf die Deckkraft oder auf beides |
| **Shape Color** | Färbt abgetragene Stellen ein (eigene Ebene „… · Distress-Farbe“ über der Ebene) |
| **Random Seed** | Neue Variante derselben Einstellung. Bei Mehrfachauswahl optional pro Ebene variiert |
| **Bild-Texturen** | „+ Bild laden…“ importiert PNG/JPG/TIF/PSD dauerhaft als eigene Textur-Kacheln |
| **Textur 2** | Zweite Textur überlagern: Überblenden, Addieren oder Maskieren, mit Mix und eigener Scale |
| **Presets** | 11 mitgelieferte Presets + eigene speichern/löschen |

Die Texturen werden intern gleichverteilt. Darum bedeutet „40 % Distress“ bei jeder Textur
ungefähr 40 % abgetragene Fläche.

## Dateien
- `distress/` – das Plugin (manifest.json, index.html, main.js = Photoshop-Anbindung, core.js = Textur-Engine)
- `dist/MS Distress-Pro.ccx` – gepacktes Plugin
- `tools/render-test.js` – rendert alle Texturen ohne Photoshop als PNG (`node tools/render-test.js out.png`)
