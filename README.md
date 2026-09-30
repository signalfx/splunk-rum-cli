![Status](https://img.shields.io/badge/status-under%20development-informational?style=for-the-badge)
![Build Status](https://img.shields.io/github/actions/workflow/status/signalfx/splunk-rum-cli/.github/workflows/ci.yml?branch=main&style=for-the-badge)
![GDI Specification](https://img.shields.io/badge/GDI-1.7.0-blueviolet?style=for-the-badge)
![NPM](https://img.shields.io/npm/v/@splunk/rum-cli?style=for-the-badge)
![Node](https://img.shields.io/node/v/@splunk/rum-cli?style=for-the-badge)

# Splunk RUM CLI

The Splunk RUM CLI is a tool for uploading Android mapping files, iOS dSYM files, and browser source map files to the Splunk Observability Cloud back end for deobfuscating or symbolicating stack traces. This tool is part of the Splunk Real User Monitoring (RUM) suite.

## Features

* Uploading and listing of Android Proguard mapping files
* Uploading and listing of iOS dSYM mapping files
* Performing JavaScript bundle modifications to enable automatic source mapping
* Uploading JavaScript source map files
* Validating and uploading exact React Native Hermes and JSC source maps without browser bundle injection

## Documentation

For official documentation on the Splunk RUM CLI, see
[Install the splunk-rum CLI](https://quickdraw.splunk.com/redirect/?product=Observability&location=rum.buildintegration&version=current)

## Getting Started

To install the CLI from npm, run:
```
npm install -g @splunk/rum-cli
```

After installing, for an overview of the splunk-rum CLI and available commands, run:
```
splunk-rum
```

## Build and Development

To build locally, run:

```
npm install
npm run build
npm link
```

You can now run `splunk-rum` locally from the command line:
```
splunk-rum --version
```

To develop locally, you can use the `build:watch` script to automatically rebuild the project as you make changes:
```
npm run build:watch
```

## React Native source maps

React Native release builds must use the explicit `react-native sourcemaps upload`
command. Do not use `sourcemaps inject`: its browser snippet does not establish
identity for Hermes or JSC and modifying a generated bundle can invalidate its
source map.

First wrap the application's Metro configuration with
`@splunk/otel-react-native/metro`. Metro assigns a `sourceMapId` to each output
bundle. Generate the exact release bundle and final matching source map before
running the CLI.

### One explicit bundle/map pair

Use this mode when the final paths are already known. `--bundle-name` is
optional; the CLI otherwise uses the bundle filename (`index.android.bundle`
below).

```
splunk-rum react-native sourcemaps upload \
  --platform android \
  --engine hermes \
  --bundle android/app/build/generated/assets/createBundleReleaseJsAndAssets/index.android.bundle \
  --source-map android/app/build/generated/sourcemaps/react/release/index.android.bundle.map \
  --realm us0
```

### Discover conventional outputs

Use directory discovery when every final map is named `<bundle>.map`. The CLI
recursively finds co-located pairs and also supports React Native layouts where
the bundle and map live in separate directories but have the same unique
filename.

```
splunk-rum react-native sourcemaps upload \
  --platform android \
  --engine hermes \
  --artifacts-dir android/app/build/generated \
  --realm us0
```

Intermediate `.packager.map` and `.compiler.map` files are ignored. If a map
matches multiple same-named bundles, or multiple final maps match one bundle,
the command fails and asks for an explicit catalog instead of guessing.

### Explicit multi-bundle catalog

Use `--artifacts` for custom filenames, duplicate basenames in different
directories, or build pipelines where automatic pairing is intentionally too
ambiguous. Paths are resolved relative to the catalog file. `bundleName` is
optional and defaults to the bundle filename; provide it when stack frames use
a logical path such as `features/payments.android.bundle`.

```json
{
  "bundles": [
    {
      "bundle": "./build/index.android.bundle",
      "sourceMap": "./build/index.android.bundle.map"
    },
    {
      "bundleName": "features/payments.android.bundle",
      "bundle": "./build/payments.android.bundle",
      "sourceMap": "./build/payments.android.bundle.map"
    }
  ]
}
```

```
splunk-rum react-native sourcemaps upload \
  --platform android \
  --engine hermes \
  --artifacts ./splunk-rum-artifacts.android.json \
  --realm us0
```

The three input modes are mutually exclusive.

### Validation and upload behavior

For Hermes, always provide the final composed map, not an intermediate Metro or
Hermes compiler map. For every pair, the CLI:

1. validates ordinary flat Source Map v3 structure;
2. rejects obvious engine/map mismatches and optionally promotes warnings with
   `--strict`;
3. extracts `sourceMapId` from the exact executable bundle;
4. verifies the map's `sourceMapId` when the final composition preserved it;
5. when composition dropped the field, creates an upload-only temporary map
   copy carrying that ID—the generated bundle and map are never rewritten;
6. uploads each distinct map once, addressed by the exact `sourceMapId`.

No runtime manifest is generated or packaged by this command.

Run the same command with `--dry-run` first. It performs discovery, pairing,
source-map validation, and identity validation and prints the deterministic
artifact result without uploading or changing any files. Dry-run does not
require a realm or token.

For upload mode, prefer CI environment variables so the token is not stored in
shell history or build files:

```
SPLUNK_REALM=us0 \
SPLUNK_ACCESS_TOKEN=<CI secret> \
splunk-rum react-native sourcemaps upload \
  --platform ios \
  --engine hermes \
  --artifacts-dir ./build/react-native-output \
  --strict
```

# License

The Splunk RUM CLI is licensed under the terms of the Apache Software License
version 2.0. See [the license file](./LICENSE) for more details.
