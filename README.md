# Pace — Speed Reading Trainer

Upload a PDF or EPUB and read it with a pacing engine that starts at a comfortable
words-per-minute and ramps up to your target. Pace tracks how many pages and words
you read each hour and each day, draws them on a calendar, and can back everything
up to your account so it follows you across devices.

Everything works offline: books are parsed and stored on your own device.

---

## Using the app

1. **Add a book** — tap *Add book* and pick a PDF or EPUB. It's parsed on-device
   and added to your library. Large books are stored in the browser database, so
   they reopen instantly without re-processing.
2. **Pick a reading mode**
   - **RSVP** — one word at a time in a fixed spot.
   - **Chunk** — a few words at a time (chunk size is adjustable).
   - **Bionic** — full page, with the first letters of each word bolded.
   - **Normal** — plain page with the current word highlighted; tap any word to
     start from there.
3. **Set your pace** — starting WPM, target WPM, and how many minutes to ramp
   between them. Extra dwell time is added automatically for punctuation,
   long words, and hyphenated compounds (adjustable).
4. **Play / pause**
   - Keyboard: **Space** = play/pause, **←/→** = one word, **Shift+←/→** = five words.
   - Touch: **double-tap** the page.
   - Settings collapse while playing and reopen when you pause.
5. **Seek** — drag the progress bar, jump by chapter, or use *Jump to page*.
6. **Read aloud** (optional) — natural sentence-level speech with voice, speed,
   and pitch controls; the highlight follows the spoken word.
7. **Stay awake** — the screen is kept lit during playback (native wake lock, with
   media-session and canvas fallbacks). A badge shows which method is active.

## Progress tracking

- The top bar shows **pages and words in the last hour** and **totals for today**
  (a page = 250 words, so PDFs and EPUBs count the same way).
- The calendar colours each day by how much you read, so streaks are visible.
- *Export* writes a JSON backup; *Import* accepts a file via picker or drag-and-drop
  (merge or replace).

## Sync across devices

Open **Sync progress** and sign in with Google or email.

- Backs up automatically while you read, and on sign-in / when the app goes to
  the background.
- Carries **book titles, per-book progress, the reading calendar (including the
  last-hour and daily page counts), and your settings**.
- Book *files* stay on the device that added them. A title synced from another
  device appears greyed out as *File not on this device*; add the same file there
  and it snaps to the position you left off at.
- Restoring merges — local reading is never lost.

## Install on a phone

The app is installable (PWA). Open it in the browser and choose
*Add to Home Screen* / *Install app*. It then runs full-screen and works offline.

---

## Running the code locally

Requirements: Node.js 20+ (or Bun).

```bash
npm install
npm run dev      # http://localhost:8080
npm run build    # production build
```

Tech: React 19 + TanStack Start, Vite, Tailwind CSS v4, pdfjs-dist + JSZip for
parsing, IndexedDB + localStorage for on-device data, and a hosted backend
(Postgres + auth) for optional sync.

### Environment

Sync needs these values (already present in `.env` for this project):

```
VITE_SUPABASE_URL=...
VITE_SUPABASE_PUBLISHABLE_KEY=...
```

Without them, the app still runs fully offline — only cloud sync is disabled.

### Backing the code up to GitHub

In Lovable, open the top-right **GitHub** menu and choose *Connect to GitHub*.
This creates a repository and pushes the project, then keeps it in sync with
every change. After that, standard `git clone` / `git pull` works locally.

## Project layout

```
src/routes/index.tsx              app shell: library, stats, calendar, reader
src/components/reader/            Uploader, Library, SpeedReader, StatsBar,
                                  ProgressCalendar, SyncPanel
src/lib/parsers.ts                PDF/EPUB text + chapter extraction
src/lib/library.ts                multi-book library and positions
src/lib/stats.ts                  reading events, pages/day, settings, export
src/lib/sync.ts                   cloud backup, merge, auto-sync
src/lib/speech.ts                 natural read-aloud engine
src/lib/wakeLock.ts               keep-screen-awake strategies
```
