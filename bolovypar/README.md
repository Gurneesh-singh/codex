# BoloVyapar

Mobile-first supplier and retailer platform. Milestone 1 provides the Expo app, Express API, and Supabase foundation. Milestone 2 adds Supabase Auth, business onboarding, protected profiles, and retailer connections. Milestone 3 adds supplier products, retailer contacts and prices, manual orders, deterministic billing, invoices, PDFs, and retailer bill history. Milestone 4 adds consented voice samples, transcription, order extraction and supplier review. Live calls belong to later milestones.

## Requirements

- Node.js 22.13.0 or newer (or 20.19.4 or newer) and npm 10 or newer
- Android development build or emulator for OAuth and email links, or a modern desktop browser. Expo Go supports basic email sign-in.
- A Supabase project to complete the database connection check

## Local setup

1. Run `npm install` in the repository root.
2. Create a Supabase project. Keep its project ref and database password available locally.
3. From the repository root, run `npx supabase login`, `npx supabase link --project-ref YOUR_PROJECT_REF`, `npx supabase db push --dry-run`, then `npx supabase db push`. Review the dry-run output before applying it. This applies the versioned migrations in `supabase/migrations` and records their history. Do not apply the same migration separately in the hosted SQL Editor.
4. Copy the backend entries from `.env.example` to `backend/.env` and the mobile entries to `mobile/.env`.
5. In Supabase **Connect**, copy the **Session pooler** PostgreSQL connection string into `backend/.env` as `DATABASE_URL`. Replace its password placeholder with the database password, URL-encoding special characters if needed. Keep this file private. The backend verifies the pooler's TLS certificate using the bundled Supabase root CA.
6. In Supabase **Connect** or **Settings → API Keys**, copy the project URL and **publishable** key into `mobile/.env`. Never put the database URL, secret key, or provider secrets in the mobile environment.
   Copy the same **public** project URL and publishable key to `backend/.env` as `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY`. The API uses them to verify bearer tokens with Supabase Auth and to issue RLS-scoped data requests.
7. Run `npm run dev:api` in one terminal. Run `npm run dev:mobile` for Expo Go or `npm run dev:web` for a browser in another terminal.
8. Sign in, complete business onboarding, then open **Check API and database connection** from the dashboard. In a browser on the same computer as the API, use `http://localhost:4000`. For a phone, use your computer's LAN URL such as `http://192.168.1.10:4000`; the phone and computer must be on the same network.

The Android emulator uses `10.0.2.2` to reach the computer's local API. The app automatically uses that address when `EXPO_PUBLIC_API_URL` is set to `http://localhost:4000` or `http://127.0.0.1:4000` on Android. A physical phone still needs the computer's LAN address.

The UI adapts from narrow phones to tablets and desktop browser windows. Rotation is enabled. Short landscape screens scroll, and wide screens use flexible cards and forms. PDF downloads work in web browsers; Android uses the native file share sheet.

On this Windows workspace, use `& .\scripts\dev-on-e.ps1 -Target api` in one PowerShell terminal. In another, use `-Target web` for the browser, `-Target android` to start the E: Android emulator and Expo, or `-Target android-build` to compile and install the native development client. The Android command uses port 8082 and ADB reverse forwarding so VPN adapter changes do not break local loading. The script uses the Node.js 24 ZIP under `.tools` and keeps the Android SDK, emulator data, Gradle, npm, Expo, DotSlash, and temporary caches inside this E: workspace. ADB itself requires two small authentication key files in `C:\Users\dell\.android` on Windows; all other project files stay on E:.

## Milestone 2 authentication setup

1. In Supabase **Authentication → Providers → Email**, keep email/password sign-in and **Confirm email** enabled. Confirmation and password recovery links return to the app through its `bolovyapar` URL scheme; use an Android development build for these links. Expo Go can sign in an already verified email account but cannot handle this app's custom scheme. The web app can receive links at `http://localhost:8081` during local development.
2. In Supabase **Authentication → URL Configuration**, set the local Site URL to `http://localhost:8081` and add redirect URLs `http://localhost:8081` and `bolovyapar://auth/callback`. Add the real deployed web URL before launch.
3. In Google Cloud **Google Auth Platform**, configure the consent screen and create an OAuth client of type **Web application**. Use `http://localhost:8081` as an authorized JavaScript origin for local web testing. Use `https://YOUR_PROJECT_REF.supabase.co/auth/v1/callback` as its authorized redirect URI.
4. In Supabase **Authentication → Providers → Google**, enable Google and enter that Web client's ID and secret directly in the dashboard. Never paste the secret into `mobile/.env`, `backend/.env`, or Git. Add your Google test users in Google Auth Platform while the consent screen is in testing mode. Manual linking of a different Google email also requires enabling Supabase's manual identity linking setting; verified matching emails are linked automatically by Supabase Auth.
5. Rebuild the native development client after changing native app configuration: `& .\scripts\dev-on-e.ps1 -Target android-build`. Start the API and app with `-Target api` and `-Target android`. Open confirmation or recovery emails on the same device that began the flow. The development build registers `bolovyapar://auth/callback` through Expo's URI scheme.

