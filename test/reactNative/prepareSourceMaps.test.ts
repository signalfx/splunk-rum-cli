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


import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { prepareReactNativeSourceMaps } from '../../src/reactNative/prepareSourceMaps';
import { ReactNativeSourceMapUploadOptions } from '../../src/reactNative/types';

describe('prepareReactNativeSourceMaps', () => {
  let temporaryDirectory: string;

  beforeEach(async () => {
    temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'splunk-rum-rn-identity-'));
  });

  afterEach(async () => {
    await rm(temporaryDirectory, { recursive: true, force: true });
  });

  test('uses the ID injected into the executable bundle', async () => {
    const result = await prepareReactNativeSourceMaps(createOptions());
    expect(result).toEqual({
      schemaVersion: 1,
      platform: 'android',
      jsEngine: 'hermes',
      artifacts: [{
        bundleName: 'index.android.bundle',
        sourceMapId: '11111111-1111-4111-8111-111111111111',
        mapIdentityNeedsStaging: false,
      }],
    });
  });

  test('infers the runtime bundle name from the bundle file when omitted', async () => {
    const result = await prepareReactNativeSourceMaps(createOptions({ bundleName: undefined }));

    expect(result.artifacts[0]?.bundleName).toBe('final-hermes.bundle');
  });

  test('detects identity fields dropped by final map composition without rewriting the map', async () => {
    const bundle = path.join(temporaryDirectory, 'index.android.bundle');
    const sourceMap = `${bundle}.map`;
    await writeFile(
      bundle,
      'bytecode __splunkRumSourceMapId=33333333-3333-4333-8333-333333333333'
    );
    await writeFile(sourceMap, '{"version":3,"sources":[],"names":[],"mappings":""}');

    const result = await prepareReactNativeSourceMaps(createOptions({
      bundlePath: bundle,
      sourceMapPath: sourceMap,
    }));
    const preparedMap = JSON.parse(await readFile(sourceMap, 'utf-8'));

    expect(result.artifacts[0]).toMatchObject({
      sourceMapId: '33333333-3333-4333-8333-333333333333',
      mapIdentityNeedsStaging: true,
    });
    expect(preparedMap).not.toHaveProperty('sourceMapId');
  });

  test('rejects an uninstrumented executable bundle', async () => {
    const bundle = path.join(temporaryDirectory, 'index.android.bundle');
    const sourceMap = `${bundle}.map`;
    await writeFile(bundle, 'uninstrumented bytecode');
    await writeFile(sourceMap, '{"version":3,"sources":[],"names":[],"mappings":""}');

    await expect(prepareReactNativeSourceMaps(createOptions({
      bundlePath: bundle,
      sourceMapPath: sourceMap,
    }))).rejects.toThrow(/does not contain a Splunk source-map ID/);
  });

  test('rejects a bundle and map with different IDs', async () => {
    const bundle = path.join(temporaryDirectory, 'index.android.bundle');
    const sourceMap = `${bundle}.map`;
    await writeFile(
      bundle,
      '__splunkRumSourceMapId=33333333-3333-4333-8333-333333333333'
    );
    await writeFile(sourceMap, JSON.stringify({
      version: 3,
      sources: [],
      names: [],
      mappings: '',
      sourceMapId: '44444444-4444-4444-8444-444444444444',
    }));

    await expect(prepareReactNativeSourceMaps(createOptions({
      bundlePath: bundle,
      sourceMapPath: sourceMap,
    }))).rejects.toThrow(/do not match/);
  });

  test('prepares a sorted multi-bundle result', async () => {
    const result = await prepareReactNativeSourceMaps(createOptions({
      bundleName: undefined,
      bundlePath: undefined,
      sourceMapPath: undefined,
      artifacts: [
        {
          bundleName: 'features/payments.android.bundle',
          bundlePath: 'test/fixtures/react-native/final-jsc.jsbundle',
          sourceMapPath: 'test/fixtures/react-native/final-jsc.jsbundle.map',
        },
        {
          bundleName: 'index.android.bundle',
          bundlePath: 'test/fixtures/react-native/final-hermes.bundle',
          sourceMapPath: 'test/fixtures/react-native/final-hermes.bundle.map',
        },
      ],
    }));

    expect(result.artifacts.map(artifact => artifact.bundleName)).toEqual([
      'features/payments.android.bundle',
      'index.android.bundle',
    ]);
  });
});

function createOptions(
  overrides: Partial<ReactNativeSourceMapUploadOptions> = {}
): ReactNativeSourceMapUploadOptions {
  return {
    platform: 'android',
    engine: 'hermes',
    bundleName: 'index.android.bundle',
    bundlePath: 'test/fixtures/react-native/final-hermes.bundle',
    sourceMapPath: 'test/fixtures/react-native/final-hermes.bundle.map',
    realm: 'us0',
    token: 'secret',
    ...overrides,
  };
}
