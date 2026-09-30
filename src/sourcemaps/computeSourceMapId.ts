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

import { SourceMapInjectOptions } from './index';
import { createHash } from 'node:crypto';
import { makeBinaryReadStream } from '../utils/filesystem';
import { throwJsMapFileReadError } from './utils';

/**
 * sourceMapId is computed by hashing the contents of the ".map" file, and then
 * formatting the hash to like a GUID.
 */
export async function computeSourceMapId(sourceMapFilePath: string, options: SourceMapInjectOptions): Promise<string> {
  try {
    const sha = await computeFileSha256(sourceMapFilePath);
    return sha256ToSourceMapId(sha);
  } catch (e) {
    throwJsMapFileReadError(e, sourceMapFilePath, options);
  }
}

export async function computeFileSha256(filePath: string): Promise<string> {
  const hash = createHash('sha256');
  const fileStream = makeBinaryReadStream(filePath);
  for await (const chunk of fileStream) {
    hash.update(chunk);
  }
  return hash.digest('hex');
}

export function sha256ToSourceMapId(sha: string) {
  if (!/^[a-f0-9]{64}$/i.test(sha)) {
    throw new Error('Expected a complete SHA-256 digest containing 64 hexadecimal characters.');
  }
  return [
    sha.slice(0, 8),
    sha.slice(8, 12),
    sha.slice(12, 16),
    sha.slice(16, 20),
    sha.slice(20, 32),
  ].join('-');
}
