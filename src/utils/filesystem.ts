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

import { createReadStream, createWriteStream, ReadStream } from 'node:fs';
import { readdir, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline';
import os from 'node:os';
import { finished } from 'node:stream/promises';
import { glob } from 'glob';

const TEMP_FILE_EXTENSION: string = '.splunk.tmp';

/**
 * Returns a list of paths to all files within the given directory.
 *
 * If dir is "path/to/dist", then the returned file paths will look like:
 *  - path/to/dist/main.js
 *  - path/to/dist/main.js.map
 *  - path/to/dist/nested/folder/page1.js
 */
export async function readdirRecursive(dir: string, include: string | string[] = '**/*', exclude: string[] = []) {
  // Using 'glob' instead of native 'readdir' due to:
  //   https://github.com/nodejs/node/issues/48858
  //   https://github.com/nodejs/node/issues/51773

  // glob does not report some readdir errors (ENOTDIR, EACCES)
  // that our user should know about, so try reading the dir before running glob
  await readdir(dir);

  const partialPaths = await glob(include, {
    cwd: dir,
    nodir: true,
    ignore: ['**/node_modules/**', ...exclude]
  });
  return partialPaths.map(partialPath => path.join(dir, partialPath));
}

export function readlines(stream: ReadStream): AsyncIterable<string> {
  return readline.createInterface({
    input: stream,
    crlfDelay: Infinity,  // recognize all instances of CR LF ('\r\n') as a single line break
  });
}

export function makeReadStream(filePath: string) {
  return createReadStream(filePath, { encoding: 'utf-8' });
}

export function makeBinaryReadStream(filePath: string) {
  return createReadStream(filePath);
}

/**
 * Safely overwrite the contents of filePath by writing to a temporary
 * file and replacing filePath. This avoids destructive edits to filePath
 * if the process exits before this function has completed.
 *
 * If this method is used by a command, the command must always invoke
 * cleanupTemporaryFiles before exiting successfully.
 */
export async function overwriteFileContents(filePath: string, lines: string[]) {
  const tempFilePath = getTempFilePath(filePath);
  await writeLinesToFile(tempFilePath, lines);
  await rename(tempFilePath, filePath);
}

/**
 * Recursively remove any temporary files that may still be present in the directory.
 */
export async function cleanupTemporaryFiles(dir: string) {
  const paths = await readdirRecursive(dir);
  for (const path of paths) {
    if (path.endsWith(TEMP_FILE_EXTENSION)) {
      await rm(path);
    }
  }
}

/**
 * Return a tempFilePath based on the input filePath:
 *
 *  - `path/to/file.js` -> `path/to/.file.js${TEMP_FILE_EXTENSION}`
 */
function getTempFilePath(filePath: string) {
  const fileName = path.basename(filePath);
  const tempFileName = `.${fileName}${TEMP_FILE_EXTENSION}`;
  return path.join(
    path.dirname(filePath),
    tempFileName
  );

}

async function writeLinesToFile(path: string, lines: string[]) {
  const outStream = createWriteStream(path, { encoding: 'utf-8' });
  for (const line of lines) {
    outStream.write(line);
    outStream.write(os.EOL);
  }
  outStream.end();
  return finished(outStream);
}
