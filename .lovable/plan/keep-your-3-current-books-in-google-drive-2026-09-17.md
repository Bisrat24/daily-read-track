# Keep your 3 current books in Google Drive

Let each reader connect their own Google Drive, keep up to 3 currently-reading
books there, and pick any of them up on another device with the reading position
already in the right place.

## What you'll see

In the "Sync progress" card (after signing in to your account):

- A **Connect Google Drive** button. It opens Google's own permission window;
  you approve once per device-independent account.
- Once connected, a **Books in Drive** list showing the titles stored in a
  `Pace Books` folder in your Drive, with the date each was saved.
- On each book in your library, an **Upload to Drive** action. Uploading a 4th
  book asks you to pick which of the three it replaces (Drive keeps at most 3).
- On a book that exists in Drive but not on this device, a **Get from Drive**
  action: it downloads the file, prepares it, and opens it at the exact word
  you reached elsewhere.
- A **Disconnect** action that removes the app's access to your Drive. Files
  already in your Drive stay yours.

Reading positions, calendar and settings keep syncing exactly as they do today;
Drive only adds the book files themselves.

## Behaviour rules

- Limit of 3 files in the app's Drive folder, enforced before every upload.
- Only PDF and EPUB files the app itself put there are listed (its own folder).
- A book already in Drive is replaced, not duplicated, when re-uploaded.
- If Google access expires, the card shows "Reconnect Google Drive" and reading
  continues normally on-device.
- Everything stays optional: without Drive the app works exactly as now.

## Technical notes

- Per-user access uses the Lovable App User Connector for `google_drive`
  (`connector_app_user--connect_client` links the workspace client), scopes
  `userinfo.email`, `userinfo.profile`, `drive.file` — `drive.file` limits the
  app to files it creates, so no access to the rest of the user's Drive.
- New `src/integrations/lovable/appUserConnector.ts` (server-only helper from
  Lovable knowledge) plus `src/server/connectionKeyCrypto.ts` and
  `src/server/appUserConnections.server.ts`.
- Migration adds `public.app_user_connections` (user_id, connector_id,
  connection_key_ciphertext, timestamps; service_role only, RLS on) to hold each
  user's encrypted Drive connection handle.
- Server functions in `src/server/drive.ts`, all behind `requireSupabaseAuth`:
  `startDriveConnect`, `completeAppUserConnection`, `driveStatus`,
  `listDriveBooks`, `uploadDriveBook` (multipart, resolves/creates the
  `Pace Books` folder, deletes oldest beyond 3), `getDriveBookContent`
  (base64 file bytes), `deleteDriveBook`, `disconnectDrive`.
- Popup callback route `src/routes/oauth/google-drive/return.tsx` posts the
  one-time code to the opener, which exchanges it server-side.
- Client: `src/components/reader/DrivePanel.tsx` inside the sync card; Library
  gains upload/fetch actions. Downloaded bytes go through the existing
  `parsers.ts` + `addBookToLibrary`, so remote placeholders adopt the synced
  position automatically.
- Uploads run through the server function, so file bytes are sent as base64 —
  practical for the typical book size; very large files are rejected with a
  clear message.
