# Security Policy

## Supported Versions

Entity is early public software. Security fixes target the default branch unless
a maintained release branch is announced.

## Reporting A Vulnerability

Do not file public issues that include secrets, tokens, private URLs, DB files,
logs with credentials, or screenshots of private infrastructure.

Report security issues privately to the maintainers. Include:

- affected version or commit
- reproduction steps
- impact
- any relevant logs with secrets removed

## Handling Sensitive Files

Never commit `.env`, DB files, WAL/SHM files, private config profiles, access
tokens, or machine-local runtime state. Use `.env.example` and
`entity.config.example.yaml` for placeholders only.
