# Changelog

Alle relevanten Änderungen an Webcam Monitor werden hier dokumentiert.

Das Projekt verwendet [Semantic Versioning](https://semver.org/lang/de/) (`MAJOR.MINOR.PATCH`):

- **PATCH** (z. B. `1.0.1`) — Fehlerbehebungen, abwärtskompatibel
- **MINOR** (z. B. `1.1.0`) — neue Funktionen, abwärtskompatibel
- **MAJOR** (z. B. `2.0.0`) — größere, inkompatible Änderungen

## [Unreleased]

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
