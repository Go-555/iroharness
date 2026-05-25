# Security Policy

IroHarness is an early OSS skeleton for character macro harnesses. Please avoid
posting exploitable vulnerabilities publicly before maintainers have had time to
respond.

## Supported Versions

Only the current `main` branch and the latest published npm version are
supported while the project is pre-1.0.

## Reporting

Open a private security advisory on GitHub when available. If that is not
available, open a minimal public issue that says a private report is needed
without disclosing exploit details.

Include:

- affected version or commit
- reproduction steps
- expected impact
- any suggested fix

## Scope

Security-sensitive areas include:

- platform identity resolution and permission checks
- micro-harness delegation
- process adapters
- OBS / stream controls
- filesystem-backed PJOS and character profile files
