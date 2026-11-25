# Wohnungsdatenbank · Mietwohnungen in Köln

Die statischen Seiten und Bilder liegen in `dist/`. Ohne Worker lassen sich
die Startseite und das ursprüngliche Exposé lokal öffnen:

```sh
python3 -m http.server 8765 --directory dist
```

Dann http://localhost:8765 öffnen.

Für einen Sites-Build `node scripts/build.mjs` ausführen. Der Build erzeugt
`dist/server/index.js`. Sites verbindet die in `.openai/hosting.json`
deklarierten D1- und R2-Bindings und wendet die SQL-Migration in `drizzle/` an.

Die Verwaltung liegt unter `/admin`. Die Laufzeitvariable `ADMIN_EMAIL` muss
die E-Mail-Adresse des berechtigten ChatGPT-Kontos enthalten. Ohne diese
Variable ist die Verwaltung gesperrt. Dort lassen sich Objekte erstellen,
bearbeiten und deaktivieren. Unter **Besichtigungstermine** lässt sich pro
Objekt die automatische Terminvergabe durch eine eigene Liste von Datum und
Uhrzeit (Ortszeit Köln) ersetzen. Eine leere eigene Liste pausiert neue Buchungen.
Die Verwaltung zeigt außerdem die für die Web-App registrierten Konten mit
Telefonnummern an, sofern diese bei der Registrierung erfasst wurden.
Objekte und Buchungen werden in D1 gespeichert,
optionale Titelbilder in R2.

Unter `/webview` können sich Besucher mit E-Mail-Adresse, Passwort und
Telefonnummer registrieren, aktive Objekte ansehen und eigene Besichtigungen
im Kalender buchen. Automatische Termine sind 3 bis 30 Kalendertage im
Voraus buchbar, stündlich von 10 bis 17 Uhr. Eigene Termine können
ab dem dritten Kalendertag auch weiter im Voraus liegen. Das bisherige
Exposé für die Südstadt wird als Testobjekt angelegt und kann in der Verwaltung
deaktiviert werden. Die Web-App benötigt den Worker und die D1-Migrationen.
