# Changelog

Notable changes, newest first. Versions follow [semantic versioning](https://semver.org),
and the version in `package.json` is what the header and the About card display.

## 1.1.2 — 2026-08-25

- Merge the baby and person selectors into a single strip that sits with the
  tab bar instead of standing as its own band below it. On a phone the chips
  wrap under the tabs; from 700px up they sit beside them. The header is one
  row shorter, which is one row more of the Track screen.
- Drop the "Baby" and "Who" labels and the age line on the baby chips — the
  avatars carry the meaning, the hero card underneath already shows the age,
  and the chips keep it in their tooltip. Screen readers still hear both
  groups, and every chip says what it does ("Track Freddie", "Log as Mom").
- Add this changelog.

## 1.1.1 — 2026-08-24

- Show the author's name in `package.json`, and so in the About card.
- Reunite the deploy guidance with the security notice in the README.

## 1.1.0 — 2026-08-24

- Bring the baby and person selectors back into the sticky header, so the
  brand, theme toggle, tabs and both selector rows read as one block.
- Show the app name and version in the header. Name, version, author, licence
  and repository come from `package.json` and ship with the app state, so
  there is one source of truth.
- Add an About card at the end of Setup, linking to the repository, the README
  and the author, and restating the security posture.
- Add a security notice to the README: no authentication, no encryption, and
  none intended. Deploy behind a reverse proxy, with a worked nginx example
  that keeps the SSE stream unbuffered.

## 1.0.0 — 2026-08-24

- One-tap logging for feeds, diapers, sleep and anything else you define,
  with programmable alarms, plain-text storage and no dependencies.
- Top navigation across Track, History, Alarms and Setup.
- Optional 4-digit profile PINs, stored as salted scrypt hashes.
- Default to port 8477, and fail with a useful message when it is taken.
