# myFinance — release README + GitHub Pages site

This folder drives the **public landing page** that is published to
`tokans/myFinance` on every release, right alongside the auto-generated
`README.md`. Both are produced by the **publish** job in
[`../workflows/release.yml`](../workflows/release.yml) — there is nothing to run
by hand beyond your normal `deploy.bat <version>`.

```
deploy.bat v1.2.3
   └─ tags + pushes  →  fires .github/workflows/release.yml
        ├─ build native installers (Win / macOS)
        ├─ publish a GitHub Release on tokans/myFinance
        ├─ rewrite README.md on tokans/myFinance        (default branch)
        └─ publish the landing page to gh-pages branch   ← this folder
```

## Files in this folder

| File | Purpose |
| --- | --- |
| `index.template.html` | The landing page. **Edit this to redesign the site.** Tokens `__VERSION__`, `__REPO__`, `__RELEASE_URL__`, `__LATEST_URL__` are substituted at publish time. |
| `preview.bat` | Renders the template with sample values and serves it locally so you can design it. |
| `sample-release-notes.md` | Stand-in release notes used only by `preview.bat`. |
| `.gitignore` | Ignores `.preview/` (the local render output). |

The release notes are **not** baked into the HTML: the page `fetch()`es a
sibling `release-notes.md` (written by the workflow from GitHub's
auto-generated notes) and renders it client-side with marked.js. That keeps
arbitrary markdown out of the HTML and means the notes update every release.

---

## One-time setup

Everything except the final toggle is already done. The full list, in order:

1. **`PUBLISH_TOKEN` secret** *(already configured)* — a PAT with
   `contents: write` on `tokans/myFinance`, stored as a repo secret on the
   source repo. The same token already powers the README push, so the Pages
   push needs nothing extra.
2. **Run one release** — `deploy.bat v0.1.0` (or any version). The workflow
   creates the `gh-pages` branch on `tokans/myFinance` the first time it runs.
3. **Enable Pages** on `tokans/myFinance` (do this once, after step 2 has
   created the branch):
   - Repo → **Settings → Pages**
   - **Build and deployment → Source:** *Deploy from a branch*
   - **Branch:** `gh-pages`  •  **Folder:** `/ (root)` → **Save**
4. Wait ~1 minute. The site is live at **https://tokans.github.io/myFinance/**.

After that, every `deploy.bat` run refreshes both the README and the site
automatically.

### (Optional) custom domain

To serve at e.g. `myfinance.app` instead of the `github.io` URL, add a file
named `CNAME` (containing just the domain) to the `gh-pages` branch and point
your DNS at GitHub Pages. The workflow clones the existing branch before
republishing, so a `CNAME` you add manually **survives** future releases.

---

## Designing the landing page

1. Edit [`index.template.html`](index.template.html). It is a single
   self-contained file (inline CSS + a little JS) — no build step.
2. Double-click **`preview.bat`** (or run it from a terminal). It:
   - copies the template to `.preview/index.html`, substituting sample values,
   - drops `sample-release-notes.md` next to it as `release-notes.md`,
   - copies `assets/` (incl. the demo video — see below),
   - serves at **http://localhost:8000/** and opens your browser.
3. Tweak, save, refresh the browser. Repeat.

> A local HTTP server is required — the page fetches `release-notes.md`, and
> `fetch()` is blocked on `file://`. `preview.bat` handles this via `serve.py`,
> which binds to loopback and auto-picks a free port (then opens your browser).
> It defaults to port 8000 but falls back automatically if that port is taken or
> blocked by Windows (`WinError 10013`). To force a port: `preview.bat 5500`.

**Keep the four tokens spelled exactly** (`__VERSION__`, `__REPO__`,
`__RELEASE_URL__`, `__LATEST_URL__`) wherever you want the per-release values —
the workflow replaces them with `sed`.

### Demo video

The **"See it in action"** section plays `assets/demo.mp4` (autoplay, muted,
looping, with controls). If the video fails to load, the whole section hides
itself, so the page stays clean.

The video is a **tracked file in this repo** at
[`assets/demo.mp4`](assets/demo.mp4). The release workflow copies the whole
`.github/pages/assets/` folder into the published site on every release, so
the video ships automatically — no manual step on the `gh-pages` branch.

- **To update the demo:** re-record it (the demo rig writes to `demo/output/`,
  which is git-ignored), then copy the chosen clip over the tracked file and
  commit it:
  ```bat
  copy /y demo\output\01-basic-import.mp4 .github\pages\assets\demo.mp4
  ```
  Keep it small (~1 MB) — it lives in git. Re-encode/trim before committing if
  it grows.
- **To preview locally:** nothing extra — `preview.bat` copies `assets/` into
  the preview so the video plays at `http://localhost:8000/`.

> The template references `assets/demo.mp4` relative to the site root. To swap
> in a different file name, change both the `<video src>` in
> `index.template.html` and the committed file.

---

## How the workflow builds the site (reference)

In the `publish` job of [`../workflows/release.yml`](../workflows/release.yml),
the **“Update GitHub Pages site”** step:

1. Reads this release's auto-generated notes via `gh release view`.
2. Clones the `gh-pages` branch of `tokans/myFinance` (creating it as an orphan
   branch the first time), preserving any `assets/`, `CNAME`, etc.
3. Writes the notes to `release-notes.md` and touches `.nojekyll`.
4. Copies `.github/pages/assets/` (incl. `demo.mp4`) into the site.
5. `sed`-substitutes the tokens in `index.template.html` (read from the
   source-repo checkout) into `index.html`.
6. Commits and pushes to `gh-pages`.

---

## Troubleshooting

| Symptom | Cause / fix |
| --- | --- |
| Site 404s after first release | Pages not enabled yet — do the one-time **Settings → Pages** toggle (branch `gh-pages`, root). |
| “What's new” shows the fallback link, not notes | `release-notes.md` failed to load. Check it exists on `gh-pages`; on a real release confirm `gh release view` returned a body. |
| Demo video doesn't play | Confirm `assets/demo.mp4` is committed in this repo and was copied to `gh-pages`. The section auto-hides if the file 404s. |
| Pages step fails to push | `PUBLISH_TOKEN` lacks `contents: write` on `tokans/myFinance`, or expired. |
| Custom domain reverts | Ensure `CNAME` is committed on `gh-pages` (the workflow preserves it; it can't create one it never saw). |
| Local preview is blank / notes missing | Open via `preview.bat`, not by double-clicking the HTML — `fetch()` needs `http://`. |
