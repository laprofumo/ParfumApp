# La Profumoteca Rezept-App (WebApp + OneDrive Excel + Epson TM-T30II ePOS-Print)

Diese Repo ist eine **mobile WebApp** (Android+iOS, Browser), plus **Serverless Backend** (Netlify Functions),
welche:
- Rezepte in **OneDrive (persönlich)** in die Excel-Datei schreibt (Sheet: `Duftkreationen`)
- nach dem Speichern Excel-Ergebnisse zurückliest (F/I/L/M)
- Kunden in A+B sucht, Trefferliste zeigt
- Auffüllungen in die Spalten (T/V/… und U/W/…) schreibt
- Bonds **direkt** auf Epson TM-T30II via **ePOS-Print (JavaScript)** druckt (80mm)
- zentrale Einstellungen (Logo/Header/QR/Footer/Drucker-IP) als **JSON in OneDrive** speichert

## 0) Voraussetzungen
- Netlify Account
- OneDrive (persönlich) Account (der die Excel-Datei enthält)
- Excel-Datei in OneDrive: `3Custom duft NEWNEW.xlsx` (oder beliebiger Name)
- Epson TM-T30II im gleichen Netzwerk, ePOS-Print aktiv

## 1) Microsoft App Registration (einmalig)
1. Azure Portal → App registrations → New registration
2. Supported account types: **Personal Microsoft accounts only**
3. Redirect URI (Web): `https://<DEIN-SITE>.netlify.app/.netlify/functions/auth-callback`
4. Notiere:
   - `MS_CLIENT_ID`
5. API Permissions:
   - Microsoft Graph → Delegated:
     - `Files.ReadWrite`
     - `offline_access`
     - `User.Read`
6. Zertifikate/Secrets:
   - Create Client Secret → Notiere `MS_CLIENT_SECRET`

## 2) Netlify Environment Variablen
In Netlify Site → Site settings → Environment variables:

- `MS_CLIENT_ID` = aus App Registration
- `MS_CLIENT_SECRET` = aus App Registration
- `MS_REDIRECT_URI` = `https://<DEIN-SITE>.netlify.app/.netlify/functions/auth-callback`
- `ONEDRIVE_EXCEL_PATH` = Pfad zur Excel-Datei, z.B. `/Apps/LaProfumoteca/3Custom duft NEWNEW.xlsx`
- `ONEDRIVE_SETTINGS_PATH` = Pfad zur JSON Settings Datei, z.B. `/Apps/LaProfumoteca/settings.json`
- `TOKEN_SECRET` = beliebiger langer Secret String (mind. 32 Zeichen) (für Verschlüsselung des Refresh Tokens)
- `ALLOWED_ORIGIN` = `https://<DEIN-SITE>.netlify.app` (oder leer lassen für permissiv)

## 3) Erste Autorisierung (einmalig)
Nach Deploy:
1. Öffne: `https://<DEIN-SITE>.netlify.app/#/settings`
2. Klicke **"Microsoft verbinden"**
3. Microsoft Login & Consent durchführen
4. Danach läuft alles ohne Login (Token wird verschlüsselt in OneDrive settings.json gespeichert)

## 4) Epson ePOS-Print aktivieren
Im Epson Webinterface (vom Drucker):
- ePOS-Print / ePOS-Print Service aktivieren
- Port (Standard: 8008)
- Netzwerkzugriff erlauben

## 5) Struktur der App
- `public/` Frontend (mobile WebApp)
- `netlify/functions/` Serverless Backend
- Alle Excel-Spalten werden **nach Excel Zeile 2** angesprochen (Feldnamen in UI)

## 6) Hinweis Sicherheit
Ohne Login bedeutet: jeder der die URL kennt, kann API Calls machen.
Empfehlung: Netlify Site nicht öffentlich teilen, oder später PIN/Basic Auth ergänzen.