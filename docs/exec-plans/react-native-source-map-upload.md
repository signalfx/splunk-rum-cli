# Add deterministic React Native source-map upload support

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This document must be maintained in accordance with the ExecPlan requirements and guidelines in the `execution-plan` skill.

## Purpose / Big Picture

After this change, a React Native release job can give `splunk-rum` one exact shipped JavaScript or Hermes bundle and its final matching Source Map v3 file. The CLI will validate the pair, compute deterministic hashes, upload the source map without browser bundle injection, and atomically write a versioned JSON manifest that the React Native agent can package into the application or OTA update.

The first observable workflow will be:

    splunk-rum react-native sourcemaps upload \
      --platform android \
      --engine hermes \
      --bundle-name index.android.bundle \
      --bundle android/app/build/generated/assets/createBundleReleaseJsAndAssets/index.android.bundle \
      --source-map android/app/build/generated/sourcemaps/react/release/index.android.bundle.map \
      --app-name ExampleApp \
      --app-version 2.4.0 \
      --app-build 123 \
      --application-id com.example.application \
      --code-bundle-id 8b868555-856f-4a6b-9315-5798d9ee7807 \
      --metadata-output build/splunk-rum-source-map.json \
      --realm us0

On success, the map will be stored under the existing content-derived source-map ID and `build/splunk-rum-source-map.json` will contain the exact map ID, the complete map and bundle SHA-256 hashes, and the release metadata required by the agent and backend. The CLI will never inject browser code into a React Native bundle.

This plan covers the core explicit React Native source-map upload first. Native artifact orchestration and Expo/EAS discovery are separate, later milestones because they depend on the stable manifest contract and, for Expo registration, a backend registry API that is not present in this repository.

## Progress

- [x] (2026-07-30) Read the React Native CLI integration design and extracted the required identities, validation rules, and build ordering.
- [x] (2026-07-30) Inspected the CLI command registration, source-map hashing and upload code, filesystem helpers, HTTP layer, tests, and CI commands.
- [x] (2026-07-30) Inspected an actual Android Hermes release bundle, final composed map, Metro packager map, and Hermes compiler map from the local React Native example.
- [x] (2026-07-30) Recorded a repository-specific phased implementation and acceptance plan.
- [x] (2026-07-31) Installed locked dependencies from the public npm registry and established a passing baseline: build and lint pass; 13 Jest suites and 63 tests pass with Watchman disabled.
- [x] (2026-07-31) Milestone 1 complete: introduced shared full hashing, typed React Native metadata, flat-map validation, final/intermediate Hermes evidence checks, deterministic manifest generation, synthetic fixtures, and 14 passing focused tests.
- [x] (2026-07-31) Milestone 2 complete: added `react-native sourcemaps upload`, extracted the shared single-map transport, preserved browser behavior, added atomic post-upload manifest writing, dry-run, strict validation, help, and workflow tests.
- [ ] Milestone 3 partially complete (2026-07-31: README and changelog added; real Android Hermes final/intermediate validation passed; real Android JSC and iOS Hermes/JSC fixtures remain).
- [ ] Milestone 4: add optional Android/iOS native release orchestration after the core command is stable.
- [ ] Milestone 5: add Expo/EAS update discovery and artifact-registry registration after the registry API contract exists.

## Surprises & Discoveries

- Observation: The repository has no dependencies installed, and its test script is named `test:unit`, not `test`.
  Evidence: `node_modules` is absent and `npm test -- --runInBand` reports `Missing script: "test"`. CI runs `npm ci`, `npm run build`, `npm run lint`, and `npm run test:unit`.

- Observation: The browser upload path cannot be reused as the React Native implementation entry point because it only accepts directory discovery, filters maps through `isJsMapFilePath`, and calls `wasInjectAlreadyRun` for every upload.
  Evidence: `src/sourcemaps/index.ts` filters for `*.js.map`, `*.cjs.map`, and `*.mjs.map` and warns when browser injection cannot be detected.