Each account creates one supplier **or** retailer business. The role and owner cannot be changed after onboarding. A retailer can share its business ID; a supplier requests a connection with that ID, and the retailer accepts or declines it. The supplier cannot read the retailer's private details until acceptance. RLS protects profiles, businesses, and links even if a client calls Supabase directly.

## Milestone 3 commerce workflow

1. As a supplier, complete the business state, GSTIN, address and postal code in **Profile settings**. Tax invoices require these fields; an order confirmation can be produced without them.
2. In **Products**, add a product, SKU, aliases, HSN, GST rate, optional stock quantity, and one or more selling units with standard prices. For stock tracked in base units, set each unit's **Stock used per unit** (for example, a box of 12 consumes 12). Products and contacts can be archived and restored. Existing order snapshots stay intact.
3. In **Retailers**, add a manual retailer or select an active linked retailer. Fill the address, state and postal code before issuing an invoice. Set retailer-specific prices when needed. Only an active linked retailer receives its confirmed orders in the app; manual contacts can still receive PDF files outside the app.
4. In **Orders & billing**, select the retailer, place of supply state, items, quantities, optional rate overrides, discounts and instructions. Save a draft, review its calculated amounts, then confirm. Confirmation locks the order and deducts stock for catalog items in a database transaction. A one-off item can be entered with a name, selling unit, rate and checked GST rate; it is not added to inventory or deducted from stock. A GST-registered supplier must enter its HSN code before confirming. The confirmed PDF is an **order confirmation**, available immediately. Confirming does not issue a tax invoice.
5. Once the supplier and retailer invoice details are complete, use **Issue tax invoice** separately. The API allocates a unique `BV/<financial-year>/<sequence>` number inside a database transaction. The invoice and its PDF snapshot remain immutable; only paid amount and payment status can change. The confirmation PDF remains available after invoicing.
6. From a confirmed order, use **Send bill in app** to search by name or select from all actively connected retailers. Choose the order confirmation or, after issuing it, the tax invoice. The selected retailer receives one PDF copy in **Bills received in app**. If the recipient differs from the buyer named on the PDF, the app requires a separate acknowledgement before sending. Sending the same document to the same recipient again does not create a duplicate. A received copy does not give that retailer access to the underlying order.
7. **Download PDF** saves a file in a browser. On Android, **Download PDF** and **Share PDF** open the native share sheet, where a file manager or WhatsApp can receive the PDF. **WhatsApp summary** opens a text-only message; it does not attach the PDF. Use the PDF share action to attach it.

