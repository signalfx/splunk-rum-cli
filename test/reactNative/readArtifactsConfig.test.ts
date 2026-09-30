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


import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { readReactNativeArtifactsConfig } from '../../src/reactNative/readArtifactsConfig';

describe('readReactNativeArtifactsConfig', () => {
  let temporaryDirectory: string;

  beforeEach(async () => {
    temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'splunk-rum-rn-catalog-'));
  });

  afterEach(async () => {
    await rm(temporaryDirectory, { recursive: true, force: true });
  });

  test('accepts an omitted bundle name and resolves paths relative to the catalog', async () => {
    const configPath = path.join(temporaryDirectory, 'artifacts.json');
    await writeFile(configPath, JSON.stringify({
      bundles: [{
        bundle: './build/index.android.bundle',
        sourceMap: './maps/index.android.bundle.map',
      }],
    }));

    await expect(readReactNativeArtifactsConfig(configPath)).resolves.toEqual({
      artifacts: [{
        bundleName: undefined,
        bundlePath: path.join(temporaryDirectory, 'build/index.android.bundle'),
        sourceMapPath: path.join(temporaryDirectory, 'maps/index.android.bundle.map'),
      }],
    });
  });

  test('rejects empty artifact paths', async () => {
    const configPath = path.join(temporaryDirectory, 'artifacts.json');
    await writeFile(configPath, JSON.stringify({
      bundles: [{ bundle: '', sourceMap: './index.android.bundle.map' }],
    }));

    await expect(readReactNativeArtifactsConfig(configPath)).rejects.toThrow(/requires bundle/);
  });
});
