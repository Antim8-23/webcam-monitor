# Changelog

Alle relevanten Änderungen an Webcam Monitor werden hier dokumentiert.

Das Projekt verwendet [Semantic Versioning](https://semver.org/lang/de/) (`MAJOR.MINOR.PATCH`):

- **PATCH** (z. B. `1.0.1`) — Fehlerbehebungen, abwärtskompatibel
- **MINOR** (z. B. `1.1.0`) — neue Funktionen, abwärtskompatibel
- **MAJOR** (z. B. `2.0.0`) — größere, inkompatible Änderungen

## [1.0.8] - 2026-11-17

### Fixed

- Capture-Karten mit eingebettetem DirectShow-/Videogerät-Audio – darunter die Elgato Game Capture HD60 S – verwenden wieder zuerst den Audiotrack der gewählten Kamera. Dadurch funktioniert HDMI-Ton auch dann, wenn er niemals als separates Windows-Audioeingabegerät erscheint.
- Die separate Ton-Auswahl bleibt nur noch ein Fallback für Capture-Karten mit einem eigenständigen Audioeingang.

## [1.0.7] - 2026-11-17

### Fixed

- Die automatische Audiozuordnung verwechselt Capture-Karten nicht mehr mit anderen Geräten desselben Herstellers. USB-Vendor-IDs und Herstellernamen allein gelten nicht mehr als Treffer; erforderlich sind gemeinsame Modellbegriffe wie `HD60`.
- Der Status meldet dadurch nicht mehr fälschlich eine erfolgreiche Tonverbindung, wenn beispielsweise ein Elgato Wave-Mikrofon statt der Capture-Karte gewählt wurde.

## [1.0.6] - 2026-11-17

### Fixed

- HDMI-Audio von Capture-Karten wird bei getrennter Windows-Gerätegruppe zusätzlich anhand gemeinsamer Modellbezeichnungen automatisch zugeordnet (z. B. „Game Capture HD60 S“ und „Game Capture HD60 S Audio“).
- Installierte Versionen laden Updates nicht mehr fälschlich als portable EXE herunter.

### Added

- Installierte Windows-Versionen laden den geprüften NSIS-Installer direkt in der App herunter, prüfen Größe und SHA-256 und starten anschließend die stille Installation.
- Der Release-Build ist für Authenticode-Code-Signing vorbereitet.

## [1.0.5] - 2026-11-17

### Fixed

- Die Kamera wird jetzt unabhängig von Audio angefordert. Ein fehlendes, gesperrtes oder anders zugeordnetes Audiogerät kann die Bildvorschau nicht mehr mit `OverconstrainedError` verhindern.
- Keine Auflösung oder Bildrate wird mehr erzwungen; jede Kamera bzw. Capture-Karte verwendet ihr tatsächlich ausgehandeltes Eingabeformat.
- Video und Capture-Audio werden getrennt verbunden. Dadurch funktioniert HDMI-Ton auch dann, wenn Windows Bild und Ton nicht in dieselbe Gerätegruppe einsortiert.
- Fehlermeldungen für Kamera- und Audiozugriff erklären den jeweiligen Fehlerzustand statt nur „Keine Details vorhanden“ anzuzeigen.

### Added

- Auswahlfeld **Ton** mit automatischer Zuordnung und manueller Wahl eines Audio-Eingabegeräts.

### Changed

- Electron auf 45.3.3, electron-builder auf 26.18.0 und sharp auf 0.35.5 aktualisiert. Damit werden die beim Audit gemeldeten kritischen bzw. hohen Abhängigkeitslücken geschlossen.

## [1.0.4] - 2026-11-17

### Fixed

- Fehlerbehebung: Startprobleme auf neuer Hardware durch Reduzierung der idealen Auflösung auf 1080p.
- verbesserte Fehlermeldungen für bessere Diagnose von `getUserMedia`-Fehlern.

## [1.0.3] - 2026-09-02

### Added

- In-App-Prüfung auf neue stabile Webcam-Monitor-Versionen über die öffentliche `latest.json`
- Update-Hinweis mit Download-Link und optionalen Release Notes

### Changed

- Update-Prüfung läuft sicher im Electron-Main-Prozess statt im Renderer
- README/Datenschutz-Dokumentation um den einmaligen Versionsabruf beim Start ergänzt
- Update-Metadaten und Download-URLs werden vor Verwendung strikt auf HTTPS, Host und erwartetes Schema validiert

## [1.0.2] - 2026-09-02

### Added

- Automatische Erzeugung einer stabilen `latest.json` mit Versions-, Download-, SHA256-, Größen- und Release-Note-Metadaten
- `latest.json` wird bei Releases automatisch auf den JaTi-Digital-Downloadserver übertragen

### Changed

- Release-Workflow aktualisiert die stabile Release-Metadatei erst nach erfolgreichem Upload und Verifikation aller versionierten Artefakte

## [1.0.1] - 2026-09-02

### Changed

- electron-builder veröffentlicht bei Tag-Builds nicht mehr automatisch selbst nach GitHub
- GitHub-Release-Workflow überträgt Release-Dateien vor Veröffentlichung automatisch auf den JaTi-Digital-Downloadserver

### Fixed

- SSH-Host-Key wird im Release-Workflow strikt über known_hosts verifiziert

## [1.0.0] - 2026-09-02

### Added

- Windows-App für Live-Vorschau von Webcam oder Capture-Karte mit Tonwiedergabe
- Kameraauswahl, Lautstärkeregler, Stummschalten und Vollbildmodus (F11 / Esc)
- Automatische Wiederverbindung bei Signalunterbrechung (bis zu 5 Versuche)
- Windows-Builds als portable EXE und NSIS-Installer
- Speicherung der zuletzt gewählten Kamera und Lautstärke zwischen Sitzungen
- Öffentliche Open-Source-Veröffentlichung unter MIT-Lizenz

### Changed

- Icon-Generierung skaliert proportional ohne Beschnitt (statt Reinzoomen per Crop)

### Fixed

- App-Icons werden beim Erzeugen nicht mehr am Rand abgeschnitten
