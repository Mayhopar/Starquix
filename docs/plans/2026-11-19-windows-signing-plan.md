# Windows code signing — plan (draft)

Goal: `Starquix.exe` and `Starquix-Setup-<V>-<arch>.exe` carry a valid, timestamped Authenticode signature with a
named publisher, signed in CI (`windows.yml`) on release builds only. Linux packages stay unsigned (SHA-256 in the
release notes, as for the dmg).

## Constraint (checked 2026-11-19)

Azure Artifact Signing (formerly Trusted Signing) — Microsoft's own service, the preferred route:

- Public Trust for **individuals: US and Canada only**. For **organizations**: US, CA, EU, UK, AU, NZ, JP, KR, SG,
  CH, NO, IL ([quickstart](https://learn.microsoft.com/en-us/azure/artifact-signing/quickstart)).
- Needs a **paid** Azure subscription (no free/trial/sponsored). Basic **$9.99/month**, 5,000 signatures; billed
  from account creation, not prorated, even if identity validation then fails.
- Identity validation: a few days to ~4 weeks; cannot be expedited.
- A sole proprietorship in a supported country goes through the **organization** path. Microsoft documents no rule
  that it passes or fails; Q&A threads (NL, ES, DK, DE) report both outcomes.

**So an individual publisher outside US/Canada cannot use Artifact Signing as an individual.**

## Options

| | A. Artifact Signing (organization) | B. SignPath Foundation | C. CA certificate (cloud HSM) |
|---|---|---|---|
| Publisher shown | the registered business name | "SignPath Foundation" | "Open Source Developer, <name>" (Certum) |
| Cost | $9.99/mo | free (OSS) | ~€70+/yr, price unclear |
| Prereq | registered business in a supported country | OSI license, public repo, CI build, no proprietary parts, MFA, a code-signing policy page | ID check |
| CI fit | native in electron-builder 26 (`win.azureSignOptions`) | GitHub Action, manual approval per release | awkward (SimplySign TOTP) |
| Risk | validation rejected after paying | application rejected; publisher isn't Starquix | the "certificate shop" route |

**Recommendation:** A if a registered business exists or is wanted anyway (check local tax/legal effects first).
Otherwise B. C only if both fail. Microsoft Store (MSIX, Microsoft signs) is out: MSIX file-system virtualization
would conflict with `~/Starquix/` projects, node-pty shells and the symlinked `node_modules`.

Signing alone does not remove the SmartScreen warning on day one: reputation builds with downloads per
certificate/publisher (EV certificates lost their instant bypass in 2024 — from memory, re-check before relying on it).

## Steps — option A

1. **Azure (one-time, by hand):** paid subscription → Artifact Signing account (region e.g. West Europe; the endpoint
   follows the region, e.g. `https://weu.codesigning.azure.net/`) → identity validation (Public, Organization) →
   certificate profile (Public Trust).
2. **CI identity:** Entra app registration; role *Artifact Signing Certificate Profile Signer* on the profile.
   `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET` as secrets of a GitHub **Environment** `release` with
   a required reviewer (so a push to any branch cannot sign). OIDC federation instead of a secret is the upgrade.
3. **Workflow:** a `release` job (tag push or `workflow_dispatch`, environment `release`) runs the same matrix as
   `windows.yml` and signs via CLI overrides, so ordinary CI builds never try to sign:
   ```sh
   npx electron-builder --win nsis --${ARCH} --publish never \
     -c.win.azureSignOptions.publisherName="<exact certificate CN>" \
     -c.win.azureSignOptions.endpoint="https://weu.codesigning.azure.net/" \
     -c.win.azureSignOptions.codeSigningAccountName="<account>" \
     -c.win.azureSignOptions.certificateProfileName="<profile>"
   ```
4. **What gets signed — verify on the first run:** electron-builder signs `Starquix.exe`, the installer and the
   uninstaller. The bundle also ships third-party binaries unpacked (`asar: false`: esbuild, rolldown, sharp, node-pty's
   conpty). Decide whether to add `win.signExts` (`.dll`, `.node`) — count signatures per build against the 5,000/mo.
5. **Gate:** on the runner, `Get-AuthenticodeSignature` = `Valid` with a timestamp for the installed `Starquix.exe` and
   the installer; then by hand on a clean Windows VM: download → SmartScreen/UAC show the publisher → install → launch.
6. **RELEASE.md:** the Windows lines of the notes tail say "Signed by <publisher>".

## Steps — option B (if chosen)

Apply at signpath.org → add `CODE_SIGNING_POLICY.md` + MFA for every maintainer → SignPath project with an artifact
configuration that signs `Starquix.exe` first (build `--dir`, sign, then `electron-builder --prepackaged` builds the
NSIS installer around it), then signs the installer. Each release waits for a manual approval in SignPath.

## Open decisions

- A or B (above).
- Sign third-party `.dll`/`.node` files or only our executables (step 4).