- Observation: The existing source-map ID function exposes only the shortened UUID-form ID, while the planned manifest also needs the complete SHA-256.
  Evidence: `src/sourcemaps/computeSourceMapId.ts` computes the full digest internally and returns only `shaToSourceMapId(sha)`.

- Observation: The integration design's example manifest contains `bundleSha256`, but its example `react-native sourcemaps upload` command does not accept a bundle path.
  Evidence: Section 5.1 of the design shows `bundleSha256` in JSON and only `--source-map` in the command.

- Observation: An actual final Android Hermes map is a flat Source Map v3 map and contains both original sources and Hermes metadata. The two intermediate maps each contain only part of that evidence.
  Evidence: The local final `index.android.bundle.map` has 840 sources, `x_facebook_sources`, and `x_hermes_function_offsets`. The packager map has original sources but no `x_hermes_function_offsets`; the compiler map has `x_hermes_function_offsets` but only one generated source.

- Observation: Source Map v3 structure cannot by itself prove that a map was composed from the exact bundle supplied to the CLI.
  Evidence: The final, packager, and compiler files are all valid flat version-3 maps with `sources`, `names`, and `mappings`. Final-map validation therefore needs strong heuristics, hashes, build-output selection guidance, and end-to-end symbolication fixtures rather than an unsupported claim of cryptographic proof.

- Observation: The workstation npm configuration redirects installs to Splunk Artifactory, where this session received HTTP 403 for `xmlbuilder`.
  Evidence: Plain `npm ci` failed at `https://repo.splunkdev.net/artifactory/api/npm/npm/xmlbuilder/-/xmlbuilder-11.0.1.tgz`; `npm ci --registry=https://registry.npmjs.org --replace-registry-host=always` installed the unchanged lockfile successfully.

- Observation: Jest attempts to use Watchman in this environment, but the sandbox prevents Watchman from changing its state-file permissions.
  Evidence: The ordinary test command failed in `watchman --no-pretty get-sockname` at `fchmod(.../watchman/alapaul-state, 2700)`. Adding Jest's `--no-watchman` option produced 13 passing suites and 63 passing tests.

- Observation: The user's default npm cache contains root-owned entries, which prevents `npm pack --dry-run` from creating its temporary cache file.
  Evidence: The default command failed with `EPERM` under `~/.npm/_cacache/tmp`. Repeating it with `--cache /private/tmp/splunk-rum-cli-npm-cache` succeeded and showed all new compiled React Native modules in the package.

## Decision Log

- Decision: Add a distinct top-level `react-native` command with a `sourcemaps upload` subcommand.
  Rationale: React Native accepts one explicit map and must never inherit browser injection, HTTP script URL, directory filtering, or injection-warning behavior. A separate namespace makes that safety property visible in help and code.
  Date/Author: 2026-07-30 / Codex

- Decision: Require both `--bundle` and `--source-map` for the core React Native command.
  Rationale: The manifest promises both hashes and must identify the exact shipped bundle/map pair. Requiring the bundle resolves the design-page inconsistency and allows later backend compatibility validation.
  Date/Author: 2026-07-30 / Codex

- Decision: Keep `sourceMapId`, `codeBundleId`, Android `splunk.build_id`, and iOS Mach-O UUID as separate identities.
  Rationale: A JavaScript or OTA release can change without a native build, and a mixed report can require both JavaScript and native artifacts.
  Date/Author: 2026-07-30 / Codex

- Decision: Continue using `PUT /v2/rum-mfm/source-maps/id/{sourceMapId}` and extend its multipart metadata rather than introduce a second map format or upload location.
  Rationale: The current ID algorithm and artifact endpoint already provide deterministic, idempotent storage. Backend owners must ratify acceptance and persistence of the additional React Native metadata before release.
  Date/Author: 2026-07-30 / Codex

