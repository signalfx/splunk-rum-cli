# Changelog

All notable changes to this project will be documented in this file.

## Version 1.0.1

### Changed

- Updated API endpoint domain from `*.signalfx.com` to `*.observability.splunkcloud.com` for Android, iOS dSYM, and source map uploads (#145).

### Security

- Upgraded `axios` (1.8.2 → 1.13.2) and `glob` (11.0.0 → 11.1.0) to address security vulnerabilities (#143).
- Upgraded `axios` (→ 1.15.0) and `minimatch` (→ 10.2.5) to address security vulnerabilities (#148).
- Applied grouped security updates: `axios` (1.15.0 → 1.16.0), `form-data` (4.0.5 → 4.0.6), `picomatch` (2.3.1 → 2.3.2, CVE-2026-33671 / CVE-2026-33672), and `flatted` (3.3.1 → 3.4.2, CWE-1321) (#149).

### Maintenance

- Bumped `@typescript-eslint/eslint-plugin` from 8.14.0 to 8.64.0 (#130).
- Bumped `actions/setup-node` from 4.1.0 to 7.0.0 in CI (#128).

## Version 1.0.0

This is the first official release of the project.
