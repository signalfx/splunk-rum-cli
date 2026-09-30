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
import { runReactNativeSourceMapUpload } from '../../src/reactNative/uploadSourceMap';
import { ReactNativeSourceMapUploadOptions } from '../../src/reactNative/types';
import { Logger } from '../../src/utils/logger';
import { Spinner } from '../../src/utils/spinner';
import { uploadSourceMap } from '../../src/sourcemaps/uploadSourceMap';
import { wasInjectAlreadyRun } from '../../src/sourcemaps/wasInjectAlreadyRun';

jest.mock('../../src/sourcemaps/uploadSourceMap', () => ({
  getSourceMapUploadUrl: jest.fn(
    (realm: string, sourceMapId: string) =>
      `https://api.${realm}.observability.splunkcloud.com/v2/rum-mfm/source-maps/id/${sourceMapId}`
  ),
  uploadSourceMap: jest.fn(),
}));
jest.mock('../../src/sourcemaps/wasInjectAlreadyRun', () => ({
  wasInjectAlreadyRun: jest.fn(),
}));

const uploadSourceMapMock = jest.mocked(uploadSourceMap);
const wasInjectAlreadyRunMock = jest.mocked(wasInjectAlreadyRun);

describe('runReactNativeSourceMapUpload', () => {
  let temporaryDirectory: string;
  let options: ReactNativeSourceMapUploadOptions;
  let logger: jest.Mocked<Logger>;
  let spinner: jest.Mocked<Spinner>;

  beforeEach(async () => {
    temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'splunk-rum-rn-'));
    options = createOptions();
    logger = {
      error: jest.fn(),
      warn: jest.fn(),
      info: jest.fn(),
      debug: jest.fn(),
    };
    spinner = {
      start: jest.fn(),
      updateText: jest.fn(),
      stop: jest.fn(),
      interrupt: jest.fn(callback => callback()),
    };
  });

  afterEach(async () => {
    await rm(temporaryDirectory, { recursive: true, force: true });
  });

  test('uploads by the exact ID injected into the bundle', async () => {
    uploadSourceMapMock.mockResolvedValue();

    const result = await runReactNativeSourceMapUpload(options, { logger, spinner });

    expect(uploadSourceMapMock).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceMapId: result.artifacts[0]?.sourceMapId,
        sourceMapPath: options.sourceMapPath,
        token: options.token,
        metadata: {},
      }),
      { logger, spinner }
    );
    expect(wasInjectAlreadyRunMock).not.toHaveBeenCalled();
    expect(spinner.start).toHaveBeenCalledTimes(1);
    expect(spinner.stop).toHaveBeenCalledTimes(1);
  });

  test('propagates upload failure', async () => {
    uploadSourceMapMock.mockRejectedValue(new Error('upload failed'));

    await expect(
      runReactNativeSourceMapUpload(options, { logger, spinner })
    ).rejects.toThrow('upload failed');
    expect(spinner.stop).toHaveBeenCalledTimes(1);
  });

  test('uploads a temporary identity-preserving map without modifying the build output', async () => {
    const bundlePath = path.join(temporaryDirectory, 'index.android.bundle');
    const sourceMapPath = `${bundlePath}.map`;
    await writeFile(
      bundlePath,
      '__splunkRumSourceMapId=33333333-3333-4333-8333-333333333333'
    );
    await writeFile(sourceMapPath, JSON.stringify({
      version: 3,
      sources: ['index.js', 'feature.js'],
      names: [],
      mappings: '',
      x_hermes_function_offsets: {},
    }));
    options.bundlePath = bundlePath;
    options.sourceMapPath = sourceMapPath;
    let stagedPath: string | undefined;
    uploadSourceMapMock.mockImplementation(async uploadOptions => {
      stagedPath = uploadOptions.sourceMapPath;
      const stagedMap = JSON.parse(await readFile(uploadOptions.sourceMapPath, 'utf-8'));
      expect(stagedMap.sourceMapId).toBe('33333333-3333-4333-8333-333333333333');
    });

    await runReactNativeSourceMapUpload(options, { logger, spinner });

    expect(stagedPath).not.toBe(sourceMapPath);
    await expect(readFile(sourceMapPath, 'utf-8')).resolves.not.toContain('sourceMapId');
    await expect(readFile(stagedPath!, 'utf-8')).rejects.toThrow();
  });

  test('dry-run prints the prepared artifact result and performs no upload', async () => {
    options.dryRun = true;

    const result = await runReactNativeSourceMapUpload(options, { logger, spinner });

    expect(uploadSourceMapMock).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith(JSON.stringify(result, null, 2));
    expect(spinner.start).not.toHaveBeenCalled();
  });

  test('repeating the workflow returns an identical result', async () => {
    uploadSourceMapMock.mockResolvedValue();

    const first = await runReactNativeSourceMapUpload(options, { logger, spinner });
    const second = await runReactNativeSourceMapUpload(options, { logger, spinner });

    expect(second).toEqual(first);
  });

  test('uploads every distinct map', async () => {
    uploadSourceMapMock.mockResolvedValue();
    options.bundleName = undefined;
    options.bundlePath = undefined;
    options.sourceMapPath = undefined;
    options.artifacts = [
      {
        bundleName: 'index.android.bundle',
        bundlePath: 'test/fixtures/react-native/final-hermes.bundle',
        sourceMapPath: 'test/fixtures/react-native/final-hermes.bundle.map',
      },
      {
        bundleName: 'payments.android.bundle',
        bundlePath: 'test/fixtures/react-native/final-jsc.jsbundle',
        sourceMapPath: 'test/fixtures/react-native/final-jsc.jsbundle.map',
      },
    ];

    const result = await runReactNativeSourceMapUpload(options, { logger, spinner });

    expect(result.artifacts).toHaveLength(2);
    expect(uploadSourceMapMock).toHaveBeenCalledTimes(2);
  });

  test('discovers multiple conventional bundle/map pairs from one directory', async () => {
    options.bundleName = undefined;
    options.bundlePath = undefined;
    options.sourceMapPath = undefined;
    options.artifactsDirectoryPath = 'test/fixtures/react-native';
    options.dryRun = true;

    const result = await runReactNativeSourceMapUpload(options, { logger, spinner });

    expect(result.artifacts.map(artifact => artifact.bundleName)).toEqual([
      'final-hermes.bundle',
      'final-jsc.jsbundle',
    ]);
    expect(uploadSourceMapMock).not.toHaveBeenCalled();
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
    token: 'secret-token',
    ...overrides,
  };
}