- Decision: Upload and authentication failures always fail the command. `--strict` controls whether compatibility warnings, such as suspicious Hermes map composition, are promoted to failures.
  Rationale: Release policy requires artifact upload to succeed. Making network failure optional would produce builds that claim symbolication readiness without an artifact. Strict mode remains useful for heuristics that cannot be guaranteed across every React Native/Hermes version.
  Date/Author: 2026-07-30 / Codex

- Decision: Reject indexed maps containing `sections` in the first implementation.
  Rationale: The current backend model supports flat `sources`, `names`, and `mappings`. Silent acceptance would defer failure until an error needs symbolication. Flattening can be added later only with a tested library and byte-for-byte deterministic output.
  Date/Author: 2026-07-30 / Codex

- Decision: Write the manifest only after successful upload, using an atomic temporary-file-and-rename operation. In `--dry-run`, print the candidate manifest but do not upload or create the output file.
  Rationale: A packaged manifest is a claim that the matching artifact is available. Atomic writing prevents a terminated build from packaging partial JSON, while dry-run remains non-mutating.
  Date/Author: 2026-07-30 / Codex

- Decision: Treat native release orchestration and Expo/EAS support as follow-on commands, not hidden behavior in the core uploader.
  Rationale: Android manifest/R8 and iOS dSYM upload can reuse current modules after the JS contract is stable. Expo needs platform-output discovery and an update-to-map registry endpoint that is not yet defined in this repository.
  Date/Author: 2026-07-30 / Codex

## Outcomes & Retrospective

Planning is complete. The plan defines the core CLI command, exact files and interfaces, validation behavior, manifest contract, backend dependency, incremental milestones, and observable acceptance. No product source code has been changed.

The main implementation risk is overclaiming that the CLI can always identify a final Hermes-composed map from JSON fields. The plan handles this with explicit bundle/map inputs, known-intermediate rejection, Hermes evidence checks, strict mode, and golden end-to-end fixtures. Backend acceptance of the new multipart metadata and an Expo registry endpoint remain external dependencies.

Milestones 1 and 2 now produce the core observable command. Build and lint pass, 18 Jest suites with 82 tests pass, the synthetic dry-run is non-mutating, and the real Android Hermes final map passes strict validation while both intermediate maps fail. No production artifact upload has been attempted because backend acceptance of the additional multipart metadata has not yet been confirmed.

## Context and Orientation

The repository is a Node.js 18+ TypeScript command-line application. `src/index.ts` creates the Commander program and registers the current `ios`, `android`, and browser-oriented `sourcemaps` commands. `src/commands/sourcemaps.ts` defines browser injection and directory upload options. `src/sourcemaps/index.ts` discovers files, computes IDs, performs browser injection checks, and calls the generic multipart uploader in `src/utils/httpUtils.ts`.

The current source-map ID is deterministic: SHA-256 is calculated over the exact map bytes, the first 32 hexadecimal characters are split as `8-4-4-4-12`, and the resulting UUID-shaped value is used in `/v2/rum-mfm/source-maps/id/{sourceMapId}`. The full digest is currently discarded.

A Source Map v3 file is JSON that maps generated runtime positions to original source positions. A flat map has top-level `version`, `sources`, `names`, and `mappings`. An indexed map instead has top-level `sections`; it is not supported by the current backend and must be rejected. A final Hermes-composed map combines Metro's original-source mapping with Hermes compiler coordinates. Uploading only Metro's packager map or only Hermes' compiler map cannot resolve a release stack all the way to the original TypeScript or JavaScript source.

The React Native manifest is a build-time sidecar. It contains no access token and is safe to package into the application. At runtime, the agent reads it and attaches the exact `sourceMapId` and `codeBundleId` to error telemetry. `sourceMapId` identifies one exact map file. `codeBundleId` identifies one logical JavaScript release and changes for an OTA update even when the native application version does not.

