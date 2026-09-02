# Webcam Monitor

Einfaches Windows-Programm: Webcam oder Capture-Karte auswählen, Live-Bild anzeigen und den Ton mit Lautstärkeregler über die Lautsprecher wiedergeben.

## Bedienung

1. Programm starten (`WebcamMonitor-portable.exe` oder per Entwickler: `npm start`)
2. Auf **„Berechtigung anfordern“** klicken — Windows fragt nach Kamera- und Mikrofon-Zugriff
3. Falls keine Abfrage erscheint: Buttons **Kamera-Einstellungen** / **Mikrofon-Einstellungen** nutzen  
   (bei `npm start` heißt die App in Windows **„Electron“**)
4. Im Dropdown **Kamera auswählen** — das Bild füllt das Fenster maximal aus
5. **Vollbild** per Button oder **F11** — beenden mit **Esc** oder **F11**
6. **Lautstärke** mit dem Regler anpassen (0–100 %)

Die zuletzt gewählte Kamera und Lautstärke werden beim nächsten Start wiederhergestellt.

## Voraussetzungen (Endnutzer)

- Windows 10 oder neuer
- Capture-Karte oder Webcam, die vom System erkannt wird
- Kamera- und Mikrofon-Berechtigung für die App unter  
  **Einstellungen → Datenschutz → Kamera / Mikrofon**

## Bekannte Einschränkungen

- Manche Capture-Karten liefern Ton nur mit installiertem Herstellertreiber
- Wenn kein Ton hörbar ist: Mikrofon-Berechtigung prüfen und sicherstellen, dass die Karte Audio über dieselbe Quelle bereitstellt
- Die portable `.exe` ist ca. 80–150 MB groß (Electron enthält eine eigene Browser-Engine)
- Geringe Audio-Verzögerung ist bei Capture-Karten normal; die App nutzt direkte Audiowiedergabe ohne Echo-/Rauschfilter
- Bei Verbindungsabbruch versucht die App automatisch bis zu 5× neu zu verbinden

## Entwicklung

### Voraussetzungen

- [Node.js](https://nodejs.org/) (LTS, z. B. 20.x oder 22.x)
- npm (wird mit Node.js mitgeliefert)

### Installation

```bash
npm install
```

### App starten (Entwicklung)

```bash
npm start
```

### Windows-Build (.exe)

```bash
npm run build
```

Hinweis: Der Build ist ohne Code-Signing konfiguriert (`signAndEditExecutable: false`), damit er auch ohne Administratorrechte funktioniert. Für die Veröffentlichung kann optional ein Zertifikat ergänzt werden.

Ausgabe im Ordner `dist/`:

| Datei | Beschreibung |
|---|---|
| `WebcamMonitor-portable.exe` | Portable Version, kein Installer nötig |
| `WebcamMonitor-setup.exe` | Installer (NSIS) |

Nach dem Ersetzen von `assets/icon.png` Icons für Windows neu erzeugen:

```bash
npm run icons
npm run build
```

Das Skript zoomt das Icon leicht heran (bessere Darstellung in Taskleiste/Fenster) und erzeugt eine mehrstufige `icon.ico`.

Nur portable Version bauen:

```bash
npm run build:portable
```

## Projektstruktur

```
Webcam_Programm/
├── electron/          # Electron-Hauptprozess
├── src/               # UI und Media-Logik
├── assets/            # App-Icon
├── package.json
└── README.md
```

## Lizenz

MIT — kostenlos nutzbar und weitergeben.
