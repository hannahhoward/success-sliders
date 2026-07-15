# Success Sliders

A tiny web app for running the **project success sliders** exercise (Rob
Thomsett's trade-off sliders): a group individually sets the relative priority
of a project's success dimensions — on time, on budget, full scope, quality,
and so on — under a fixed point budget, so *everything can't be top priority*.
Comparing answers surfaces hidden disagreement about what actually matters.

**Live app:** <https://hannahhoward.github.io/success-sliders/>

## How it works

1. **Create an exercise.** Name it, pick the dimension labels (sensible
   defaults included), set the per-slider scale and the total point budget.
2. **Share the form link** with participants. Each person distributes the
   point budget across the sliders — raising one thing means lowering
   another — and submits with their name.
3. **Open the results link** (private — only for you). Watch responses arrive
   live, person by person or aggregated per dimension, with the spread made
   visible so disagreement is easy to spot.

## Privacy design

There are no accounts. Both links are *capability URLs* — access is knowing
the link:

- **Responses are end-to-end encrypted in the browser** (ephemeral-static
  ECIES: P-256 ECDH → HKDF-SHA256 → AES-256-GCM). The exercise stores only a
  public key; each response is encrypted against it with a fresh ephemeral
  key.
- **The decryption key lives only in the results link's URL fragment.**
  Fragments are never sent to any server — not to GitHub Pages, not to
  Firebase — so nobody but a results-link holder can read responses, including
  the people operating the infrastructure. The app also strips the key from
  the address bar on load.
- **The backend is Cloud Firestore with public, tightly-bounded rules:**
  anyone may create an exercise or submit a (ciphertext) response; nothing may
  ever be updated or deleted; exercise IDs can't be listed or enumerated
  (~119-bit random IDs).

**The results link is a bearer secret.** Treat it like a password: don't post
it in a group chat, and don't open it on a machine you don't trust. Losing it
means losing access to the results — the key is not stored anywhere else
(unless you let the app remember it in your browser, which you can undo with
"forget").

### Accepted v1 limitations

Deliberate trade-offs of the no-auth design — fine for a low-stakes workshop
tool, listed so they're conscious:

- **No sender authentication.** Anyone with the form link can submit under any
  name. The results view flags duplicate names and malformed submissions
  rather than hiding them, but impersonation is ultimately possible.
- **Ciphertext is publicly readable.** Anyone with the form link can observe
  how many responses exist, when they arrived, and their approximate size —
  but not their content.
- **Open writes.** A vandal could flood the free-tier write quota (the Spark
  plan throttles rather than bills). Rules bound document shape and size, but
  can't rate-limit anonymous clients.
- **No deletion or expiry.** Responses are immutable by design (nobody —
  including the facilitator — can tamper with or remove them via the API).
  Cleanup is manual, via the Firebase console.

## Self-hosting

Fork this repo, then:

1. Create a Firebase project (free Spark plan) and a Cloud Firestore database.
2. Deploy the rules: `npx firebase-tools deploy --only firestore`.
3. Register a web app in the project and paste its config into
   `js/firebase-config.js` (the `apiKey` is a public identifier, not a
   secret — access control is entirely in `firestore.rules`).
4. Enable GitHub Pages for the `main` branch root, and update the
   Content-Security-Policy in `index.html` and the source link in the footer
   if your hosting differs.

## Development

No build step, no dependencies to install: plain ES modules, Firebase JS SDK
pinned from the gstatic CDN, hash-based routing, one hand-written stylesheet.
Serve the directory with any static file server, e.g.
`python3 -m http.server`.

| Path | What it is |
|---|---|
| `js/crypto.js` | ECIES encryption/decryption (WebCrypto) |
| `js/firebase.js` | Firestore access (create / fetch / submit / live-watch) |
| `js/views/` | The three screens: create, respond, results |
| `firestore.rules` | The entire server-side security model |
| `tools/e2e/` | Live smoke test: crypto roundtrip + every rules denial (`npm i && node e2e.mjs '<config JSON>'`; leaves a few immutable test docs behind) |

## License

[MIT](LICENSE)