The existing upload endpoint accepts a multipart file and optional `appName` and `appVersion`. The new command will send additional multipart fields. Before production release, the backend contract must confirm that these fields are accepted and stored:

    schemaVersion
    platform
    jsEngine
    bundleName
    codeBundleId
    sourceMapSha256
    bundleSha256
    appName
    appVersion
    appBuild
    applicationId

The repository uses Jest through `ts-jest`, ESLint, and TypeScript strict mode. CI's authoritative local checks are `npm run build`, `npm run lint`, and `npm run test:unit`.

## Plan of Work

### Milestone 1: Pure artifact inspection and manifest generation

First isolate deterministic logic from command handling and network access. Refactor `src/sourcemaps/computeSourceMapId.ts` so it can return the full SHA-256 and derive the existing source-map ID without changing browser behavior. Export functions with these intended signatures:

    export async function computeFileSha256(
      filePath: string,
      readErrorContext: FileReadErrorContext
    ): Promise<string>;

    export function sha256ToSourceMapId(sha256: string): string;

    export async function computeSourceMapId(
      sourceMapFilePath: string,
      options: SourceMapInjectOptions
    ): Promise<string>;

The existing `computeSourceMapId` remains a compatibility wrapper so current browser tests and callers do not change behavior.

Create `src/reactNative/types.ts` for closed string unions and the versioned manifest. The public types should include:

    export type ReactNativePlatform = 'android' | 'ios';
    export type ReactNativeJsEngine = 'hermes' | 'jsc';

    export interface ReactNativeSourceMapManifestV1 {
      schemaVersion: 1;
      platform: ReactNativePlatform;
      jsEngine: ReactNativeJsEngine;
      bundleName: string;
      codeBundleId: string;
      sourceMapId: string;
      sourceMapSha256: string;
      bundleSha256: string;
      appName: string;
      appVersion: string;
      appBuild: string;
      applicationId?: string;
    }

Create `src/reactNative/validateSourceMap.ts`. It will read and parse the explicit map file, require `version === 3`, require a nonempty `sources` array and string `mappings`, require `names` to be an array when present, and reject top-level `sections`. It will return a structured validation result containing errors, warnings, and non-sensitive evidence used by debug logs.

For `engine=hermes`, fail immediately for filenames that are known React Native intermediate outputs such as `.packager.map` and `.compiler.map`. Check for both original-source evidence and Hermes compiler evidence. The local React Native version uses `x_hermes_function_offsets` as compiler evidence and multiple original sources as composition evidence. Absence of this evidence is a warning normally and an error under `--strict`, because Hermes versions can evolve. For `engine=jsc`, the presence of Hermes compiler metadata is an engine mismatch error.

Create `src/reactNative/createSourceMapManifest.ts`. It will validate nonempty user metadata, calculate complete map and bundle hashes, derive `sourceMapId`, and return a `ReactNativeSourceMapManifestV1`. It must not read environment secrets or perform network operations.

Create small checked-in fixtures under `test/fixtures/react-native/`: a flat JSC map, a representative final Hermes map, a packager-only map, a compiler-only map, an indexed map, malformed JSON, and tiny corresponding bundle files. Fixtures should be synthetic and contain no application source or confidential paths.

Add unit tests in `test/reactNative/validateSourceMap.test.ts`, `test/reactNative/createSourceMapManifest.test.ts`, and extend `test/sourcemaps/computeSourceMapId.test.ts`. The tests must prove hash compatibility with the existing algorithm, full-digest output, flat-map acceptance, indexed-map rejection, malformed-map diagnostics, Hermes intermediate detection, strict-mode behavior, JSC/Hermes mismatch handling, and stable manifest serialization.

This milestone is complete when pure tests construct the exact expected manifest without network access and all existing browser source-map ID tests still pass.

### Milestone 2: Explicit React Native upload command

Create `src/commands/reactNative.ts` with a top-level `react-native` command and nested `sourcemaps upload`. Register it in `src/index.ts`.