Amounts are calculated on the backend in integer paise with fixed half-up rounding. The app does not use an LLM for billing. The seller must confirm the place of supply and applicable tax treatment before issuing an invoice. Generated PDFs include a signatory line; sign the file or printed copy as applicable before using it as a tax document. This workflow covers ordinary domestic sales and does not implement special GST cases such as reverse charge or e-invoicing. Check current [CBIC invoice requirements](https://cbic-gst.gov.in/gst-invoice-rules.html) before relying on it for a regulated sale.

Invoice PDFs embed the open-licensed Noto Sans Devanagari UI font for Hindi names; its OFL license is at `backend/assets/fonts/OFL.txt`.

## Milestone 4 voice order workflow

1. Create keys in the [Sarvam dashboard](https://dashboard.sarvam.ai/) and [Groq console](https://console.groq.com/keys). Put `GROQ_API_KEY` and `SARVAM_API_KEY` in the ignored `backend/.env` on E:. Groq is required for transcription and extraction; Sarvam enables transcription fallback. Keep the keys out of `mobile/.env` and Git. Restart the API after adding keys.
2. In the supplier dashboard, open **Voice to order**. Record up to 29 seconds or upload a short WAV, MP3, M4A, WebM or Ogg file under 10 MB. A live microphone meter moves during recording on web and Android when the device supplies audio levels. Browser recording requests automatic gain control and noise suppression, then trims quiet ends and gently compresses peaks before upload; Android recording requests a voice-communication microphone source. Device support varies. Obtain consent from every speaker before selecting the consent checkbox and processing the audio.
3. Groq `whisper-large-v3-turbo` transcribes the audio first, using short catalog and selling-unit hints. If it fails, returns no speech, misses a price, yields an unmatched catalog item, or the catalog is empty, Sarvam `saaras:v4` is tried using the same hints. When the primary reading has no prices and the backup has complete item evidence, the backup is used and every field is flagged for review; otherwise a backup result is accepted only when item counts, recognized quantities and already-recognized prices agree and it recovers a price or a unique catalog match. When the catalog is empty and the two providers hear different product names, both transcripts are shown so the supplier can correct the item name before billing. Groq then extracts retailer, items, quantities, units, rates, discounts, instructions, short transcript evidence, confidence and ambiguity. The backend validates the response. It matches only unique exact catalog and retailer names or product aliases; fuzzy names are suggestions for review. Compatible gram/kilogram and millilitre/litre quantities and rates are converted with a review warning. Unmatched or uncertain fields are highlighted for supplier review.
4. Review the transcript and each item. Quantity × rate, discount and the amount after discount update as you type. Select the correct catalog product and unit and retailer to see server-calculated GST, each item's final total, and the full bill total. If a spoken product is absent from inventory, the app asks whether to continue with it as a one-off item or choose/add a catalog product. Similar spellings appear as suggestions but are never selected automatically. After manually selecting a product whose spoken name differs from its catalog name and existing aliases, the app offers to save the spoken name as an alias for future orders; it saves only when the supplier taps **Save alias**. A one-off item needs a selling unit and checked GST rate, and a GST-registered supplier must supply an HSN code before confirmation. It is not added to inventory or deducted from stock. Check values as needed and acknowledge every item and the retailer. **Save draft** creates an editable order once its required fields and quote are complete; **Confirm order** also requires all review acknowledgements and then opens the confirmed order with its PDF and in-app sending controls. A tax invoice is issued separately from **Orders & billing**. The audio is processed in memory and is not stored by the BoloVyapar backend.

Groq retired the originally planned Llama models for free and developer accounts in August 2026. The configured account does not list a general-purpose Llama model, so the working default is `openai/gpt-oss-120b` on Groq. Set `GROQ_MODEL` to an accessible Llama model if the account later gains access. Extraction still requires the supplier's review; AI does not calculate the bill.

To compare transcription providers, create a JSON manifest of audio files on E: with `audio_path`, `mime_type`, `reference` (human-checked transcript) and `consent: true` for recorded people or `synthetic: true` for generated speech; run `npm run evaluate:asr -- E:\path\manifest.json`. The script sends each sample to Groq Whisper and Sarvam and reports word error rates without storing their audio or transcripts. To include AI4Bharat, host an [IndicConformerASR](https://github.com/AI4Bharat/IndicConformerASR) service privately that accepts multipart `file` and returns `{ "transcript": "...", "language_code": "..." }`; set `AI4BHARAT_ASR_URL` and optionally `AI4BHARAT_ASR_TOKEN` in `backend/.env`. AI4Bharat comparison requires separate model access and service hosting.

For a quick synthetic benchmark sample, run `npm run create:synthetic-voice`. It saves a generated Hindi WAV and manifest in `.tmp/voice-eval` on E:. The sample contains no recorded person. Because Sarvam generates this audio, its accuracy on the sample is not representative of supplier recordings or a fair provider comparison.

The API responds at `GET /api/health`. `GET /api/health/db` returns 200 when PostgreSQL responds to a query; it returns 503 when `DATABASE_URL` is missing or the connection fails. The mobile connection screen reports both states separately. A hosted Supabase database cannot be verified until credentials are provided.

The foundation migration creates `profiles`, `businesses`, and `retailer_links`. Milestone 2 migrations add authenticated onboarding, access policies, role protection, and scoped relationship functions.

## Checks

Run `npm run typecheck`, `npm run lint`, and `npm test` from the root. With a configured `backend/.env`, `npm run verify:auth-db` checks onboarding; `npm run verify:commerce-db` checks Milestone 3 schema, RLS and finality; and `npm run verify:commerce-api` exercises the supplier and retailer API. `npm run verify:voice-api` uses synthetic speech to check live Groq Whisper, Sarvam fallback, and Groq extraction while keeping its database records inside a rolled-back transaction. Build the API with `npm run build -w backend` and export the web app from `mobile` with `npx expo export --platform web`. The Android development client can be compiled and installed with `& .\scripts\dev-on-e.ps1 -Target android-build`.

## Layout

- `mobile/src/screens` — app screens and navigation destinations
- `mobile/src/components` and `mobile/src/theme` — reusable UI and design tokens
- `mobile/src/services` and `mobile/src/hooks` — API clients and responsive hooks
- `backend/src/routes` — HTTP route declarations
- `backend/src/controllers` — request and response handling
- `backend/src/services` — application logic
- `backend/src/config` — environment validation and logging
- `backend/src/database` — PostgreSQL connection
- `supabase/migrations` — versioned SQL changes

Future milestones will add live calling features.
