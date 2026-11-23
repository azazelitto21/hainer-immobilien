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
Variable ist die Verwaltung gesperrt. Neue Objekte werden in D1 gespeichert,
optionale Titelbilder in R2. Veröffentlicht werden nur Objekte aus der Verwaltung.

Sobald der App-Download bereitsteht, die Schaltflächen in den HTML-Vorlagen
und im Dialog in `worker/index.mjs` mit der Downloadadresse verbinden.
