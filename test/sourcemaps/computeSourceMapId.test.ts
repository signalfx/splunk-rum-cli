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

import * as filesystem from '../../src/utils/filesystem';
import { Readable } from 'node:stream';
import {
  computeFileSha256,
  computeSourceMapId,
  sha256ToSourceMapId
} from '../../src/sourcemaps/computeSourceMapId';
import { UserFriendlyError } from '../../src/utils/userFriendlyErrors';
import { SourceMapInjectOptions } from '../../src/sourcemaps';
import * as fs from 'fs';

describe('computeSourceMapId', () => {
  const opts = getMockCommandOptions();

  test('should return truncated sha256 formatted like a GUID', async () => {
    const mockReadStream = new Readable() as unknown as fs.ReadStream;

    mockReadStream.path = 'file.js.map';
    mockReadStream.bytesRead = 0;
    mockReadStream.close = jest.fn();
    
    mockReadStream._read = jest.fn();
    mockReadStream.push('line 1\n');
    mockReadStream.push('line 2\n');
    mockReadStream.push(null);

    jest.spyOn(filesystem, 'makeBinaryReadStream').mockReturnValue(mockReadStream);
    const sourceMapId = await computeSourceMapId('file.js.map', opts);
    expect(sourceMapId).toBe('90605548-63a6-2b9d-b5f7-26216876654e');
  });

  test('should throw UserFriendlyError when file operations fail due to known error code', async () => {
    jest.spyOn(filesystem, 'makeBinaryReadStream').mockImplementation(() => throwErrnoException('EACCES'));

    await expect(computeSourceMapId('file.js.map', opts)).rejects.toThrowError(UserFriendlyError);
  });

  test('should expose the complete SHA-256 and derive the compatible sourceMapId', async () => {
    const mockReadStream = new Readable() as unknown as fs.ReadStream;
    mockReadStream.path = 'file.js.map';
    mockReadStream.bytesRead = 0;
    mockReadStream.close = jest.fn();
    mockReadStream._read = jest.fn();
    mockReadStream.push('line 1\n');
    mockReadStream.push('line 2\n');
    mockReadStream.push(null);

    jest.spyOn(filesystem, 'makeBinaryReadStream').mockReturnValue(mockReadStream);
    const sha256 = await computeFileSha256('file.js.map');

    expect(sha256).toBe('9060554863a62b9db5f726216876654e561896071d2e6480f2048b70e0fdadb9');
    expect(sha256ToSourceMapId(sha256)).toBe('90605548-63a6-2b9d-b5f7-26216876654e');
  });

  test('hashes binary Hermes bundles as exact bytes rather than UTF-8 text', async () => {
    const binary = Buffer.from([0xc6, 0x1f, 0xbc, 0x03, 0xff, 0xfe, 0x00, 0x80]);
    const mockReadStream = Readable.from([binary]) as unknown as fs.ReadStream;
    jest.spyOn(filesystem, 'makeBinaryReadStream').mockReturnValue(mockReadStream);

    await expect(computeFileSha256('index.android.bundle')).resolves.toBe(
      '220ed65d1b20be1bd4316c0aefe6869069a12fa5af4bd082ca9fddddcd879b63'
    );
  });

  test('should reject an incomplete SHA-256', () => {
    expect(() => sha256ToSourceMapId('1234')).toThrow(/64 hexadecimal/);
  });
});

function getMockCommandOptions(overrides?: Partial<SourceMapInjectOptions>): SourceMapInjectOptions {
  const defaults = {
    directory: 'path/',
    dryRun: false
  };
  return { ...defaults, ... overrides };
}

function throwErrnoException(code: string): never {
  const err = new Error('mock error') as NodeJS.ErrnoException;
  err.code = code;
  throw err;
}
