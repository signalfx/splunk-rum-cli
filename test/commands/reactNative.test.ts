/*
 * Copyright Splunk Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
*/


import {
  prepareReactNativeUploadCredentials,
  reactNativeCommand,
  validateReactNativeArtifactOptions
} from '../../src/commands/reactNative';
import { COMMON_ERROR_MESSAGES } from '../../src/utils/inputValidations';

describe('react-native command', () => {
  test('exposes the explicit sourcemaps upload hierarchy', () => {
    const sourceMaps = reactNativeCommand.commands.find(command => command.name() === 'sourcemaps');
    const upload = sourceMaps?.commands.find(command => command.name() === 'upload');

    expect(sourceMaps).toBeDefined();
    expect(upload).toBeDefined();
    expect(upload?.description()).toContain('never modifies');
    expect(upload?.options.some(option => option.long === '--artifacts')).toBe(true);
    expect(upload?.options.some(option => option.long === '--artifacts-dir')).toBe(true);
  });

  test('accepts scalar artifacts, a catalog, or directory discovery, but not a mixture', () => {
    expect(() => validateReactNativeArtifactOptions({ artifacts: 'bundles.json' })).not.toThrow();
    expect(() => validateReactNativeArtifactOptions({ artifactsDir: 'build/output' })).not.toThrow();
    expect(() => validateReactNativeArtifactOptions({
      bundle: 'index.android.bundle',
      sourceMap: 'index.android.bundle.map',
    })).not.toThrow();
    expect(() => validateReactNativeArtifactOptions({
      artifacts: 'bundles.json',
      bundleName: 'index.android.bundle',
    })).toThrow(/mutually exclusive/);
    expect(() => validateReactNativeArtifactOptions({
      artifactsDir: 'build/output',
      bundle: 'index.android.bundle',
      sourceMap: 'index.android.bundle.map',
    })).toThrow(/mutually exclusive/);
  });

  test('requires a complete scalar bundle/map pair', () => {
    expect(() => validateReactNativeArtifactOptions({ bundle: 'index.android.bundle' }))
      .toThrow(/both --bundle and --source-map/);
    expect(() => validateReactNativeArtifactOptions({ sourceMap: 'index.android.bundle.map' }))
      .toThrow(/both --bundle and --source-map/);
  });

  test('does not require production credentials for dry-run', () => {
    expect(
      prepareReactNativeUploadCredentials({ dryRun: true })
    ).toEqual({ realm: '', token: '' });
  });

  test('still requires a realm when uploading', () => {
    expect(() =>
      prepareReactNativeUploadCredentials({
        dryRun: false,
        token: 'secret-token',
      })
    ).toThrow(COMMON_ERROR_MESSAGES.REALM_NOT_SPECIFIED);
  });

  test('still requires a token when uploading', () => {
    const previousToken = process.env.SPLUNK_ACCESS_TOKEN;
    delete process.env.SPLUNK_ACCESS_TOKEN;
    try {
      expect(() =>
        prepareReactNativeUploadCredentials({
          dryRun: false,
          realm: 'us0',
        })
      ).toThrow(COMMON_ERROR_MESSAGES.TOKEN_NOT_SPECIFIED);
    } finally {
      if (previousToken === undefined) {
        delete process.env.SPLUNK_ACCESS_TOKEN;
      } else {
        process.env.SPLUNK_ACCESS_TOKEN = previousToken;
      }
    }
  });
});