The upload command will require:

    --platform <android|ios>
    --engine <hermes|jsc>
    --bundle-name <name>
    --bundle <file>
    --source-map <file>
    --app-name <name>
    --app-version <version>
    --app-build <build>
    --metadata-output <file>
    --realm <realm>

It will accept:

    --application-id <id>
    --code-bundle-id <id>
    --token <token>
    --strict
    --dry-run
    --debug

The token will use the same `--token` or `SPLUNK_ACCESS_TOKEN` resolution as existing commands, and realm will use `--realm` or `SPLUNK_REALM`. Platform and engine values will be rejected by Commander before work begins. When no override is supplied, `codeBundleId` is derived as `sha256:<bundleSha256>`. OTA providers can supply their own stable opaque identity with `--code-bundle-id`.

Extract the single-map transport portion of `src/sourcemaps/index.ts` into a reusable function, preferably `src/sourcemaps/uploadSourceMap.ts`:

    export interface UploadSourceMapOptions {
      sourceMapPath: string;
      sourceMapId: string;
      realm: string;
      token: string;
      metadata: Record<string, string | number>;
      dryRun?: boolean;
    }

    export async function uploadSourceMap(
      options: UploadSourceMapOptions,
      context: SourceMapUploadContext
    ): Promise<void>;

The current browser directory uploader will call this function and retain its existing injection warning. The React Native uploader will call it without `wasInjectAlreadyRun`, because browser injection is explicitly forbidden.

Create `src/reactNative/uploadSourceMap.ts` as the React Native workflow coordinator. It will:

1. validate CLI fields and file readability;
2. inspect the map and apply normal or strict compatibility policy;
3. construct the manifest and multipart metadata;
4. print validation warnings without leaking tokens or map contents;
5. on dry-run, print the candidate JSON and stop;
6. upload the map by exact `sourceMapId`;
7. atomically write the manifest only after upload succeeds;
8. log the map ID and manifest path.

Add an atomic JSON writer to `src/utils/filesystem.ts` or a focused `src/reactNative/writeManifest.ts`. It will create the parent directory, write a same-directory temporary file, and rename it over the destination. A retry with the same inputs will produce identical JSON and safely replace the prior manifest.

Add command-shape tests in `test/commands/reactNative.test.ts` and workflow tests in `test/reactNative/uploadSourceMap.test.ts`. Mock the HTTP boundary rather than Axios internals when testing workflow order. Extend HTTP tests only as needed to prove all metadata is added to multipart form data. Tests must prove no browser injection check occurs, no manifest is written on upload failure, dry-run performs no upload or write, and retry is idempotent.

This milestone is complete when a synthetic `.bundle.map` or `.jsbundle.map` can be supplied explicitly, upload is mocked successfully, and the resulting JSON exactly matches the expected contract.

### Milestone 3: Documentation and real release fixtures

Update `README.md` with a React Native section that explains the safe build order: generate the final bundle and map, run the upload command, package the manifest, then publish the application. Explicitly warn not to use `sourcemaps inject` for React Native and not to upload `.packager.map` or `.compiler.map`.

Add a changelog entry describing the new command and contract. Document environment variables, token secrecy, strict mode, dry-run behavior, manifest fields, and examples for Android/iOS with Hermes/JSC.

Use the local React Native example to perform an Android Hermes dry run against:

    splunk-otel-react-native/example/android/app/build/generated/assets/createBundleReleaseJsAndAssets/index.android.bundle
    splunk-otel-react-native/example/android/app/build/generated/sourcemaps/react/release/index.android.bundle.map

Expect the final map to pass and the `.packager.map` and `.compiler.map` paths to fail as known intermediate files. Record only hashes, IDs, validation summaries, and file basenames in the ExecPlan; do not commit the large generated artifacts.

Add or obtain equivalent golden fixtures for Android JSC, iOS Hermes, and iOS JSC before declaring those combinations supported. If a platform fixture is unavailable, keep that combination documented as unverified rather than inferring support from Android Hermes.

