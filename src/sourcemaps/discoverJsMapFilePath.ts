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
import { makeReadStream, readlines } from '../utils/filesystem';
import path from 'node:path';
import { SOURCE_MAPPING_URL_COMMENT_PREFIX, throwJsFileReadError } from './utils';
import { Logger } from '../utils/logger';

/**
 * Determine the corresponding ".map" file for the given jsFilePath.
 *
 * Strategy:
 *
 *  1) Append ".map" to the jsFilePath.  If we already know this file exists, return it as the match.
 *  This is a common naming convention for source map files.
 *
 *  2) Fallback to the "//# sourceMappingURL=..." comment in the JS file.
 *  If this comment is present, and we detect it is a relative file path, return this value as the match.
 */
export async function discoverJsMapFilePath(jsFilePath: string, allJsMapFilePaths: string[], options: SourceMapInjectOptions, logger: Logger): Promise<string | null> {
  /*
   * Check if we already know about the map file by adding ".map" extension.  This is a common convention.
   */
  if (allJsMapFilePaths.includes(`${jsFilePath}.map`)) {
    const result = `${jsFilePath}.map`;

    logger.debug(`found source map pair (using standard naming convention):`);
    logger.debug(`  - ${jsFilePath}`);
    logger.debug(`  - ${result}`);

    return result;
  }

  /*
   * Fallback to reading the JS file and parsing its "//# sourceMappingURL=..." comment
   */
  let sourceMappingUrlLine: string | null = null;
  try {
    const fileStream = makeReadStream(jsFilePath);
    for await (const line of readlines(fileStream)) {
      if (line.startsWith(SOURCE_MAPPING_URL_COMMENT_PREFIX)) {
        sourceMappingUrlLine = line;
        break;
      }
    }
  } catch (e) {
    throwJsFileReadError(e, jsFilePath, options);
  }

  let result: string | null = null;
  if (sourceMappingUrlLine) {
    result = resolveSourceMappingUrlToFilePath(sourceMappingUrlLine, jsFilePath, allJsMapFilePaths, logger);
  }

  if (result === null) {
    logger.debug(`no source map found for ${jsFilePath}`);
  }

  return result;
}

/**
 * Parse the sourceMappingURL comment to a file path, or return null if the value is unsupported by our inject tool.
 *
 * Given the jsFilePath "path/file.js":
 *  - "//# sourceMappingURL=file.map.js" is a relative path, and "path/file.map.js" will be returned
 *  - "//# sourceMappingURL=http://..." is not a relative path, and null will be returned
 */
function resolveSourceMappingUrlToFilePath(line: string, jsFilePath: string, allJsMapFilePaths: string[], logger: Logger): string | null {
  const url = line.slice(SOURCE_MAPPING_URL_COMMENT_PREFIX.length).trim();

  if (path.isAbsolute(url)
    || url.startsWith('http://')
    || url.startsWith('https://')
    || url.startsWith('data:')) {
    logger.debug(`skipping source map pair (unsupported sourceMappingURL comment):`);
    logger.debug(`  - ${jsFilePath}`);
    logger.debug(`  - ${url}`);

    return null;
  }

  const matchingJsMapFilePath = path.join(
    path.dirname(jsFilePath),
    url
  );

  if (!allJsMapFilePaths.includes(matchingJsMapFilePath)) {
    logger.debug(`skipping source map pair (file not in provided directory):`);
    logger.debug(`  - ${jsFilePath}`);
    logger.debug(`  - ${url}`);

    logger.warn(`skipping ${jsFilePath}, which is requesting a source map file outside of the provided --path`);

    return null;
  } else {
    logger.debug(`found source map pair (using sourceMappingURL comment):`);
    logger.debug(`  - ${jsFilePath}`);
    logger.debug(`  - ${matchingJsMapFilePath}`);

    return matchingJsMapFilePath;
  }
}
