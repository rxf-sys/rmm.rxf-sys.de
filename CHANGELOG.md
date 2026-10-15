# Changelog

Alle nennenswerten Änderungen an diesem Projekt werden hier festgehalten.

Das Format orientiert sich an [Keep a Changelog](https://keepachangelog.com/de/1.1.0/);
die Versionierung folgt [Semantic Versioning](https://semver.org/lang/de/).

## [Unreleased]

### Behoben
- **Menüs und Aufklapp-Fenster ließen sich mit der Tastatur schlecht
  bedienen.** Beim ersten Öffnen eines Menüs („Weitere Aktionen", „Aktionen"
  der Auswahl, Zeilenmenüs) blieb der Fokus auf dem Knopf, Pfeiltasten und
  Escape taten nichts. Und Tab aus einem offenen Menü sprang an den Anfang
  der Seite statt zum nächsten Element; ebenso aus den Benachrichtigungen,
  dem Benutzermenü und den gespeicherten Ansichten. Jetzt landet der Fokus
  beim Öffnen immer im Menü oder Fenster, Tab führt zum Element nach dem
  Knopf und Umschalt+Tab zurück auf den Knopf. Sperrt oder entfernt sich ein
  Knopf darin selbst, etwa „Speichern" einer Ansicht, holt Tab den Fokus ins
  offene Fenster zurück.
- **Ein ungewöhnliches Inventar legte die Geräteseite lahm.** Meldete ein
  Agent ein Feld in unerwarteter Form (etwa die Softwareliste als Objekt,
  ein Paket ohne Namen oder den Firewall-Status als Objekt), brach die
  Geräteseite für alle mit einem Fehler ab. Die Seite prüft das Inventar
  jetzt Feld für Feld und zeigt, was sich lesen lässt; der Rest gilt als
  nicht gemeldet.
- **„Ausgabe" öffnete den Auftrag nicht, wenn „Aktivität" schon offen war.**
  Ein Klick auf „Ausgabe" im Toast oder in der Benachrichtigungszentrale
  führte zwar auf den Reiter, klappte den Auftrag aber nicht auf und rollte
  nicht zu ihm, sobald der Reiter bereits zu sehen war. Jetzt öffnet jeder
  Link seinen Auftrag; ein Filter, der ihn verbergen würde, wird aufgehoben.
- **Gelöschte Geräte blieben auf ihrer Seite stehen.** Wurde ein Gerät
  gelöscht (auch von einem anderen Admin) oder einem Betrachter entzogen,
  zeigte seine geöffnete Seite es weiter als „online" mit allen Aktionen, die
  nur noch „nicht gefunden" meldeten; nach dem Entfernen holte „Zurück" es aus
  dem Zwischenspeicher wieder hervor. Antwortet der Server mit „nicht
  gefunden", sagt die Seite das jetzt, und ein entferntes Gerät wird sofort
  vergessen.
- **Offene Dialoge überlebten die Abmeldung.** War „Gerät hinzufügen", die
  Suche, die Kürzel-Liste oder das Navigationsblatt offen, als die Sitzung
  ablief oder jemand sich abmeldete, stand es nach der nächsten Anmeldung im
  selben Tab wieder offen — „Gerät hinzufügen" auch für einen Betrachter, dem
  der Server das Erstellen eines Tokens verweigert. Das Navigationsblatt
  sprang sogar nach jedem „Abmelden" daraus wieder auf. Eine neue Sitzung
  beginnt jetzt ohne offene Dialoge, und „Gerät hinzufügen" erscheint nur für
  Rollen, die Geräte aufnehmen dürfen. Ein Sprung aus der Suche direkt in
  einen Geräte-Reiter („Updates — nas") schließt nun auch das
  Navigationsblatt, statt es über der neuen Seite stehen zu lassen.
- **Tastaturkürzel führten auf „Kein Zugriff".** „g s" (Skripte) und „g l"
  (Audit-Log) standen jeder Rolle in der Kürzel-Liste und funktionierten auch
  dort, wo die Seite gesperrt ist. Die Kürzel folgen jetzt der Navigation:
  jede Rolle bekommt nur die Seiten, die sie öffnen darf.
- **Konten und Personen waren je Seite doppelt zwischengespeichert.**
  Administration und Personen hielten die Kontenliste getrennt, die
  Personen-Auswahl im Gerätedialog und bei „Mobilgerät erfassen" eine eigene
  Personenliste. Wer kurz nach einer Änderung die andere Seite öffnete, sah
  den alten Stand: eine geänderte Rolle fehlte, die Löschbestätigung einer
  Person versprach das Falsche über ihr Konto, ein mit der Person gelöschtes
  Konto stand noch in der Administration (und lieferte „Konto nicht
  gefunden"), eine gelöschte Person ließ sich noch zuweisen. Jede Liste liegt
  jetzt einmal vor, eine Änderung erscheint sofort überall.
- **Ein gescheiterter erster Abruf sah aus wie eine leere Flotte.** Kam die
  Geräteliste beim Start nicht an (Server weg, 500, unerwartete Antwort),
  zeigten Geräteliste und Übersicht „Noch keine Geräte" mit „Gerät
  hinzufügen" — unter einem Streifen, der gleichzeitig sagte, dass gar nichts
  geladen werden konnte. Beide Seiten zeigen jetzt den Fehler mit „Erneut
  versuchen"; die Übersicht urteilt dann auch nicht mehr „Noch kein Gerät
  angebunden" und nennt die Update-Zahlen „nicht geladen", solange der
  Update-Stand fehlt.
- **Ein Aussetzer machte die Flotte „aktuell" und die Personen leer.**
  Schlug ein Abruf des Update-Stands fehl (Neustart beim Deploy, kurzer
  Netzausfall, 5xx), galt das als leere Antwort: die Patch-Seite meldete
  „Sicherheitsupdates 0 – nichts offen" und „100 %", das Abzeichen in der
  Seitenleiste fiel auf 0, und die Personen-Seite zeigte „Noch keine
  Personen" samt „Person anlegen". Ein Fehler bleibt jetzt ein Fehler: der
  letzte gute Stand bleibt stehen, der Abruf wird wiederholt, und kam noch
  nie etwas an, sagen beide Seiten, dass das Laden fehlgeschlagen ist.
- **Auftragsergebnisse überlebten die Abmeldung.** Lief beim Abmelden noch
  eine Abfrage für eine Massenaktion, landeten ihre Ergebnisse danach in der
  Benachrichtigungszentrale — beim nächsten Konto im selben Tab, auch bei
  einem Betrachter. Ergebnisse einer beendeten Sitzung werden jetzt
  verworfen.
- **Alarm-Center zeigte höchstens 50 Alarme.** Die Liste kam ohne Limit und
  der Server schnitt bei 50 Zeilen ab — vor dem Filter auf die Geräte eines
  Betrachters. Ab 50 offenen Alarmen fehlten die ältesten im Reiter „Offen"
  und ließen sich nicht quittieren, ein Betrachter sah seinen Alarm unter
  Umständen gar nicht, und „Behoben" wählte nach Auslösezeit statt nach
  Behebung aus. Jetzt kommen alle offenen und quittierten Alarme, der Filter
  greift in der Datenbankabfrage, und von den behobenen die 200 zuletzt
  behobenen; sind es mehr, sagt der Reiter das.
- **Lange Suche im Audit-Log ließ die Seite abstürzen.** Eine Suche über
  200 Zeichen beantwortet der Server mit einer Prüfliste statt eines Satzes;
  die Oberfläche versuchte, diese Liste als Text darzustellen, und die Seite
  brach ab — auch nach jedem Neuladen, weil die Suche in der Adresse stand.
  Das Suchfeld nimmt jetzt höchstens 200 Zeichen an, eine längere Suche aus
  einem Link wird gekürzt, und abgelehnte Eingaben erscheinen überall als
  Satz wie „Ungültige Eingabe: Passwort ist zu kurz (mindestens 8 Zeichen).“
- **Audit-Log: Suchfeld folgte der Adresse nicht.** Wer das Audit-Log über
  die Navigation oder „g l“ erneut öffnete oder mit „Zurück“ zu einer
  früheren Suche ging, sah im Feld und in der Liste weiter die alte Suche,
  während die Adresse etwas anderes sagte. Feld und Liste übernehmen jetzt
  die Suche der Adresse.
- **Tastaturfokus fiel an den Seitenanfang.** „Filter zurücksetzen“ im
  Audit-Log entfernte sich beim Drücken selbst, ebenso die Zeile eines
  gelöschten Kontos samt ihrem Menüknopf; der Fokus landete danach im
  Nichts. Er geht jetzt ins Suchfeld des Audit-Logs bzw. auf das Aktionsmenü
  der nachrückenden Kontozeile.
- **Administration: kurzer Serverausfall leerte Konten- und
  Sitzungsliste.** Schlug eine Aktualisierung im Hintergrund fehl (etwa
  während eines Deployments), ersetzte die Fehlermeldung die schon geladene
  Liste samt ihren Aktionen. Die Liste bleibt jetzt stehen, die Meldung
  steht darüber.
- **Passwortlänge mit Emoji falsch gezählt.** Die Administration zählte
  ein Emoji als zwei Zeichen und bot deshalb zu kurze Passwörter zum
  Speichern an, die der Server ablehnte — die Ablehnung ließ die Seite
  abstürzen. Gezählt wird jetzt wie auf dem Server.
- **Zwei-Faktor-Bereich zeigte Veraltetes.** Wer direkt nach dem
  Einrichten wieder abschaltete, bekam die gelöschten Backup-Codes weiter
  zum Kopieren angeboten; wer die eigene Zwei-Faktor-Anmeldung über die
  Kontenliste zurücksetzte, behielt ein offenes Abschalt-Formular, das nur
  noch „2FA ist nicht aktiv“ meldete. Beides verschwindet jetzt mit dem
  zweiten Faktor.
- **Sitzung abmelden meldete Erfolg und Fehler zugleich.** Ein Doppelklick
  auf „Abmelden“ schickte zwei Anfragen; die zweite fand die Sitzung nicht
  mehr und meldete „Sitzung nicht abgemeldet“. Der Knopf nimmt während der
  Anfrage keinen zweiten Klick an („Meldet ab …“), und eine schon beendete
  Sitzung gilt nicht mehr als Fehler.
- **E-Mail-Adressen mit Umlaut abgelehnt.** „Konto anlegen“ und „E-Mail
  ändern“ ließen den Browser Adressen wie „jürgen@firma.de“ zurückweisen,
  die der Server problemlos speichert. Die Felder prüft jetzt nur noch der
  Server.
- **Betrachter-Konten aus der Administration sahen nichts.** Ein
  Betrachter sieht nur die Geräte seiner Person, doch „Konto anlegen“ bot
  keine Person an (und schlug ausgerechnet „Betrachter“ vor), und ein
  herabgestuftes Konto ließ sich nirgends verknüpfen — es meldete sich an
  einem leeren Dashboard an. „Konto anlegen“ verlangt für Betrachter jetzt
  eine Person, das Menü jeder Betrachter-Zeile bietet „Person zuordnen …“
  bzw. „Person ändern …“, und wer ein Konto ohne Person zum Betrachter
  macht, wird vorher gefragt. Die Kontenliste nennt die Person unter der
  Rolle und markiert Betrachter ohne Person. Die Verknüpfung landet im
  Audit-Log; `POST /api/accounts` nimmt dafür `person_id` an.
- **RustDesk-ID ließ sich nicht korrigieren.** Das Eingabefeld erschien nur,
  solange gar keine ID hinterlegt war. Der Reiter „Fernzugriff" bietet jetzt
  „ID ändern" an; eine ungültige hinterlegte ID (etwa eine alte Eingabe mit
  Leerzeichen) wird benannt und vorbefüllt zum Neu-Speichern angeboten, statt
  einen Sitzungs-Knopf zu zeigen, der nur einen Fehler bringt.
- **Breite Dialoge liefen über schmale Bildschirme hinaus.** Der Dialog
  „Gerät hinzufügen" und die Skript-Vorlagen ragten auf Telefonen und
  Tablets unter 880 px rechts aus dem Bild, das Schließen-Kreuz war nicht
  erreichbar.
- **Endlos-Abruf nach dem Login.** Jeder angemeldete Tab rief
  `/api/devices`, `/api/alerts`, `/api/patches/summary` und `/api/persons`
  ununterbrochen ab — gemessen 569-mal je Endpunkt in zehn Sekunden
  Leerlauf. `useFleet` gab bei jedem Render eine neue `refresh`-Funktion
  zurück, und der Login-Effekt in `App.tsx` hing genau davon ab. Die
  Funktion ist jetzt stabil; Abrufe laufen einzeln, ein Auftrag während eines
  laufenden Abrufs wird zu genau einem Folgeabruf zusammengefasst,
  WebSocket-Hinweise lösen höchstens alle zwei Sekunden einen Abruf aus, und
  im versteckten Tab ruht das Polling.
- **Alarm-Sturm erzeugte Abruf-Sturm.** Jeder ausgelöste Alarm schickte einen
  eigenen Fleet-Hinweis. Fallen viele Geräte gleichzeitig aus, bündelt der
  Server die Hinweise jetzt in ein Fenster von 0,5 s.
- **Ein erzeugtes Enrollment-Token ging verloren.** Wer nach „Token
  erzeugen" zum Telefon-Formular wechselte oder den Dialog schloss, bevor der
  Server antwortete, bekam den Installationsbefehl nie zu sehen, und die
  Liste der offenen Tokens zeigte das neue Token erst nach dem nächsten
  Abruf. Das Token erscheint jetzt auch nach dem Zurückwechseln, die Liste
  wird in jedem Fall neu geladen, und ein zweiter Klick während der laufenden
  Anfrage erzeugt kein zweites Token mehr.
- Wurde das eben erzeugte Token unter „Offene Tokens" widerrufen, blieb sein
  Installationsbefehl samt „Gültig bis …" stehen, als wäre er noch nutzbar —
  ausgeführt endete er mit „Enrollment-Token ungültig oder abgelaufen". Der
  Dialog kehrt jetzt zum Formular für ein neues Token zurück.
- Im Formular für Telefone und Tablets endete eine zu lange Angabe (etwa eine
  IMEI über 40 Zeichen oder eine Notiz über 2000) in „Unbekannter Fehler",
  ohne Hinweis auf das Feld. Die Felder hören jetzt dort auf, wo der Server
  ablehnt, und eine abgelehnte Angabe wird mit Feldnamen und Höchstlänge
  genannt.
- Lehnte der Server im zweiten Schritt der Anmeldung das Passwort ab — etwa
  weil es zwischen den Schritten neu gesetzt oder das Konto deaktiviert
  wurde —, meldete die Seite „Der Code stimmt nicht", und jeder weitere Code
  zählte bis zur Sperre als Fehlversuch. Sie führt jetzt zurück zu
  Benutzername und Passwort und sagt, dass diese nicht mehr angenommen
  werden.
- **Dokumentation: kaputter Link legte die Seite lahm.** Ein von Hand
  verändertes oder abgeschnittenes Sprungziel wie `/doku#100%` ersetzte die
  ganze Seite durch die Fehleransicht. Ein unbekanntes Ziel wird jetzt
  einfach ignoriert.
- **Dokumentation: Token-Gültigkeit stimmte nicht mehr.** Dort stand fest
  „24 h gültig", und bei HTTP 403 hieß es, das Token sei „älter als 24 h".
  Seit „Gerät hinzufügen" 1 Stunde bis 14 Tage anbietet, führte das bei
  einem abgelaufenen Ein-Stunden-Token auf die falsche Ursache. Die Doku
  nennt jetzt die beim Erzeugen gewählte Dauer, den Standard
  `ENROLLMENT_TOKEN_TTL_HOURS` und widerrufene Tokens als weitere Ursache.
- Schlug die Abfrage der RustDesk-Konfiguration fehl, forderte der
  RustDesk-Abschnitt der Dokumentation dazu auf, `RUSTDESK_RELAY_HOST` und
  `RUSTDESK_KEY` zu setzen — auch auf einem korrekt eingerichteten Server.
  Er sagt jetzt, dass der Stand nicht abrufbar war.
- Die Kopieren-Knöpfe der Dokumentation hießen für Screenreader alle nur
  „Kopieren". Ihr Name nennt jetzt auch den Befehl, etwa „Kopieren:
  PowerShell als Administrator".
- Personen: Ein Statussymbol in der Liste stand auch bei Personen, deren
  Geräte nur offline sind — der Filter „Mit Befund" blendete genau diese
  aber aus. Symbol und Filter folgen jetzt derselben Regel; wie viele Geräte
  online sind, steht weiterhin in der Zeile.
- Personen: Die Löschbestätigung behauptete „Ein verknüpftes
  Betrachter-Konto wird mitgelöscht", solange die Kontenliste nicht geladen
  war — auch wenn es gar kein oder ein Techniker-Konto gab. Sie sagt dann
  jetzt, was geschehen würde, und nennt sonst jedes verknüpfte Konto statt
  nur des ersten.
- Personen: Der Telefon-Link wählte bei üblichen Schreibweisen falsch.
  „+49 (0)711 123456" behielt die Null nach der Ländervorwahl, zwei Nummern
  im Feld wurden zu einer verschmolzen, und Text ohne Ziffern („nur abends")
  wurde zu einem leeren Link. Jetzt wird nur die erste Nummer verlinkt und
  richtig gewählt; Text ohne Nummer bleibt Text.
- Personen: Wer eine Person bearbeitete, deren gespeicherte E-Mail keine
  einzelne Adresse ist (etwa „mama@…, papa@…" oder eine Notiz aus der Zeit
  vor der Neugestaltung), konnte nicht mehr speichern — auch wenn nur die
  Telefonnummer geändert wurde. Das Feld nimmt wieder jeden Text, wie der
  Server. Der Mail-Link kodiert die Adresse jetzt (`?`, `#`, `%`, `&`) und
  erscheint nur noch, wenn im Feld Adressen stehen.
- Personen: Das einmalig angezeigte Passwort eines neuen Betrachter-Kontos
  verschwand ohne Rückfrage mit Escape, einem Klick neben den Dialog oder
  einem zweiten Enter nach dem Anlegen. Solange es nicht kopiert ist, fragt
  der Dialog jetzt nach, und der Fokus steht auf „Kopieren" statt auf
  „Fertig".
- Personen: Wer ein Gerät zuwies oder löste und kurz danach auf der
  Geräteseite „Bearbeiten" speicherte, machte die Zuweisung unbemerkt
  rückgängig — die Geräteseite hielt noch den alten Stand. Sie bekommt die
  Änderung jetzt sofort mit.
- Personen auf schmalen Bildschirmen: „Alle Personen" legte einen neuen
  Verlaufseintrag an, sodass die Zurück-Geste des Telefons die eben
  verlassene Person wieder öffnete statt die Seite zu verlassen. Der Knopf
  geht jetzt im Verlauf zurück. Danach — und nach dem Löschen einer Person —
  steht der Tastaturfokus auf der verlassenen Person in der Liste bzw. auf
  der Suche, statt auf den Seitenanfang zu fallen.
- **Personenfilter fiel unbemerkt weg.** Im Alarm-Center, unter „Patches"
  und in der Geräteliste galt `?person=` nur, solange die Personenliste
  geladen war. Kam sie verspätet oder schlug ein Abruf fehl, zeigten die
  Seiten stillschweigend alle Personen — „Alle quittieren" quittierte dann
  die Alarme der ganzen Flotte, „Geräte prüfen" prüfte alle Geräte, und eine
  Massenaktion auf „Alle Geräte dieser Seite" traf fremde Geräte. Der Filter
  hält sich jetzt an die ID aus der Adresse und nennt die Person bis dahin
  „Person 4".
- **Updates-Reiter zeigte nach einer Sammel-Installation alten Stand.** Wer
  unter „Patches" eine Installation startete und gleich das Gerät öffnete,
  bekam aus dem Zwischenspeicher noch „Installieren" angeboten — ein Klick
  endete mit „Es läuft bereits eine Installation". Prüfung und Installation
  markieren jetzt Updates und Aufträge der betroffenen Geräte als veraltet.
- **Quittieren lud die Alarme doppelt.** Nach jeder Quittierung holte das
  Alarm-Center die Alarmliste und gleich danach die ganze Flotte samt
  Alarmen noch einmal. Jetzt kommt nur die Alarmliste neu; dafür zeigt die
  Aktivität des Geräts das „quittiert von …" sofort statt erst nach einer
  Viertelminute.
- **Fokus sprang Minuten später zu einem Alarm.** Schlug beim Quittieren
  einer von mehreren Alarmen fehl, blieb die Fokus-Übergabe an die nächste
  Zeile scharf. Ging der Fokus danach aus anderem Grund verloren, zog die
  nächste Aktualisierung ihn samt Scrollposition zu einem
  „Quittieren"-Knopf. Die Übergabe endet jetzt mit der Runde.
- **„Alle quittieren" quittierte Quittiertes noch einmal.** Alarme, die ein
  Kollege quittierte, während der Dialog offen stand, und einer, dessen
  eigenes „Quittieren" noch lief, wurden erneut gesendet; der Server trug
  dann eine zweite Quittierung unter falschem Namen ins Audit-Log ein. Das
  Alarm-Center sendet jetzt nur, was beim Bestätigen noch offen ist, und
  sagt im Toast, was schon quittiert oder behoben war. Der Server
  protokolliert nur noch die Quittierung, die tatsächlich gegriffen hat.
- **„Alle Treffer auswählen" verwarf ausgeblendete Auswahl.** Unter
  „Patches" zählte das Angebot auch ausgewählte Geräte, die der Filter
  gerade ausblendet, und fehlte deshalb, obwohl Treffer unausgewählt waren.
  Ein Klick ersetzte die Auswahl, statt sie zu ergänzen — die eben noch als
  „davon ausgeblendet" gemeldeten Geräte fielen still heraus.
- **Tastaturfokus ging unter „Patches" verloren.** „Geräte prüfen", „Jetzt
  prüfen", „Sicherheitsupdates installieren" und der Prüfknopf einer Zeile
  wurden während der Arbeit gesperrt und warfen den Fokus dabei an den
  Seitenanfang. Sie behalten ihn jetzt und nehmen nur keinen zweiten Klick
  an. Nach „Alle Treffer auswählen" landet der Fokus in der Aktionsleiste,
  nach „Filter zurücksetzen" im Suchfeld. Warum ein Gerät ohne Verbindung
  nicht geprüft werden kann, erfährt jetzt auch, wer per Tastatur oder
  Screenreader unterwegs ist.
- **Knapp neben das Kästchen geklickt, Auswahl weg.** In der Geräteliste und
  unter „Patches" öffnete ein Klick neben das Auswahlkästchen einer Zeile das
  Gerät, auf dem Telefon schon jeder Tipp auf die Karte außerhalb des
  Kästchens — und die Auswahl, womöglich Dutzende Geräte über mehrere Filter,
  war verloren. Jetzt wählt die ganze Kästchen-Spalte der Tabelle aus, auf
  der Karte der Streifen am linken Rand; Umschalt+Klick wählt auch dort
  einen Bereich.
- **Suche in der Geräteliste und unter „Patches" blieb nach der Navigation
  stehen.** Wer die Seite über die Leiste, „g d" oder „g p" erneut öffnete,
  bekam alle Filter zurückgesetzt, nur die Suche nicht: Sie stand weiter im
  Feld und filterte die Liste, obwohl die Adresse sie nicht mehr enthielt.
  Ebenso brachte „Zurück" die frühere Suche nicht zurück. Das Suchfeld folgt
  jetzt der Adresse, wie schon im Audit-Log.

### Hinzugefügt
- **Geräteliste mit Massenaktionen, Ansichten und Export.** Die Liste ist
  eine echte Tabelle mit sortierbaren Spalten (Status, Auslastung, Updates,
  Agent-Version, zuletzt gesehen; Geräte mit Befund stehen standardmäßig
  oben) und mitlaufendem Kopf. Admins und Techniker wählen Geräte per
  Kästchen aus — mit Umschalt auch einen Bereich, über den Kopf eine ganze
  Seite oder alle Treffer — und starten für die Auswahl ein Skript aus der
  Bibliothek, einen Neustart mit einer Minute Vorwarnung für angemeldete
  Benutzer, ein Wartungsfenster, ein Agent-Update oder ändern einen Tag.
  Jede Aktion läuft über den Endpunkt des einzelnen Geräts und landet damit
  pro Gerät im Audit-Log; der Dialog nennt vorab, welche Geräte übersprungen
  werden (ohne Agent, ohne Verbindung, anderes Betriebssystem). Gestarteten
  Aufträgen folgt ein einziger Toast mit Fortschritt statt einer Meldung je
  Gerät. Filter, Person, Suche und Sortierung stehen in der Adresse und
  lassen sich als benannte Ansicht im Browser speichern. „CSV exportieren"
  liefert die gefilterte Liste oder die Auswahl als Semikolon-CSV für eine
  deutsche Tabellenkalkulation; Zellen, die eine Tabellenkalkulation als
  Formel ausführen würde, werden entschärft. Unter 1000 px Breite wird die
  Tabelle zu Karten.
- **Gerätedetail neu aufgebaut.** Kopfbereich mit Status, System, letzter
  Meldung und Tags; die wichtigste Aktion (Fernsteuerung oder Aufwecken) ist
  der Hauptknopf, Terminal und „Neu starten" (mit einer Minute Vorwarnung)
  daneben, alles Weitere im Menü — auf dem Telefon oben neben „Geräte". Die
  Übersicht zeigt Auslastung mit Schwellenmarken, „Auf einen Blick",
  Stammdaten, Sicherheit und Netzwerk; der Verlauf nutzt das neue Diagramm
  mit Fadenkreuz per Maus, Finger und Pfeiltasten. Die Seite läuft bei 390 px
  ohne seitliches Scrollen. „Entfernen" verlangt jetzt, den Gerätenamen
  einzutippen — das Löschen lässt sich nicht rückgängig machen.
- **Aktivität als Zeitleiste.** Aufträge, ausgelöste und behobene Alarme und
  — für Admins — Änderungen aus dem Audit-Log stehen nach Tagen gruppiert in
  einer Liste; die Ausgabe eines Auftrags klappt direkt darunter auf. Links
  aus Toasts und der Benachrichtigungszentrale (`?tab=jobs&job=…`) öffnen den
  Auftrag gleich.
- **Software installieren mit einem Klick.** Der Reiter „Fernzugriff" bietet
  einen Katalog gängiger Programme (Browser, LibreOffice, 7-Zip, Git,
  RustDesk, WireGuard …), passend zum System über winget, apt/dnf oder
  Homebrew. winget wird für das SYSTEM-Konto aus dem App-Installer-Ordner
  aufgelöst, Homebrew läuft als angemeldeter Benutzer. Jede Installation ist
  ein normaler, im Audit-Log erfasster Auftrag; die Paketkennungen sind
  Konstanten, die ein Test auf harmlose Zeichen prüft. Dasselbe gibt es als
  Massenaktion in der Geräteliste: jedes Gerät bekommt den Befehl seines
  Systems, Geräte ohne passendes Paket werden vorab genannt.
- **Skript-Bibliothek als Liste und Detail.** Links die Skripte mit Suche
  (auch im Quelltext), System- und Kategoriefilter und Favoriten, rechts das
  gewählte Skript mit Quelltext samt Zeilennummern und „Ausführen auf …" —
  die Ausgabe läuft direkt darunter mit, statt auf die Geräteseite zu
  springen. Angeboten werden nur verbundene Geräte mit passendem System.
  Bearbeiten und Neuanlage im selben Bereich, Vorlagen als Galerie mit
  Systemfilter. Die Auswahl steht in der Adresse (`?script=`); auf schmalen
  Bildschirmen wechseln Liste und Detail.
- **Automatisierung aufgeräumt.** Patch-Fenster weiter als Satz mit
  Auswahlfeldern, dazu klarer Status; Alarmregeln und geplante Skripte mit
  Schalter und Menü je Zeile, Bearbeiten in Dialogen statt Inline-Formularen,
  die Regel-Erklärung als aufklappbarer Hinweis.
- **Alarm-Center neu aufgebaut.** Reiter Offen / Quittiert / Behoben mit
  Zahlen und Filter nach Person, beides in der Adresse. Offene Alarme stehen
  nach Dringlichkeit: erst Plattenalarme kritischer Geräte, dann was schon
  lange anhält, dann die neuesten. Jeder offene Alarm lässt sich einzeln
  quittieren — jetzt auch auf dem Telefon —, „Alle quittieren" nennt vorher
  die betroffenen Alarme und schickt je Alarm eine eigene Anfrage. Jede
  Zeile verlinkt das Gerät und nennt die auslösende Regel.
- **Updates-Seite neu aufgebaut.** Kennzahlen (Geräte mit offenen Updates,
  Sicherheitsupdates, nicht geprüfte Geräte), Stand je System als Balken,
  Filter für Zustand, System, Verbindung, Person und Suche in der Adresse
  und eine sortierbare Tabelle, die auf schmalen Bildschirmen zu Karten
  wird. Admins und Techniker wählen Geräte aus und starten „Jetzt prüfen"
  oder „Sicherheitsupdates installieren" für die Auswahl; die Bestätigung
  nennt jedes Zielgerät und die übersprungenen.
- **Audit-Log neu aufgebaut.** Eine Werkzeugleiste mit Suche, Akteur,
  Kategorie, „Nur Sicherheit" und Zeitraum (24 h / 7 Tage / 30 Tage /
  alles), alles in der Adresse. Einträge nach Tagen gruppiert mit Uhrzeit,
  Akteur, Satz und Link zum Gerät; jeder Eintrag klappt zu allen
  Detailfeldern auf. „CSV exportieren" liefert die aktuelle Seite mit
  demselben Schutz gegen Tabellen-Formeln wie der Geräte-Export.
- **Administration neu aufgebaut.** Konten als sortierbare Tabelle (auf dem
  Telefon als Karten) mit benannten Rollen-Auswahlfeldern, Aktionen im Menü
  und Bestätigungen, die das Konto nennen; Löschen verlangt die Eingabe des
  Namens. Das eigene Konto lässt sich nicht herabstufen, deaktivieren oder
  löschen, und die Seite sagt warum. Zwei-Faktor, eigene Sitzungen und die
  ntfy-Einstellungen sind eigene Bereiche.
- **Personen als Liste und Detail.** Links die durchsuchbare Liste mit
  Filtern („Mit Befund", „Ohne Gerät"), rechts die gewählte Person mit
  Zustand ihrer Geräte, offenen Alarmen, Updates, Kontakt als
  Mail-/Telefon-Link, Konto und Aktivität. Anlegen und Bearbeiten im Dialog;
  Löschen nennt vorher die Geräte, die ohne Person zurückbleiben, und was mit
  dem Konto geschieht. Geräte lassen sich direkt zuweisen und lösen.
- **Anmeldung neu gestaltet.** Markenspalte und Formular in beiden Themes;
  verständliche Meldungen für falsche Zugangsdaten, falschen Code, zu viele
  Versuche und einen nicht erreichbaren Server; beim zweiten Faktor lässt
  sich auf einen Backup-Code umschalten; Hinweis bei aktivierter
  Feststelltaste.
- **„Gerät hinzufügen" als ein Dialog mit zwei Wegen.** Rechner mit Agent
  (Einmal-Token, Installationsbefehl je Betriebssystem mit Kopieren-Knopf,
  offene Tokens mit Widerrufen) oder Telefon/Tablet ohne Agent. Auf dem
  Telefon steht der Eintrag jetzt auch im Menü „Mehr".
- **Dokumentation neu gesetzt.** Mitlaufendes Inhaltsverzeichnis auf breiten
  Bildschirmen, aufklappbares „Inhalt" auf dem Telefon, Befehle als
  Konsolenblöcke mit Kopieren-Knopf, Hinweise als ruhige Kästen. Veraltete
  Bezeichnungen (Remote-Panel, Badge-Symbole) entsprechen wieder der
  Oberfläche.
- **Befehlspalette neu (Strg K / ⌘ K).** Treffer nach Güte sortiert (exakt,
  Wortanfang, enthalten) über Hostname, Tags, Besitzer und System, gruppiert
  in Aktionen, Seiten und Geräte; ohne Eingabe die zuletzt geöffneten
  Geräte. Für das beste Gerät gibt es Direktsprünge zu Terminal, Updates und
  Aktivität. Voll per Tastatur bedienbar und für Screenreader als Combobox
  ausgezeichnet.
- **„Offen" bedeutet überall dasselbe.** Seitenleiste, Navigationsleiste,
  Glocke, Übersicht und Alarm-Center zählen als offen nur Alarme, die noch
  niemand quittiert hat; quittierte stehen jeweils daneben. Vorher zeigte
  die Seitenleiste eine andere Zahl als die Glocke und der Reiter „Offen".
- **Vorbereitung für MDM (iOS/iPadOS).** `infrastructure/docker-compose.yml`
  kennt jetzt einen NanoMDM-Container, der am Compose-Profil `mdm` hängt und
  im Normalbetrieb nicht startet — ohne APNs-Push-Zertifikat gäbe es nichts
  zu starten. Caddy leitet `/mdm` und `/checkin` dorthin weiter und
  beantwortet `/v1/*` und `/migration` mit 404: die Verwaltungs-API
  kommandiert jedes eingebuchte Gerät und gehört nicht durch den Tunnel.
  `docs/MDM-SETUP.md` führt durch das Push-Zertifikat (mdmcert.download →
  Apple), die Dateiablage, den ersten Start und die Verlängerung nach einem
  Jahr; `docs/OPERATIONS.md` nennt die drei Prüfungen für den laufenden
  Betrieb, und `infrastructure/mdm/` ist gitignored.
- **Telefone und Tablets in der Flotte.** Ein Gerät kann jetzt ohne Agent
  geführt werden: „Gerät hinzufügen" hat einen zweiten Weg für Telefon oder
  Tablet, mit Modell, OS-Version, Seriennummer, IMEI, Notiz und
  Besitzverhältnis (privat/Firma). Es entsteht dabei kein Zugang — die Zeile
  ist eine Karteikarte, kein Enrollment. Die Geräteliste hat dafür den Filter
  „Ohne Agent" und zeigt in diesen Zeilen, was das Gerät ist und wann zuletzt
  jemand nachgesehen hat, statt fünf leerer Auslastungsbalken. Die
  Detailseite zeigt nur Reiter, hinter denen etwas liegt, und Übersicht,
  Updates, Skripte und Alarmregeln rechnen weiterhin nur mit Geräten mit
  Agent — sonst stünde jedes Telefon dauerhaft als „offline" in der Bilanz.
  Alles, was einen Agent voraussetzt (Befehle, Skripte, Update-Scan,
  Wake-on-LAN, Agent-Update, Agent-Protokolle), lehnt der Server für diese
  Geräte mit 409 ab; die Grenze steckt in `backend/app/device_policy.py` und
  nicht im Ausblenden der Knöpfe.
- Die Reiterleiste einer Geräteseite bricht bei wenig Platz um, statt seitlich
  zu scrollen: ein Scrollrand versteckt Reiter hinter einer Kante, die man erst
  finden muss. Auf schmalen Fenstern werden die Reiter zusätzlich etwas
  kompakter, damit seltener eine zweite Reihe entsteht.
- **Die Reiter einer Geräteseite** sind jetzt eine benannte Gruppe statt acht
  loser Schaltflächen: Tab springt einmal hinein, Pfeiltasten wechseln,
  Pos1/Ende gehen an die Ränder. Der Reiter „Updates" trägt die Zahl der
  offenen Updates (rot, sobald Sicherheitsupdates dabei sind), und der aktive
  Reiter steht in der URL — ein Neuladen landet wieder dort, und ein Link kann
  auf `/devices/7?tab=patches` zeigen.
- **Metrik-Verlauf überarbeitet:** beschriftete y-Achse, Werte aller drei
  Reihen beim Überfahren, fünf Zeitmarken statt zweier Ränder, und die x-Achse
  spannt sich über das gewählte Fenster statt über die vorhandenen Messpunkte
  (bei einem Gerät, das seit zehn Minuten meldet, sah das vorher aus wie ein
  Tagesverlauf). Pausen von mehr als zehn Minuten werden nicht mehr
  überzeichnet, und das SVG wird nicht mehr verzerrt, was die Linienstärken
  ungleich machte. Spitzenwerte stehen in der Kopfzeile; die Alarme des Geräts
  haben eine eigene Karte statt einer Fußzeile unter dem Diagramm.
- **Remote-Reiter neu geordnet:** drei benannte Bereiche (Fernsteuerung,
  Terminal, Skript ausführen) statt dreier lose gestapelter Blöcke. Das
  Terminal sperrt seine Eingabe bei getrenntem Gerät und begründet das, zeigt
  den Befehl über seiner Ausgabe und lässt sich leeren; zur Wahl stehen nur
  Shells, die es auf dem System gibt.
- **Gleicher Kartenkopf in allen Reitern** (Updates, Diagnose, Passwörter,
  Aktivität): Titel, erklärende Unterzeile, Bedienelemente rechts.
- **Alarm-Center neu:** eine Zeile je Alarm mit farbigem Streifen statt einer
  Karte je Alarm, die Dauer („seit 9 Std.") neben der Meldung, die auslösende
  Regel samt Geltungsbereich darunter, eine Filterleiste für offen / quittiert
  / behoben und „Alle quittieren". Behobene Alarme stehen als kompakte Liste
  mit der Angabe, wie lange sie offen waren.
- **Automatisierung liest sich als Satz.** Aus vier nebeneinanderstehenden
  Klappfeldern wird „Jeden Montag um 03:00 installiert Vulpexa nur
  Sicherheitsupdates auf Online-Geräten mit dem Tag server." — mit den
  Bedienelementen im Satz. Dazu „Läuft das nächste Mal am …" samt betroffener
  Geräte, und die Alarmregeln stehen ebenfalls als Satz da statt als
  „Gerät offline · 300 Sekunden".
- **Der tägliche Update-Scan hat eine Karte** auf der Automatisierungsseite:
  Slot, Zustand und wie viele Geräte seit dem letzten Slot geprüft sind.
  Eingestellt bleibt er in der Serverkonfiguration; die Seite zeigt ihn an.
- **Skript-Bibliothek:** zwei Zeilen je Skript statt einer Kette aus Chips,
  das Betriebssystem als feste Marke links, und „Ausführen" samt Zielgerät
  direkt in der Zeile — das Aufklappen ist jetzt für den Quelltext da.
  Der OS-Filter ist eine zweite Segmentleiste mit Trefferzahlen.
- **Patch-Management:** Filter als segmentierte Leisten mit Trefferzahlen
  (neu darin: „Nie geprüft") und eine Sammelaktion, die alle erreichbaren
  Geräte der aktuellen Auswahl scannt. Die Ringe bleiben, wie sie sind.
- **Ein Serverausfall ist jetzt sichtbar.** Bricht das Backend weg, liefen die
  Abfragen bisher stumm ins Leere und das Dashboard zeigte den letzten
  bekannten Stand weiter — eine ruhige Flotte, obwohl man in Wahrheit nichts
  sah. Ein Streifen über dem Inhalt datiert die Anzeige („Stand von vor 4
  Minuten") und bietet einen erneuten Versuch an, ohne die alten Zahlen
  wegzunehmen.
- **Die Seiten werden einzeln geladen.** Übersicht und Geräteliste bleiben im
  Hauptbündel, alles andere (Gerätedetail, Skripte, Doku, Administration,
  Automatisierung, Patches, Personen, Audit) kommt beim ersten Aufruf dazu:
  460 kB → 309 kB beim Login, 135 kB → 97 kB übertragen.
- **Filter „In Ordnung"** in der Geräteliste — das Gegenstück zu „Probleme",
  damit jede Zeile des Zustandsbalkens auf der Übersicht auch wirklich auf
  ihre Auswahl verlinkt.
- **Flottenlast-Diagramm überarbeitet:** Die y-Achse skaliert jetzt auf die
  tatsächlichen Werte (10/25/50/100 %) statt fest auf 0–100 — eine Flotte, die
  bei 5 bis 10 % dümpelt, war vorher eine gerade Linie am unteren Rand. Dazu
  beschriftete Gitterlinien, Zeitmarken alle sechs Stunden statt zweimal
  derselben Uhrzeit an beiden Rändern, und eine Fußzeile mit Mittelwert und
  Spitzenwert. Die x-Position kommt aus dem Zeitstempel statt aus dem Index:
  eine fehlende Stunde verschob vorher alles danach, jetzt bleibt sie eine
  Lücke und die Linie wird dort nicht durchgezogen.
- **Übersichtsseite neu gebaut.** Statt Kennzahlen, die anderswo schon stehen,
  beginnt die Seite mit einer Liste „Zu tun": volle Platten, offene
  Sicherheitsupdates, länger abwesende Geräte, überfällige Update-Scans,
  veraltete Agents — jeder Punkt mit einem Satz, warum er zählt, und einem
  Ziel, das ihn bearbeitet. Darunter vier Kennzahlen, die Flottenlast der
  letzten 24 Stunden als echte Kurve (neuer Endpunkt `GET /api/fleet/metrics`;
  vorher stand dort die aktuelle CPU je Gerät als Linie, was aussah wie ein
  Verlauf und keiner war), ein Zustandsbalken, dessen Zeilen auf die
  Geräteseite mit genau diesem Filter führen, und die letzte Aktivität. „Offene
  Alarme" steht nur noch einmal statt zweimal auf der Seite.
- Der Filter der Geräteseite steht jetzt in der URL (`/devices?filter=offline`)
  und ist damit verlinkbar und als Lesezeichen brauchbar.
- **Namen statt Nummern im Audit-Log und in den Aktivitäten.** Der Server
  schreibt Host- und Skriptname beim Ereignis mit, damit „nas-fritz entfernt"
  auch dann noch lesbar ist, wenn es das Gerät nicht mehr gibt; ältere
  Einträge löst das Dashboard aus der laufenden Liste auf. Außerdem hat jetzt
  jedes Ereignis einen eigenen Satz — vorher fiel ein Dutzend Typen
  (Wake-on-LAN, Passwörter, Personen, Automatisierung) auf den rohen
  Ereignisnamen zurück.
- **Geräteliste neu:** Statuspunkt, Hostname, OS-Chip und eine Unterzeile
  `OS · Tag · Tag` bilden einen Block; die eigene Tags-Spalte entfällt. CPU,
  RAM und Disk sind beschriftete Balken, deren Farbe auf die Last reagiert —
  grün, ab 70/75/80 % gelb, ab 90 % rot. Die Disk-Schwellen sind identisch mit
  denen des Statuspunkts, damit beide nie widersprüchlich aussehen.
- **Segmentierte Filterleiste** mit Trefferzahlen (`components/FilterBar.tsx`)
  statt einer Reihe loser Buttons: eine Tab-Station, Pfeiltasten wechseln, und
  jede Zahl sagt vorab, was der Filter übrig lässt.
- **Blätterleiste für alle langen Listen** — Geräte, Alarme, Patches, Skripte,
  Konten, Job-Verlauf, Audit. 25 pro Seite als Default, 50/100/alle wählbar,
  Auswahl je Liste im Browser gemerkt. Die Liste „kürzlich behobene Alarme"
  verliert ihren harten Schnitt nach acht Einträgen.
- **Personen als Master-Detail:** links die Liste, rechts alles zu einer
  Person — Kennzahlen (Geräte, online, offene Alarme, offene Updates,
  Sicherheitsupdates), Notiz, zugewiesene Geräte samt Patch-Stand,
  Gerätezuweisung, das verknüpfte Konto (Rolle, letzter Login, Zwei-Faktor,
  Passwort zurücksetzen) und ein auf die Person gefilterter Aktivitätsverlauf.
- **Skript-Bibliothek:** Vorlagen haben eine eigene Galerie statt eines
  versteckten Auswahlfelds und sind von 4 auf 12 gewachsen (Temp-Cleanup,
  Paketcache, Drucker-Spooler, Netzwerk-Diagnose für Linux und Windows,
  Speicherplatz-Report, Windows-Update-Reset, Neustart). Skripte tragen eine
  Kategorie, lassen sich mit einem Stern markieren, als **destruktiv**
  kennzeichnen (Ausführen verlangt dann die Eingabe des Namens) und
  duplizieren.
- **Audit-Log ist ein Werkzeug geworden:** Filter nach Zeitraum, Kategorie,
  Akteur, Gerät und Freitext (auch im `detail`-Blob), ein Schnellfilter
  „Sicherheit", serverseitige Blätterung mit Gesamtzahl, farbige Kategorien,
  ausklappbare Zeilen mit allen Feldern des Ereignisses und Tagestrenner
  („Heute", „Gestern", Datum). Neuer Endpunkt `/api/audit/meta`.
- Optionale `.pre-commit-config.yaml` (ruff, gofmt, go vet, eslint, tsc, plus
  ein Riegel gegen versehentlich eingecheckte Secret-Dateien).
- Agent-Tests von 4 auf 17: apt-Ausgabe-Parser (dafür aus der
  Kommandoausführung herausgelöst), Log-Ringpuffer inkl. Nebenläufigkeit,
  Shell-Auswahl und Timeout-Deckelung, Rechte der Konfigurationsdatei.
- CI prüft jetzt auch Frontend-Lint und Frontend-Tests und hat einen eigenen
  Audit-Job (`pip-audit`, `npm audit`, `govulncheck`). Vorher gab es
  überhaupt kein Dependency-Gate.
- Dependabot für pip, npm, Go, GitHub Actions und die Basis-Images.
- `/api/ready`: Readiness-Endpunkt, der die Datenbank prüft und sonst 503
  liefert. `deploy.sh` gated darauf, nicht mehr nur auf den Liveness-Check.
- Beide Anwendungscontainer laufen als uid 10001, ohne Capabilities und mit
  `no-new-privileges`; der Web-Container hat jetzt ebenfalls einen
  Healthcheck. **Achtung:** ein bestehendes Volume `rxf-rmm-data` braucht
  einmalig einen `chown` — siehe `docs/OPERATIONS.md`.
- `rustdesk/rustdesk-server` ist auf 1.1.16 gepinnt statt `:latest`.
- Frontend-Lint-Gate (ESLint mit typescript-eslint, react-hooks und jsx-a11y)
  und Frontend-Tests (Vitest + Testing Library). Vorher gab es für das
  Dashboard weder das eine noch das andere.
- `components/Modal.tsx`: Dialoge mit Fokusfalle, Escape, Fokus-Rückgabe und
  `role="dialog"`.
- Echte URLs (react-router): Geräteseiten sind verlinkbar, der Zurück-Button
  funktioniert, ein Reload landet dort, wo man war.
- Bestätigungsdialoge für Patch-Installation, Ad-hoc-Befehl und Agent-Update —
  drei Aktionen, die vorher ohne Rückfrage liefen.
- `ErrorBoundary`: ein Renderfehler zeigt eine Meldung statt einer weißen
  Seite.
- `docs/PRIVACY.md`: was auf einem betreuten Gerät gemeldet wird und was
  nicht, in einfachem Deutsch für die betreute Person geschrieben.
- Dokumentation: `docs/ARCHITECTURE.md`, `docs/API.md`,
  `docs/CONFIGURATION.md`, `docs/OPERATIONS.md`, `docs/TROUBLESHOOTING.md`,
  `SECURITY.md`, `CONTRIBUTING.md`, dieses Changelog, `LICENSE` (Apache-2.0)
  und Issue-/PR-Vorlagen.
- `.env.example` enthält jetzt auch `CLEANUP_INTERVAL_S`, `ALERT_INTERVAL_S`,
  `METRICS_RAW_RETENTION_H` und `METRICS_HOURLY_RETENTION_D`.

### Hinzugefügt (Fortsetzung)
- Neue Skript-Vorlage **„Proxmox: alle LXC-Container aktualisieren"**: läuft
  auf dem Proxmox-Host, geht per `pct` durch jeden laufenden Container und
  aktualisiert dessen Pakete — Debian/Ubuntu, Alpine, Fedora/Rocky, openSUSE
  und Arch werden am Paketmanager erkannt. Ausgeschlossen sind ab Werk
  cloudflared (CT 104) und das RMM selbst (CT 111), weil ein Neustart dieser
  beiden die Verbindung kappt, über die der Job gerade läuft. Startet nichts
  neu, meldet nur, wo ein Neustart nötig wäre, und hört zwischen zwei
  Containern auf, wenn das Zeitbudget knapp wird — abgebrochenes `dpkg`
  hinterlässt eine halb konfigurierte Paketdatenbank.
- Längere Vorlagen liegen jetzt als echte Datei unter
  `frontend/src/templates/` und werden per `?raw` eingebunden, statt als
  Template-Literal im TypeScript zu stehen: dort müsste jedes `${…}` von Hand
  escapt werden, und ein übersehenes Escape verfälscht still ein Skript, das
  später als root läuft.

- **Täglicher Update-Scan über den Heartbeat.** Jedes Gerät wird einmal am Tag
  zum Scan aufgefordert; der Slot liegt bei `PATCH_SCAN_HOUR` (Default 3 Uhr
  lokal) und verteilt sich über die Stunde (`ID % 60`), damit nicht die halbe
  Flotte gleichzeitig scannt. Ausgelöst wird das nicht von einer Uhr im Agent,
  sondern vom Heartbeat: Ein Gerät, das zur Slot-Zeit aus war, holt den Scan
  beim nächsten Online-Heartbeat nach, statt den Tag zu überspringen. Als
  erledigt zählt erst der eingetroffene Bericht — eine Anfrage, die nie
  beantwortet wird, wird nach einer Stunde wiederholt. Während einer laufenden
  Installation wird nicht gescannt. Abschaltbar über `PATCH_SCAN_ENABLED`.
- Der Gerätereiter „Updates" zeigt jetzt, wann zuletzt wirklich gescannt
  wurde. Eine leere Liste sah vorher aus wie „alles aktuell", auch wenn nie
  jemand nachgesehen hatte.

### Geändert
- **Audit-Einträge sagen jetzt, was sich geändert hat.** `devices.updated`
  nennt in `changed` die Felder, die sich tatsächlich geändert haben: die
  Person mit vorher/nachher samt Namen, hinzugefügte und entfernte Tags, die
  RustDesk-ID mit vorher/nachher — sie entscheidet, wohin eine
  Fernsteuerung geht — und alles Übrige nur mit Namen; Notizen,
  Seriennummern und IMEIs gehören nicht ins Log. Skript-Einträge
  (`job.created` für Skripte, `script.scheduled_run`, `script.created`,
  `script.updated`) tragen einen Fingerabdruck des Skriptinhalts
  (`content_hmac`), `script.updated` zusätzlich den vorherigen, die
  `destruktiv`-Markierung vorher und nachher und bei einer Umbenennung den
  alten Namen (`script_from`) — ältere Einträge nennen das Skript noch so,
  und der Feed sagt „umbenannt von …". Die Bibliothek ist änderbar; erst der
  Fingerabdruck verbindet einen Lauf mit der Fassung, die tatsächlich lief,
  ohne den Inhalt ins Log zu kopieren. Er ist ein HMAC-SHA256 mit einem
  zufälligen Schlüssel dieser Installation (in `app_settings`, von keinem
  Endpunkt ausgeliefert), kein bloßer SHA-256: Skripte folgen bekannten
  Vorlagen, und ein kurzes Passwort darin ließe sich aus einem ungesalzenen
  Hash im Log in Minuten durchprobieren — auch noch, nachdem es längst aus
  dem Skript entfernt ist.
- **Rollen-Matrix als Test** (`backend/tests/test_role_matrix.py`). Jeder
  schreibende `/api`-Endpunkt wird mit eingeschalteter Auth ohne Sitzung, als
  Viewer und als Techniker aufgerufen: Admin-Endpunkte antworten beiden mit
  403, Operator-Endpunkte dem Viewer, und ein abgewiesener Aufruf hinterlässt
  keinen Audit-Eintrag. Die zugelassene Rolle bekommt den Status, den der
  Handler wirklich liefert, nicht bloß „nicht 403" — ein Eintrag, dessen Pfad
  ins Leere geht, fällt so auf. Erwartet ein Eintrag einen Fehlerstatus, muss
  die Antwort eine Meldung des Handlers sein und nicht FastAPIs Fehlerliste
  aus der Eingabeprüfung, die ebenfalls mit 422 antwortet. Ein Wächtertest
  liest `app.routes` und schlägt fehl, sobald ein schreibender Endpunkt ohne
  Eintrag dazukommt; ausgenommen sind mit Begründung nur Login, Logout und
  das Agent-Enrollment. Dazu
  kommen Tests für das Viewer-Scoping von `/api/fleet/metrics` und
  `/api/inventory/search`, für `4403` am Job-Socket (auch für den Viewer, dem
  das Gerät gehört) und für den Fleet-Socket, der ohne Sitzung `4401` sendet
  und auch angemeldet nur Hinweise ohne Nutzdaten. Die Matrix und die
  Socket-Tests schalten Auth am zwischengespeicherten `get_settings()` ein,
  das `verify_session` und die Sockets selbst lesen; ein nachträglich
  gesetztes `AUTH_ENABLED` kam dort nie an, sodass ein lokales
  `AUTH_ENABLED=false` die Tests scheitern ließ, ohne etwas über die Prüfung
  zu sagen.

- Alle Module öffnen die Datenbank über einen gemeinsamen Helfer
  (`app/db.py`), der Fremdschlüssel einschaltet. Vorher taten das zwei von
  zwölf, wodurch `ON DELETE CASCADE` davon abhing, welches Modul das DELETE
  ausführte.
- Die Schema-Version steht jetzt in der Datenbank (`schema_meta`). Läuft ein
  älterer Build gegen eine neuere Datei, gibt es eine Warnung im Log statt
  gar keines Hinweises.
- Der ruff-Regelsatz ist explizit in `pyproject.toml` aufgeführt und die
  ruff-Version auf die 0.16er-Reihe gepinnt. Vorher hätte eine neue
  ruff-Version das Lint-Gate ohne Codeänderung rot gemacht.
- **Das Backend wird mit mypy geprüft** (Normalmodus, `mypy==2.3.1` als
  Dev-Abhängigkeit), im CI-Job und im Gate-Kommando
  (`ruff check . && mypy app && pytest …`). Von den vier Befunden war einer
  echt: `get_ntfy_config` war als `dict[str, str]` annotiert, liefert aber
  das `has_token`-Bool, auf das sich das Dashboard verlässt.
- ruff prüft zusätzlich `DTZ` (naive Datumswerte — so entstand der
  Zeitumstellungsfehler im Update-Scan) und `TRY400`. Die zwei
  `TRY400`-Stellen loggen jetzt mit Traceback: ein abgelehnter Bootstrap-Admin
  und ein Tresor-Eintrag, der sich nicht entschlüsseln lässt — erst der
  Traceback unterscheidet einen ausgetauschten `credentials.key` von einem
  Secret, das kein UTF-8 ist.
- **Property-Tests mit hypothesis** (`hypothesis==6.168.1`, Dev-Abhängigkeit,
  200 Beispiele je Test, festgelegt in `tests/conftest.py`): Update-Scan-Slot
  über Zeitumstellungen hinweg, Secret-Filter unabhängig von Chunk-Grenzen,
  Versionsvergleich der Agent-Updates und MAC-Normalisierung für
  Wake-on-LAN. Sie fanden den Secret-Fehler unter „Sicherheit".
- README neu strukturiert; die Beschreibung der CD-Pipeline entsprach nicht
  mehr der Realität (SSH statt Self-hosted Runner).
- **Agent-CI prüft alle drei Zielsysteme.** `go vet` läuft zusätzlich mit
  `GOOS=windows` und `GOOS=darwin` — Dateien hinter einem Build-Tag wurden
  vorher nur für Linux geprüft. Neu ist golangci-lint 2.14.0 (errcheck, gosec,
  govet, staticcheck, unused) über die offizielle Action, ebenfalls je
  Zielsystem, denn der Windows-Code hatte Befunde, die ein Linux-Lauf nie
  zeigt. Die Version ist gepinnt wie bei ruff. Gewollte gosec-Treffer
  (Shell-Jobs, die signierte Binary mit 0755, feste `/sys`-Pfade) sind in
  `agent/.golangci.yml` einzeln je Datei und Prüfung ausgenommen und
  begründet. Die Tests laufen mit `-race`. Lokal prüfen `make vet` und das
  neue `make lint` alle drei Systeme.
- Der Agent trennt das Lesen einer Servernachricht (`decodeCommand`, ohne
  Seiteneffekte) von ihrer Ausführung (`dispatch`). Eine Nachricht, die er
  nicht lesen kann, wird protokolliert und übersprungen, statt die Verbindung
  abzubauen — neu verbinden macht die nächste nicht lesbarer. Decoder, die
  Parser für apt, dpkg/rpm und `resolv.conf` sowie die Signaturprüfung für
  Agent-Updates haben jetzt Fuzz-Tests; die Testabdeckung des Agents steigt
  von 11,7 % auf 26,0 %.

### Sicherheit
- **Zwei Befehle an Geräte liefen am Audit-Log vorbei.** Das Agent-Update,
  das der Server beim ersten Heartbeat einer Verbindung von selbst anbietet,
  steht jetzt als `agent.update_offered` mit dem Akteur `automation`, der
  angebotenen und der vom Agent gemeldeten Version im Log; das Abrufen der
  Agent-Logs als `device.agent_logs` mit dem anfragenden Benutzer. Den
  Eintrag für `get_logs` schreibt `ConnectionManager.request_logs` selbst,
  sobald der Befehl den Server verlassen hat — eine Zeitüberschreitung bleibt
  so belegt, und kein späterer Aufrufer kann den Befehl ohne Eintrag
  schicken. Beide Ereignisse zählen zur Kategorie „Geräte", und das Dashboard
  beschreibt sie in ganzen Sätzen.
- **Auch das Wecken vor dem Patch-Fenster steht im Audit-Log.** Das Magic
  Packet, das der Server offline Geräten im Fenster schickt, schreibt jetzt
  `device.wake` wie das Aufwecken von Hand, mit dem Akteur `automation`, der
  Zahl der MAC-Adressen und `patch_window: true`. Scheitert das Senden schon
  am Socket, entsteht kein Eintrag.
- **RustDesk-IDs werden geprüft.** Angenommen werden nur numerische IDs
  (6–12 Ziffern) und eigene Aliasse (6–16 Zeichen, beginnend mit einem
  Buchstaben, aus Buchstaben, Ziffern, `_` und `-`) — dieselbe Regel wie im
  Dashboard. Ohne den Buchstaben am Anfang wäre jede 13- bis 16-stellige
  Ziffernfolge als Alias durchgegangen. Die ID landet in einem
  `rustdesk://`-Link, den der Rechner des Technikers an einen
  Protokoll-Handler übergibt, und sie kommt vom Agent oder aus einem
  Formular. Leerzeichen entfernt der Server vor der Prüfung — RustDesk zeigt
  IDs in Dreiergruppen (`123 456 789`), und so werden sie kopiert —, im
  Formular, im Heartbeat und bei einer schon gespeicherten ID; gespeichert
  wird die bereinigte Form. Ein Heartbeat mit ungültigem Wert behält die
  gespeicherte ID, `PATCH /api/devices/{id}` antwortet mit 422 (leer löscht
  die ID weiterhin), und aus einer schon gespeicherten ungültigen ID entsteht
  kein Link mehr (409, ohne Audit-Eintrag). Die Meldung nennt den Aufruf,
  der sie korrigiert (`PATCH /api/devices/{id}` mit `rustdesk_id`); ist
  RustDesk auf dem Server eingerichtet, bietet der Reiter „Fernzugriff" im
  Dashboard eine solche ID vorbefüllt zum Neu-Speichern an.
  `docs/TROUBLESHOOTING.md` beschreibt beide Wege.
- **Ein Agent konnte über die Jobs anderer Geräte berichten.** Der Server
  übernahm die `job_id` aus `job_started`, `job_output` und `job_result`
  ungeprüft. Ein manipuliertes oder fehlerhaftes Gerät konnte damit den Job
  eines anderen Geräts als laufend markieren, Ausgabe anhängen oder ihn
  abschließen — und, weil die `##RMM-CRED##`-Erkennung ihre halb gelesene
  Zeile pro Job festhält, sich in dessen Passwort-Zeile einschieben: das
  Secret landete dann im Klartext im Job-Log. Jetzt prüft der Server vor jeder
  dieser Meldungen, ob der Job zum Gerät des Sockets gehört, verwirft fremde
  und unbekannte Job-IDs und schreibt `agent.job_mismatch` als
  Sicherheitsereignis ins Audit-Log. Die Zuordnung kommt aus der Datenbank,
  nicht aus der Verbindung — ein Job, der vor einem Reconnect verschickt
  wurde, lässt sich danach weiterhin abschließen.
- Go-Toolchain für den Agent von 1.25.14 auf 1.26.9 angehoben. `govulncheck`
  meldete neun erreichbare Schwachstellen in der Standardbibliothek, für die
  es in der 1.25er-Reihe keinen Fix mehr gibt. Betroffen sind unter anderem
  der TLS-Handshake im WebSocket-Dialer (GO-2026-6607) und der HTTP-Client
  beim Agent-Update (GO-2026-6610, GO-2026-6605), also Code, den jeder
  ausgelieferte Agent ausführt. `infrastructure/build-agent.sh` baut
  entsprechend mit `golang:1.26-alpine`.
- Go-Toolchain für den Agent von 1.25.0 auf 1.25.14 angehoben. `govulncheck`
  meldete 25 erreichbare Schwachstellen in der Standardbibliothek — betroffen
  waren TLS-Handshake, URL-Parsing und Cookie-Verarbeitung im WebSocket-Dialer,
  also Code, den jeder ausgelieferte Agent ausführt.
- Die Enrollment- und Setup-Endpunkte sind jetzt rate-limitiert (20
  Fehlversuche pro IP in 300 s). Vorher war der einzige unauthentifizierte
  Bereich neben dem Login unbegrenzt abfragbar.
- Das Backend startet nicht mehr mit `--proxy-headers --forwarded-allow-ips "*"`.
  Uvicorn hat damit `request.client` aus einem Header übernommen, den jeder
  Aufrufer setzen kann — also genau den Wert, auf den das Login-Rate-Limit
  zurückfällt, wenn `TRUST_PROXY_HEADERS` aus ist.
- Das Dashboard bietet keinen kopierbaren Download-Link mit Token in der URL
  mehr an. Beide verbleibenden Wege übergeben das Token im Header.
- Abmelden und abgelaufene Sitzungen leeren jetzt den gesamten
  Abfrage-Cache und die Auftrags-Toasts. Vorher sah, wer sich im selben Tab
  mit einem anderen Konto anmeldete, für einen Moment Geräte, Alarme und
  Auftragsausgaben des vorherigen Kontos.
- RustDesk-Links öffnet das Dashboard nur noch, wenn die ID wohlgeformt ist;
  eine vom Agent gemeldete ID landet sonst nicht ungeprüft in
  `window.location`. Manuell eingetragene IDs werden genauso geprüft.
- Fernzugriff, Fernsteuerung, die Einrichtung von RustDesk und die
  Auftragskonsole laufender Updates sind für die Rolle Viewer ausgeblendet —
  das Backend verweigert sie ohnehin.
- Die Auftrags-Verbindung gibt auf, wenn der Server sie endgültig abweist
  (4401/4403/4404), statt es endlos neu zu versuchen.
- Ein als destruktiv markiertes Skript lässt sich nur noch nach Eingabe
  seines Namens einplanen oder als Zeitplan einschalten — wie beim
  direkten Ausführen.
- Massenaktionen nennen vor dem Start jedes betroffene Gerät; die
  Software-Installation zeigt den Befehl, der je Betriebssystem läuft.
  Gleichnamige Geräte werden in Auswahllisten und Bestätigungen per
  `#ID` unterschieden.
- **Der Agent nimmt vom Server höchstens 1 MiB pro Nachricht an.**
  gorilla/websocket hält eine Nachricht vollständig im Speicher und setzt ab
  Werk keine Grenze; ein defekter Server oder etwas zwischen Server und Gerät
  konnte so jeden Agent der Flotte beliebig viel Speicher belegen lassen. Die
  größte legitime Nachricht, ein Skript mit 64.000 Zeichen, kommt JSON-kodiert
  auf höchstens 384.000 Byte.
- **Der Agent prüft Patch-IDs, bevor er sie weitergibt.** Unter Windows
  landeten sie in einem PowerShell-String in einfachen Anführungszeichen, und
  maskiert wurde nur `'` — PowerShell beendet einen solchen String aber auch
  an `‘`, `’`, `‚` und `‛`. Unter Linux gingen sie ohne `--` an apt, eine ID
  wie `-o…` war also eine Option. Jetzt nimmt der Agent nur die Form an, die
  sein eigener Scan meldet (Windows: GUID; Linux: Debian-Paketname, optional
  mit `:arch`), und lehnt den Job sonst mit der abgelehnten ID in der Ausgabe
  ab; vor den Paketnamen steht zusätzlich `--`.
- **Ein Secret aus einer `##RMM-CRED##`-Zeile konnte zum Teil im Job-Log
  landen.** Der Filter zerlegte die Ausgabe mit `str.splitlines()`, das auch
  an U+2028, NEL, Seitenvorschub und ähnlichen Zeichen trennt — JSON erlaubt
  U+2028 und NEL aber roh in Strings. Stand eines davon im Secret, ging der
  Rest der Zeile als normale Ausgabe in Job-Log und Live-Stream, und der
  Eintrag wurde als „ungültiges Format" verworfen statt im Tresor abgelegt.
  Zeilen enden jetzt nur noch an CR und LF.
- **Eine `##RMM-CRED##`-Zeile hinter einem unsichtbaren Zeichen landete
  vollständig im Job-Log, Secret inklusive.** Vor dem Marker galt nur
  Leerraum als erlaubt; ein BOM (U+FEFF), ein Zero-Width-Space (U+200B), ein
  Word Joiner (U+2060) oder ein NUL machten aus der Marker-Zeile normale
  Ausgabe. Vor dem Marker dürfen jetzt außer Leerraum auch Steuerzeichen und
  unsichtbare Formatzeichen stehen — an allen Stellen, die nach dem Marker
  suchen, nach derselben Regel.

### Geändert
- Build und CI laufen auf **Node 24 (LTS)** statt 22 — und beide zusammen:
  der Major steht in `frontend/Dockerfile` und in `node-version` in `ci.yml`,
  ein Auseinanderlaufen zeigte sich sonst erst beim Deploy. Dependabot
  ignoriert den Node-Major deshalb; es sieht nur den Dockerfile.
- Das Backend-Image bringt `tzdata` mit und der Container bekommt
  `TZ` (Default `Europe/Berlin`). Ohne beides rechnet der tägliche Update-Scan
  in UTC, und der eingestellte Slot läge im Sommer zwei Stunden daneben.
- Der Ping/Pong-Barrier in den Agent-WS-Tests sammelt unaufgeforderte Frames
  ein, statt anzunehmen, dass die nächste Nachricht das Pong ist. Der Kanal
  ist kein Request/Response — der Server schickt von sich aus (Update-Angebot,
  Scan-Aufforderung).
- Dependabot ignoriert außerdem die Majors von `eslint`, `@eslint/js` und
  `typescript`: alle drei lassen sich derzeit nicht installieren
  (`eslint-plugin-jsx-a11y` hat als Peer nur eslint ≤ 9, `typescript-eslint@8`
  nur typescript < 6.1), und ohne die Regel legt Dependabot die PRs jede Woche
  neu an. Minor- und Patch-Updates dieser Pakete laufen weiter.

### Behoben
- **Der Agent konnte sich dauerhaft aufhängen, solange Jobs viel ausgaben.**
  Die Hauptschleife ist die einzige, die die Warteschlange zum Server leert,
  stellte aber Heartbeat, Inventar und die Antworten auf `ping` und
  `get_logs` selbst in dieselbe Warteschlange. War sie von Job-Ausgaben voll,
  wartete die Schleife auf sich selbst: kein Heartbeat mehr, keine Antwort,
  und auch ein Verbindungsabbruch blieb unbemerkt, bis der Dienst neu
  startete. Diese Nachrichten schreibt die Schleife jetzt direkt; sie können
  dabei wartende Job-Ausgaben überholen, deren Reihenfolge untereinander
  bleibt erhalten.
- Der Agent konnte bei jedem Verbindungsabbruch eine Goroutine samt
  Nachricht zurücklassen: Der Leser des Sockets blieb an einem ungepufferten
  Kanal hängen, sobald die Hauptschleife schon beendet war. Er gibt jetzt auf,
  sobald die Verbindung vorbei ist.
- Der Agent meldete aus einer Zeile wie `nameservers 10.0.0.2` in der
  `resolv.conf` einen DNS-Server. Das Schlüsselwort muss jetzt für sich
  stehen, wie es auch der Resolver verlangt.
- Eine abgelehnte Eingabe (422 mit FastAPIs Fehlerliste) brachte die
  Geräteseite zum Absturz: `apiErrorMessage` reichte die Liste als Meldung
  weiter, und das RustDesk-Formular rendert die Meldung als Text. Die Liste
  wird jetzt zu einem Satz zusammengesetzt.
- `test_outdated_agent_is_offered_an_update` hing von der Testreihenfolge ab:
  bei einem nie gescannten Gerät geht zuerst die tägliche Scan-Aufforderung
  hinaus, und der Test lief nur grün, wenn ein früherer Test Gerät 1 schon als
  gefragt markiert hatte.

- **Ein destruktives Skript lief im Remote-Reiter mit einem einzigen Klick.**
  In der Bibliothek verlangt es seinen Namen, hier stand es als Knopf in einer
  Reihe gleich aussehender Knöpfe. Jetzt gilt dieselbe Hürde. Außerdem bot der
  Reiter jedes Skript auf jedem Gerät an — auch PowerShell auf einem
  Linux-Server; die Auswahl ist auf passende Skripte eingeschränkt.
- Ein aufgedecktes Passwort blieb sichtbar, bis jemand die Seite verließ. Es
  verbirgt sich jetzt nach 30 Sekunden von selbst; dazu steht dabei, wer den
  Eintrag zuletzt geändert hat.
- Die Update-Liste eines Geräts stand in der Reihenfolge, die der Agent
  lieferte. Sie ist nach Dringlichkeit sortiert, mit der Verteilung darüber.
- Der Inventar-Reiter schnitt die Softwareliste stillschweigend bei 500
  Einträgen ab, unterschied „nichts gemeldet" nicht von „kein Treffer" und
  sagte nicht, wann das Inventar erhoben wurde.
- Der Knopf „Scannen" im Patch-Management öffnete nur das Gerät, statt einen
  Scan anzufordern. Er tut jetzt, was er sagt; dazu eine Spalte „zuletzt
  geprüft", und ein nie gescanntes Gerät steht nicht mehr als „aktuell" da.
- Die Dringlichkeit eines Alarms hing allein am Regeltyp: ein Server, der eine
  Minute nicht antwortet, war „kritisch", ein seit Wochen offenes
  Sicherheitsupdate dauerhaft „Warnung". Jetzt entscheidet mit, wie lange der
  Zustand schon anhält.
- Die Karte „Letzte Aktivität" auf der Übersicht stand für Techniker und
  Betrachter dauerhaft leer da, weil das Audit-Log Admin-Sache ist — sie
  erscheint dort jetzt gar nicht erst.
- Die Aufgabenliste der Übersicht zeigte höchstens sechs Punkte, ohne Weg zum
  Rest; die Überschrift zählte sie trotzdem mit.
- `useTheme` las `localStorage` ungeschützt: im privaten Fenster oder bei
  blockierten Site-Daten riss eine Farbeinstellung die gesamte Oberfläche in
  die Fehlerseite.
- Die Speicher-Schlüssel hießen noch nach dem früheren Produktnamen
  (`ryntra-theme`, `ryntra-favorites`). Sie heißen jetzt `vulpexa-*`,
  Bestehendes wird einmalig übernommen.
- Nur noch die Latein-Subsets von IBM Plex Mono landen im Image — vorher auch
  Kyrillisch, Griechisch und Vietnamesisch, 36 statt 18 Schriftdateien.
- Der Zurück-Pfeil und das „⋯"-Menü der Geräteseite hatten keinen Namen für
  Screenreader, der Theme-Umschalter nur ein `title`.
- Die Live-Metriken auf der Geräteseite färbten nach Metrik statt nach Last:
  29 % RAM sahen rot aus, 12 % CPU orange. Jetzt gilt dieselbe Skala wie in
  der Geräteliste, damit dasselbe Gerät nicht auf zwei Seiten unterschiedlich
  dramatisch wirkt.
- Offline-Geräte zählten gleichzeitig als „Problem"-Geräte: dieselbe Maschine
  stand unter beiden Filtern und die Trefferzahlen ergaben zusammen mehr als
  die Flotte. Offline ist jetzt eine eigene Lage — was auf einem nicht
  erreichbaren Gerät kaputt ist, lässt sich ohnehin erst beheben, wenn es
  wieder antwortet.
- Der `web`-Container startete nach der Härtung überhaupt nicht mehr:
  `exec /usr/bin/caddy: operation not permitted`, Exit 255, Neustartschleife,
  Port 80 tot. Ursache ist nicht ein Schreibrecht, sondern `execve` selbst:
  `/usr/bin/caddy` trägt die Datei-Capability `cap_net_bind_service=ep`, und
  ein gesetztes *effective*-Bit bei fehlender Capability im Bounding-Set lässt
  den Kernel den Exec verweigern. `cap_drop: ALL` allein macht den Container
  damit unstartbar. `cap_add: NET_BIND_SERVICE` bringt genau diese eine
  Capability ins Bounding-Set zurück; alles andere bleibt entzogen.
- `deploy.sh` meldete einen erfolgreichen Deploy, während der `web`-Container
  in `Restarting (255)` hing und Port 80 nichts beantwortete. Die Gates
  prüften nur das Backend — `web` ist aber der einzige Dienst mit Host-Port.
  Neues drittes Gate: `curl http://127.0.0.1/api/ready` über den
  veröffentlichten Port, also die Strecke, die Browser und Cloudflare Tunnel
  tatsächlich nehmen.
- Caddys `XDG_DATA_HOME`/`XDG_CONFIG_HOME` liegen jetzt unter `/caddyhome`.
  Das Basis-Image `caddy:2-alpine` deklariert `VOLUME /data` und
  `VOLUME /config` und legt die beiden Verzeichnisse dorthin; Docker verwirft
  aber, was ein späterer Build-Schritt unterhalb eines vom Basis-Image
  deklarierten Volumes schreibt, sodass der `chown` im `frontend/Dockerfile`
  wirkungslos blieb und Caddy als uid 10001 seinen Zustand nicht hätte
  schreiben können. (Der Ausfall des Web-Containers kam **nicht** daher — das
  war die fehlende Capability, siehe oben. Diese Änderung ist trotzdem
  richtig: der wirkungslose `chown` war ein echter Defekt.)
- Der dokumentierte Besitzerwechsel für das Datenvolumen war an zwei Stellen
  falsch und hat den ersten Deploy nach der Umstellung auf uid 10001
  scheitern lassen. Erstens nannte er den Compose-Schlüssel statt des
  Volumenamens — Compose stellt den Projektnamen voran
  (`infrastructure_rxf-rmm-data`), sodass ein neues leeres Volume angelegt und
  das echte nicht angefasst wurde. Zweitens lief der Ersatzbefehl über
  `docker compose run` und erbte damit `cap_drop: ALL`, worauf `chown` auch
  als root an fehlendem `CAP_CHOWN` scheiterte. Beides korrigiert, mit
  Prüfschritt und Begründung in `docs/OPERATIONS.md`.
- Der Live-Job-Stream blieb nach einem Verbindungsabbruch stumm stehen. Er
  verbindet jetzt mit Backoff neu und zeigt den Abbruch an.
- Dialoge waren für Tastatur und Screenreader nicht bedienbar: Klick-Handler
  auf `div`s, keine `role="dialog"`, Fokus blieb hinter dem Dialog.
- Formularfelder hatten Beschriftungen ohne Zuordnung (`span` statt `label`).
- Eine Erfolgsmeldung („Magic Packet gesendet") wurde als Fehler in Rot
  ausgegeben, weil sie durch den Fehlerkanal lief.
- Eine abgelaufene Session ließ das Dashboard hinter einem Fehlerbanner
  stehen, das nie aufging: die Poller liefen weiter gegen 401. Jeder 401
  führt jetzt zurück zur Anmeldung.
- Der Fleet-WebSocket verband sich mit festen 5 s neu — ein länger nicht
  erreichbares Backend bekam damit von jedem offenen Tab zwölf Versuche pro
  Minute. Jetzt exponentiell bis 60 s.
- Vier Ladevorgänge verschluckten ihren Fehler kommentarlos; eine nicht
  geladene Skript- oder Personenliste sah damit aus wie „es gibt keine".
- Das Löschen eines Geräts räumte seine Alarme nicht mit ab. Die Zeilen
  blieben in der Historie stehen und verwiesen auf eine Geräte-ID, die es
  nicht mehr gab.
- Ein Fehler in einem der beiden Hintergrund-Loops wurde beim Herunterfahren
  stillschweigend verschluckt; er wird jetzt geloggt.
- Fleet-Broadcasts konnten von der Garbage Collection abgeräumt werden, bevor
  sie gesendet waren — der Task wird jetzt referenziert gehalten.
- `assert`-Invarianten in Produktionscode (die unter `python -O` verschwinden)
  durch echte Fehlerpfade ersetzt.
- Die Mindestpasswortlänge galt nur im Auth-Router. Ein zu kurzes
  `BOOTSTRAP_ADMIN_PASSWORD` legte damit stillschweigend ein Admin-Konto mit
  schwachem Passwort an. Die Regel gilt jetzt in `accounts`, also auf jedem
  Weg; der Bootstrap lehnt ab und sagt warum.
- `CORS_ORIGINS` akzeptiert jetzt auch eine kommagetrennte Liste oder eine
  einzelne Origin. Vorher brach der Start mit einem `SettingsError` ohne
  Hinweis auf die erwartete JSON-Schreibweise ab.
- Der Passwort-Tresor legt einen Eintrag jetzt neu an, wenn er zwischen
  Suche und Aktualisierung gelöscht wurde, statt einen Fehler zu liefern.
- Die Installer stoppen einen bereits laufenden Dienst, bevor sie die Binary
  überschreiben. Unter Linux scheiterte ein zweiter Lauf sonst mit
  „Text file busy"; der Windows-Installer machte das schon richtig.
- `install.sh` bricht bei einer nicht unterstützten Architektur mit einer
  aussagekräftigen Meldung ab statt mit „no matching agent binary".
- Der tägliche Update-Scan lieferte am Tag der Umstellung auf Sommerzeit einen
  Slot in der Zukunft, wenn `PATCH_SCAN_HOUR=2` gesetzt war: 02:30 gibt es am
  29.03.2026 in Berlin nicht, der Slot landete auf 03:30, und ein Gerät, das
  um 03:10 gerade gescannt hatte, galt trotzdem als überfällig und wurde nach
  Ablauf der Sperrfrist erneut aufgefordert. In der doppelten Stunde im
  Herbst fiel der Slot nach dem ersten 02:30 auf den Vortag zurück. Die
  Slots werden jetzt als Zeitpunkte verglichen, nicht als Uhrzeiten.
- Der Secret-Filter für Job-Ausgaben hing an der Stelle, an der der Agent
  seine Chunks schnitt: Kam das LF eines CRLF erst mit dem nächsten Chunk,
  folgte dem Hinweis „In Passwörtern gespeichert" eine Leerzeile; endete die
  Ausgabe auf Leerzeichen oder `##`, hängte das Jobende einen Zeilenumbruch
  an; ein zurückgehaltenes Fragment konnte hinter später gelesene Zeilen
  rutschen. Das Ergebnis ist jetzt für jede Zerlegung dasselbe.
- Eine `##RMM-CRED##`-Zeile ohne Zeilenende konnte den ganzen Server
  ausbremsen: Der Filter hielt sie ohne Obergrenze zurück und zerlegte sie mit
  jedem weiteren Chunk von vorn. 2 MiB Ausgabe ohne Umbruch kosteten 1,4 s
  Rechenzeit, in denen die Event-Loop für alle Agents und das Dashboard
  stand. Jetzt wird nur der neue Chunk nach dem Zeilenende durchsucht
  (0,015 s), und eine Marker-Zeile darf höchstens 64 Ki Zeichen lang werden —
  auch das längste gültige Credential bleibt darunter. Eine längere Zeile
  ersetzt der Hinweis „[⚠ RMM-CRED-Zeile ignoriert: zu lang]"; von ihr selbst
  landet nichts im Job-Log, auch nicht der Rest hinter der Grenze, und die
  Zeilen danach laufen normal weiter.
- Endete ein Job ohne Ergebnis — vom Timeout-Sweep beendet oder mit seinem
  Gerät gelöscht —, verschwand ein noch zurückgehaltenes Stück einer
  `##RMM-CRED##`-Zeile spurlos, und sein Filterzustand blieb bis zum
  Neustart im Speicher. Beides räumt jetzt `job_secrets.discard()` ab; eine
  Warnung `job_secrets.discarded` im Server-Log nennt Job und Länge, nie den
  Inhalt. Ein Neustart verliert den Zustand weiterhin ohne Spur, er liegt
  nur im Speicher.
- `POST /api/devices/{id}/patches/install` nahm beliebig viele und beliebig
  lange Patch-IDs an. Der Server schickt sie in einer einzigen Nachricht an
  den Agent, der höchstens 1 MiB pro Nachricht liest — eine zu große
  Auswahl kostete ihn die Verbindung. Jetzt sind es höchstens 400 IDs à 128
  Zeichen (auch im ungünstigsten Fall unter 1 MiB), und jede ID muss für
  dieses Gerät ausstehen: eine erfundene oder die eines anderen Geräts
  beantwortet der Server mit 422, statt sie an den Agent weiterzureichen.
  Doppelte IDs gehen nur einmal hinaus. „Alles installieren" schickt wie
  bisher keine IDs und ist davon nicht betroffen.

---

Für den Weg zum ersten vollständigen Funktionsumfang (Phasen 0–7) siehe
[`docs/_archiv/RMM-PLAN.md`](docs/_archiv/RMM-PLAN.md).