This milestone is complete when the built local CLI help exposes the new command, all four documented platform/engine combinations have fixture evidence, and an Android Hermes release dry run produces a stable ID and manifest candidate.

### Milestone 4: Optional native release orchestration

After the explicit source-map command is stable, add `splunk-rum react-native upload`. The Android form will reuse the current packaged-manifest extraction and ProGuard upload functions, then invoke the React Native source-map workflow. The iOS form will reuse current dSYM discovery/upload and then invoke the same source-map workflow.

Do not duplicate Android or iOS transport code. Refactor command actions into callable workflows first, preserving their existing commands and tests. The combined manifest may reference native identities, but it must preserve their separate names and must never assign a source-map ID to `splunk.build_id` or a Mach-O UUID.

This milestone requires release-policy tests showing that a missing mapping under Android minification, a missing dSYM for an iOS archive, or a failed JS map upload prevents the combined command from claiming success.

### Milestone 5: Expo/EAS updates

Add Expo support only after the backend exposes and documents an artifact-registry operation that can persist:

    expoProjectId + platform + runtimeVersion + expoUpdateId + codeBundleId -> sourceMapId

Create `splunk-rum react-native expo-update upload` as an adapter over the core explicit uploader. It will discover one platform-specific bundle/map pair in an existing EAS export; it will not regenerate the export. It will require Expo project, update, runtime, platform, engine, and code-bundle identities and will register the association only after map upload succeeds.

The Expo workflow must be tested with two updates sharing one runtime version, partial rollout, rollback, and delayed reporting. The test must prove each update keeps its own map and that no lookup relies solely on channel, app version, or runtime version.

## Concrete Steps

All commands run from:

    cd /Users/alapaul/Desktop/Projects/splunk/splunk-rum-cli

Before editing product code:

    npm ci
    npm run build
    npm run lint
    npm run test:unit -- --runInBand --no-watchman

Expected baseline:

    TypeScript build exits 0.
    ESLint exits 0.
    Existing Jest suites pass.

If baseline tests fail before implementation, record the exact failure in `Surprises & Discoveries` and distinguish it from new failures.

Implement Milestone 1, then run focused and full checks:

    npm run test:unit -- --runInBand --no-watchman test/sourcemaps/computeSourceMapId.test.ts
    npm run test:unit -- --runInBand --no-watchman test/reactNative
    npm run build
    npm run lint
    npm run test:unit -- --runInBand --no-watchman

Implement Milestone 2 and inspect help:

    npm run build
    node dist/index.js react-native --help
    node dist/index.js react-native sourcemaps upload --help

Expected help contains the exact required options and says the command does not modify the bundle.

Exercise a synthetic dry run:

    node dist/index.js react-native sourcemaps upload \
      --platform android \
      --engine hermes \
      --bundle-name index.android.bundle \
      --bundle test/fixtures/react-native/final-hermes.bundle \
      --source-map test/fixtures/react-native/final-hermes.bundle.map \
      --app-name ExampleApp \
      --app-version 2.4.0 \
      --app-build 123 \
      --application-id com.example.application \
      --code-bundle-id 8b868555-856f-4a6b-9315-5798d9ee7807 \
      --metadata-output build/test-splunk-rum-source-map.json \
      --realm us0 \
      --token fake-dry-run-token \
      --dry-run

Expected behavior:

    The command exits 0.
    It prints a schemaVersion 1 manifest candidate.
    The sourceMapId is derived from sourceMapSha256.
    No network call occurs.
    build/test-splunk-rum-source-map.json does not exist.
    The token is absent from all output.

Run a mocked upload integration test and expect the output file to appear only after the mock upload succeeds. Then rerun with the same inputs and expect byte-identical JSON.

Before each milestone stops:

    npm run build
    npm run lint
    npm run test:unit -- --runInBand --no-watchman
    git diff --check
    git status --short

