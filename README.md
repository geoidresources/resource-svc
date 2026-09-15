# GEOID Storage

Vercel-ready Next.js app for browsing `gs://geoidresources` and uploading whole folders —
up to hundreds of GB — into it, using the same service account as `asset-svc` and
`workflow-geo-svc`. UI is shadcn/ui on Tailwind v4.

## Browsing model

One pane, breadcrumbs, no tree sidebar. Listing always uses a `/` delimiter and pages 500 at
a time, so a folder is one API call regardless of how much sits beneath it — `tilesets/`
alone holds tens of thousands of tile PNGs, and any design that recursed or counted children
would hang on it. Folder rows therefore show no size or date: GCS cannot give either without
walking the whole subtree.

| Area | Browse | Download | Upload / new folder |
|---|---|---|---|
| `uploads/` | yes | file or whole folder | yes |
| everything else | yes | file or whole folder | blocked, server-side |

`tilesets/`, `processed/`, `lidars/` and friends are live pipeline inputs, so writes are
confined to `UPLOAD_ROOT_PREFIX`. The rule is enforced in `/api/upload/init` and
`/api/folder`, not just hidden in the UI.

## How it works

Bytes never touch Vercel. A Vercel function has a **4.5 MB request body limit** and a
300 s (Pro) execution ceiling, so proxying 300 GB through it is impossible. Instead:

```
browser                     vercel function                 GCS
   |  POST /api/upload/init        |                          |
   |  (list of relative paths)     |                          |
   |------------------------------>|  v4-sign a resumable     |
   |                               |  init URL per object     |
   |<------------------------------|  (private key, no I/O)   |
   |                                                          |
   |  POST signed URL  (x-goog-resumable: start)              |
   |--------------------------------------------------------->|
   |<--------- Location: <session URI> ------------------------|
   |                                                          |
   |  PUT session URI, Content-Range: bytes 0-16777215/N      |
   |--------------------------------------------------------->|
   |<--------- 308, Range: bytes=0-16777215 -------------------|
   |  ... repeat until 200 ...                                |
```

The function only signs URLs — it is CPU-only and returns in milliseconds. The session URI
returned by GCS is self-authenticating and **valid for 7 days**, which is what makes a
multi-day 300 GB transfer survivable.

### Folder structure is preserved

`showDirectoryPicker()` is used where available (Chrome/Edge) because it walks the tree
lazily instead of materialising a 50 000-entry `FileList`. Other browsers fall back to
`<input webkitdirectory>`. Each file's path relative to the chosen folder becomes the
object key:

```
<UPLOAD_ROOT_PREFIX>/<destination prefix>/<path relative to the picked folder>
```

### Resume

Per-file state (session URI + committed offset) is persisted to IndexedDB, and the picked
directory handle is stored alongside it. Reopening the app offers to resume: it re-requests
folder permission, rescans, and continues. On resume each file's true offset is re-read from
GCS with a `bytes */N` probe rather than trusted from local state.

## Downloading

Bytes come back the same way they go out: the function signs, the browser transfers.

A single object is a signed read URL handed to the browser's own download manager, so it
survives the tab closing. A folder is a different problem — `COJAGField/` alone is 3 GB
across 224 objects — and gets a recursive listing (`/api/download/manifest`) plus read URLs
minted 100 at a time, just ahead of each transfer, so a multi-hour run never holds a URL
long enough for its signature to age out.

There are two destinations, offered once the folder has been sized:

| | Destination | Parallel | Pause / retry |
|---|---|---|---|
| Chrome, Edge | a folder picked on disk, tree preserved | 4 files | yes |
| any browser | one `.zip` | 1 file | no |

Saving into a folder is the one that scales: nothing is staged anywhere, and files already
present at the same size are skipped, so pointing at the same folder again resumes an
interrupted download instead of refetching tens of GB.

The zip is built by `src/download/zip.ts` — stored, never deflated, because laz, png and
jpeg are already compressed — and streams out entry by entry as the bytes arrive rather
than being assembled in memory. ZIP64 records kick in past 4 GiB or 65535 entries. Because
an archive is only valid once its central directory is written, that path cannot be paused
and a cancel discards it.

## Bucket permissions

The service account `geoidresources@geoidresources.iam.gserviceaccount.com` holds
`roles/storage.objectUser` on the bucket, plus a project-level `roles/storage.objectCreator`
left over from before. Verified against the live bucket:

| Operation | Result |
|---|---|
| Create, read, list, overwrite, delete objects | works |
| `storage.buckets.get` / update CORS | denied — `objectUser` is object-scoped |

Two things to keep in mind:

