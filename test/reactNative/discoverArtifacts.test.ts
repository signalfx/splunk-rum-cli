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


import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { discoverReactNativeArtifacts } from '../../src/reactNative/discoverArtifacts';

describe('discoverReactNativeArtifacts', () => {
  let temporaryDirectory: string;

  beforeEach(async () => {
    temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'splunk-rum-rn-discovery-'));
  });

  afterEach(async () => {
    await rm(temporaryDirectory, { recursive: true, force: true });
  });

  test('discovers co-located bundle/map pairs and ignores intermediate maps', async () => {
    const featureDirectory = path.join(temporaryDirectory, 'features');
    await mkdir(featureDirectory, { recursive: true });
    await Promise.all([
      writeFile(path.join(temporaryDirectory, 'index.android.bundle'), 'bundle'),
      writeFile(path.join(temporaryDirectory, 'index.android.bundle.map'), '{}'),
      writeFile(path.join(temporaryDirectory, 'index.android.bundle.packager.map'), '{}'),
      writeFile(path.join(featureDirectory, 'payments.android.bundle'), 'bundle'),
      writeFile(path.join(featureDirectory, 'payments.android.bundle.map'), '{}'),
      writeFile(path.join(featureDirectory, 'unrelated.js.map'), '{}'),
    ]);

    const artifacts = await discoverReactNativeArtifacts(temporaryDirectory);

    expect(artifacts.map(artifact => artifact.bundleName)).toEqual([
      'payments.android.bundle',
      'index.android.bundle',
    ]);
  });

  test('pairs separate output directories using a unique bundle basename', async () => {
    const bundleDirectory = path.join(temporaryDirectory, 'assets');
    const mapDirectory = path.join(temporaryDirectory, 'sourcemaps');
    await Promise.all([
      mkdir(bundleDirectory, { recursive: true }),
      mkdir(mapDirectory, { recursive: true }),
    ]);
    await Promise.all([
      writeFile(path.join(bundleDirectory, 'index.android.bundle'), 'bundle'),
      writeFile(path.join(mapDirectory, 'index.android.bundle.map'), '{}'),
    ]);

    const artifacts = await discoverReactNativeArtifacts(temporaryDirectory);

    expect(artifacts).toEqual([{
      bundleName: 'index.android.bundle',
      bundlePath: path.join(bundleDirectory, 'index.android.bundle'),
      sourceMapPath: path.join(mapDirectory, 'index.android.bundle.map'),
    }]);
  });

  test('rejects ambiguous same-named bundles instead of guessing', async () => {
    const firstBundleDirectory = path.join(temporaryDirectory, 'assets-one');
    const secondBundleDirectory = path.join(temporaryDirectory, 'assets-two');
    const mapDirectory = path.join(temporaryDirectory, 'sourcemaps');
    await Promise.all([
      mkdir(firstBundleDirectory, { recursive: true }),
      mkdir(secondBundleDirectory, { recursive: true }),
      mkdir(mapDirectory, { recursive: true }),
    ]);
    await Promise.all([
      writeFile(path.join(firstBundleDirectory, 'index.android.bundle'), 'bundle'),
      writeFile(path.join(secondBundleDirectory, 'index.android.bundle'), 'bundle'),
      writeFile(path.join(mapDirectory, 'index.android.bundle.map'), '{}'),
    ]);

    await expect(discoverReactNativeArtifacts(temporaryDirectory))
      .rejects.toThrow(/multiple bundles named/);
  });

  test('reports when no conventional final pairs exist', async () => {
    await writeFile(path.join(temporaryDirectory, 'index.android.bundle.packager.map'), '{}');

    await expect(discoverReactNativeArtifacts(temporaryDirectory))
      .rejects.toThrow(/No React Native/);
  });
});
