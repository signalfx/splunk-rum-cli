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


import axios from 'axios';
import { uploadFile } from '../../src/utils/httpUtils';
import {
  getSourceMapUploadUrl,
  uploadSourceMap
} from '../../src/sourcemaps/uploadSourceMap';
import { Logger } from '../../src/utils/logger';
import { Spinner } from '../../src/utils/spinner';

jest.mock('axios', () => ({
  create: jest.fn(() => ({ interceptors: {} })),
}));
jest.mock('../../src/utils/httpUtils', () => ({
  uploadFile: jest.fn(),
}));
jest.mock('../../src/utils/apiInterceptor', () => ({
  attachApiInterceptor: jest.fn(),
}));

const uploadFileMock = jest.mocked(uploadFile);

describe('uploadSourceMap', () => {
  const logger: jest.Mocked<Logger> = {
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
  };
  const spinner: jest.Mocked<Spinner> = {
    start: jest.fn(),
    updateText: jest.fn(),
    stop: jest.fn(),
    interrupt: jest.fn(callback => callback()),
  };

  test('uploads one exact map with the provided metadata', async () => {
    uploadFileMock.mockResolvedValue();
    const metadata = {
      appName: 'ExampleApp',
      platform: 'android',
      jsEngine: 'hermes',
    };

    await uploadSourceMap({
      sourceMapPath: 'index.android.bundle.map',
      sourceMapId: 'source-map-id',
      realm: 'us0',
      token: 'secret',
      metadata,
    }, { logger, spinner });

    expect(uploadFileMock).toHaveBeenCalledWith(
      expect.objectContaining({
        url: getSourceMapUploadUrl('us0', 'source-map-id'),
        file: {
          filePath: 'index.android.bundle.map',
          fieldName: 'file',
        },
        token: 'secret',
        parameters: metadata,
      }),
      expect.anything()
    );
    expect(axios.create).toHaveBeenCalledTimes(1);
  });

  test('dry-run does not create a client or upload a file', async () => {
    await uploadSourceMap({
      sourceMapPath: 'index.android.bundle.map',
      sourceMapId: 'source-map-id',
      realm: 'us0',
      token: 'secret',
      metadata: {},
      dryRun: true,
    }, { logger, spinner });

    expect(uploadFileMock).not.toHaveBeenCalled();
    expect(axios.create).not.toHaveBeenCalled();
  });
});