Update `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` with evidence from that milestone.

## Validation and Acceptance

The core feature is accepted when all of the following are observable:

1. `splunk-rum react-native sourcemaps upload --help` exists and accepts one explicit bundle/map pair without any filename-extension restriction.
2. The command never modifies the bundle and never invokes browser source-map injection or injection detection.
3. Repeating the command with identical files produces identical full SHA-256 values and the same source-map ID.
4. The manifest contains `schemaVersion`, platform, engine, bundle name, code-bundle ID, exact source-map ID, complete map hash, complete bundle hash, app name, version, build, and optional application ID, and contains no token.
5. Flat Source Map v3 fixtures succeed; malformed and indexed maps fail with clear user-facing errors.
6. Known `.packager.map` and `.compiler.map` Hermes intermediates fail. A representative final composed Hermes map succeeds. Suspicious but not conclusively invalid Hermes maps warn normally and fail under `--strict`.
7. Upload/authentication failure exits nonzero and leaves no manifest that could be packaged.
8. Dry-run performs no network or filesystem mutation and prints enough structured information to verify the candidate.
9. The existing browser `sourcemaps inject` and `sourcemaps upload` tests remain unchanged in behavior.
10. Build, lint, and all unit tests pass on Node 20, matching CI.

The feature is production-ready only after the backend confirms acceptance, storage, and retrieval of the additional multipart metadata and an end-to-end release stack maps through the uploaded final artifact.

## Idempotence and Recovery

Hashing and manifest construction are deterministic and safe to repeat. The content-derived upload URL makes repeated upload of the same map an idempotent operation; the backend must treat an existing identical map as success. Atomic manifest replacement prevents partial JSON.

If upload succeeds but the local manifest write fails, rerun the same command. It will address the same `sourceMapId`, repeat an idempotent upload, and retry the local write. If validation fails, do not rename or copy an intermediate map to bypass it; fix the build output path or use non-strict mode only for a documented Hermes-version compatibility warning.

Do not delete or rewrite user build outputs. Tests must use temporary directories or checked-in synthetic fixtures. Never log or persist `SPLUNK_ACCESS_TOKEN`.

## Artifacts and Notes

The local Android Hermes release inspected during planning produced this evidence:

    final index.android.bundle.map:
      version: 3
      sources: 840
      names: 4226
      mappings length: 1121556
      indexed sections: absent
      extra keys: x_facebook_sources, x_google_ignoreList, x_hermes_function_offsets

    index.android.bundle.packager.map:
      sources: 852
      x_facebook_sources: present
      x_hermes_function_offsets: absent

    index.android.bundle.compiler.map:
      sources: 1
      x_hermes_function_offsets: present
      original-source composition evidence: absent

The final local map SHA-256 was:

    2e5196bc3d4001186aa79c316c9a38ff0104c9b259736317b0bdf169d17002a8

The exact local bundle SHA-256 observed during initial planning was:

    59d489192f84864ebbb993520154a1229354f7cc33b963daba57ce22fadf6636

These values are diagnostic evidence only and must not become hard-coded test expectations because the example build changes as its source changes.

The implementation dry-run on 2026-07-31 observed the same map hash and source-map ID, while the regenerated bundle hash had changed:

    sourceMapId: 2e5196bc-3d40-0118-6aa7-9c316c9a38ff
    sourceMapSha256: 2e5196bc3d4001186aa79c316c9a38ff0104c9b259736317b0bdf169d17002a8
    bundleSha256: 2a01fcf90198fd2449f5486889e962f950c488c95045963706803f3741662c31

This demonstrates why the bundle hash is release-specific even when a retained generated map happens to be unchanged.

## Interfaces and Dependencies

Use the existing Node.js `crypto`, `fs`, and `path` modules. Do not add a hashing dependency. Use the existing `axios`, `form-data`, Commander, logger, spinner, API interceptor, and `uploadFile` utilities.