- **The bucket is world-readable.** `allUsers` holds `roles/storage.objectViewer`, so every
  object is public to anyone with the URL, including anything uploaded here. The Cesium
  viewer depends on this, so it cannot simply be revoked.
- **CORS still needs an admin login.** `objectUser` grants no bucket-level permission, so
  `npm run cors:apply` runs through `gcloud` as a human, not as the SA.

Uploads skip files already present at the same size and overwrite everything else.
Interrupted uploads resume safely: a resumable session does not create the object until it
is finalized.

## Setup

### 1. CORS

The bucket already allows `PUT`/`POST` from `*`, but its `responseHeader` list is missing
`Location` and `Range`. Without those two the browser cannot read the session URI or the
committed offset, and **no upload can start**. Inspect and apply with an admin login:

```bash
npm run cors:show
```

```bash
npm run cors:apply
```

The merge is additive — the existing `GET`/`HEAD` rule the Cesium viewer depends on is
preserved exactly.

### 2. Environment

Copy `.env.example` to `.env.local`. The `GCP_*` block is the same shape as
`asset-svc/.env`, with `GCP_PRIVATE_KEY` newlines escaped as `\n`.

| Variable | Purpose |
|---|---|
| `GCP_BUCKET`, `GCP_PROJECT_ID`, `GCP_EMAIL`, `GCP_PRIVATE_KEY`, `GCP_PRIVATE_KEY_ID`, `GCP_CLIENT_ID` | service account |
| `UPLOAD_ROOT_PREFIX` | every key is forced under this prefix; callers cannot escape it |
| `UPLOAD_ACCESS_CODE` | shared code required before any URL is signed |
| `SESSION_SECRET` | HMAC key for the session cookie (`openssl rand -hex 32`) |
| `SIGNED_URL_TTL_MINUTES` | init-URL lifetime, default 120 |

### 3. Verify the protocol against the real bucket

```bash
npm run smoke
```

Signs a URL, opens a session, uploads a multi-chunk object, checks the resume probe agrees
with the committed offset, and compares the round-tripped bytes.

### 4. Run

```bash
npm run dev
```

## Deployment

Live at **https://geoid-uploader.vercel.app** — Vercel project
`sabyasachim356-8744s-projects/geoid-uploader`.

Production uses its own access code and session secret, kept in `.env.production.local`
(gitignored) and separate from the local dev values in `.env.local`.

To push env changes and redeploy:

```bash
node scripts/push-env.mjs .env.production.local && npx vercel --prod --yes
```

`push-env.mjs` writes each value to stdin rather than through a shell, so the escaped `\n`
sequences in `GCP_PRIVATE_KEY` survive intact — passing that key through a shell is the
usual way it gets corrupted.

`.vercelignore` excludes `.env.local` and `.env.production.local` from the upload. This
matters: the repo is not a git checkout, so Vercel does not apply `.gitignore`, and Next
loads `.env.local` in production — an uploaded copy would silently override the dashboard
variables.

Nothing here needs a long-running function, a queue, or Blob storage — the only server work
is signing.

## Practical limits

- **Throughput is your uplink.** 300 GB at 100 Mbit/s is ~7 hours; at 1 Gbit/s ~45 minutes
  before overheads. The browser is rarely the bottleneck below ~500 Mbit/s.
- **Parallelism comes from files, not chunks.** The resumable protocol requires chunks of a
  single object to be sequential, so a lone 300 GB file cannot be parallelised here. Many
  files in a folder parallelise fine — 4 concurrent uploads is a good default, 8 the cap.
- **Chunk size** must be a multiple of 256 KiB; the app rounds down. 16 MB is a reasonable
  default. Larger chunks mean less overhead but more to re-send after a drop.
- Peak memory is roughly `parallel files × chunk size`.

### When to use gcloud instead

For a one-off bulk seed from a machine with a good link, this is faster and needs no
browser session held open:

```bash
gcloud storage rsync --recursive ./local-folder gs://geoidresources/uploads/dest-prefix
```

The web app earns its place for routine uploads by people without gcloud or bucket
credentials. Note `rsync` needs delete permission to mirror; plain `cp --recursive` does not.

## Security

- The access code gates every signing call; without a valid session cookie
  `/api/upload/init` returns 401 and mints nothing.
- Keys are built server-side. Path segments are validated (`..`, control characters and
  over-long segments rejected) and forced under `UPLOAD_ROOT_PREFIX`, so a caller cannot
  write outside it.
- The browser only ever holds short-lived per-object URLs. The private key stays on the
  server.
- The access code is a shared secret, not per-user identity. Put the deployment behind
  Vercel Authentication or SSO if you need real accountability.
# resource-svc
