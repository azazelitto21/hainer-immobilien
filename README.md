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
bearbeiten und deaktivieren. Die Verwaltung zeigt außerdem die für die Web-App
registrierten Konten an. Objekte und Buchungen werden in D1 gespeichert,
optionale Titelbilder in R2.

Unter `/webview` können sich Besucher mit E-Mail-Adresse und Passwort
registrieren, aktive Objekte ansehen und eigene Besichtigungen buchen. Der
Termin liegt drei Kalendertage nach dem aktuellen Datum in Köln. Das bisherige
Exposé für die Südstadt erscheint nach der Aktivierung durch die Verwaltung in
der Web-App. Die Web-App benötigt den Worker und die D1-Migrationen.
