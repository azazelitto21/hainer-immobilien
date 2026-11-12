# VON POLL · Wohnungsdatenbank Designstudie

Private, unabhängige Designstudie. Die Anzeigen und Fotos dienen der Illustration. Website und Offline-Demo sind keine offiziellen Angebote von VON POLL IMMOBILIEN.

Die Website ist statisch. Lokal starten:

```sh
python3 -m http.server 8765 --directory dist
```

Dann http://localhost:8765 öffnen. Die Demo-Datei `dist/wohnungsdatenbank.html` kann direkt und ohne Netzwerk geöffnet werden. Sie benötigt keine Installation. Die Beispielanzeigen liegen in `dist/listings.js`; nach Änderungen mit `python3 build-demo.py` auch die Offline-Datei aktualisieren.