No source-map decoding library is needed in the CLI. The CLI validates artifact structure and identity; the backend performs coordinate mapping. Do not add browser injection or source-map rewriting to the React Native workflow.

At the end of Milestone 2, these interfaces must exist, with names adjusted only if repository conventions strongly justify it:

    export type ReactNativePlatform = 'android' | 'ios';
    export type ReactNativeJsEngine = 'hermes' | 'jsc';

    export interface ReactNativeSourceMapManifestV1 {
      schemaVersion: 1;
      platform: ReactNativePlatform;
      jsEngine: ReactNativeJsEngine;
      bundleName: string;
      codeBundleId: string;
      sourceMapId: string;
      sourceMapSha256: string;
      bundleSha256: string;
      appName: string;
      appVersion: string;
      appBuild: string;
      applicationId?: string;
    }

    export interface ReactNativeSourceMapUploadOptions {
      platform: ReactNativePlatform;
      engine: ReactNativeJsEngine;
      bundleName: string;
      bundlePath: string;
      sourceMapPath: string;
      appName: string;
      appVersion: string;
      appBuild: string;
      applicationId?: string;
      codeBundleId?: string;
      metadataOutputPath: string;
      realm: string;
      token: string;
      strict?: boolean;
      dryRun?: boolean;
    }

    export async function createReactNativeSourceMapManifest(
      options: ReactNativeSourceMapUploadOptions
    ): Promise<ReactNativeSourceMapManifestV1>;

    export async function runReactNativeSourceMapUpload(
      options: ReactNativeSourceMapUploadOptions,
      context: SourceMapUploadContext
    ): Promise<ReactNativeSourceMapManifestV1>;

The backend dependency is the existing source-map PUT endpoint plus acceptance of the React Native metadata fields listed in `Context and Orientation`. Expo support additionally depends on an artifact-registry endpoint; do not invent its URL or silently encode registry relationships into unrelated metadata.

Revision note (2026-07-30): Initial plan created after inspecting the agreed Confluence design, the current CLI source and test structure, and local final/intermediate Android Hermes artifacts. The plan requires `--bundle`, separates the core uploader from later orchestration and Expo work, and treats final-Hermes-map detection as evidence-based validation rather than an absolute Source Map v3 guarantee.

Revision note (2026-07-31): Recorded the dependency-install workaround and passing baseline. Local validation commands use Jest's `--no-watchman` option because Watchman cannot update its state permissions in the sandbox.

Revision note (2026-07-31): Completed Milestone 1. The existing source-map ID remains byte-compatible while the full digest is now reusable; synthetic Hermes/JSC fixtures cover flat, indexed, malformed, intermediate, and engine-mismatch cases.

Revision note (2026-07-31): Completed Milestone 2 and part of Milestone 3. The explicit command, shared upload transport, atomic manifest workflow, documentation, and tests are in place. Real Android Hermes strict validation passed for the final map and rejected both intermediate maps; other real platform/engine fixtures and backend metadata confirmation remain.

Revision note (2026-07-31): Added packaging evidence. `npm pack --dry-run` succeeds with an isolated temporary npm cache and includes the compiled command, React Native workflow, validation, manifest, and shared transport modules.

Revision note (2026-07-31): Android Gradle dry-run integration exposed that
the shared stream helper decoded files as UTF-8. That changed the digest of
binary Hermes bytecode even though text source-map hashes remained correct.
`computeFileSha256` now consumes a raw byte stream, with a binary regression
test. A real Hermes release manifest's `bundleSha256` and `sourceMapSha256`
match `shasum -a 256`. React Native dry-run also no longer requires a realm or
production access token; upload mode retains both requirements.

Revision note (2026-07-31): Embedded releases no longer require a caller-created
code-bundle ID. The manifest derives it deterministically as
`sha256:<bundleSha256>`. `--code-bundle-id` remains an optional override for
Expo/EAS and other OTA providers.
