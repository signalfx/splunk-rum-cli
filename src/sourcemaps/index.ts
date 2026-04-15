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

import { cleanupTemporaryFiles, readdirRecursive } from '../utils/filesystem';
import {
  DEFAULT_JS_MAP_GLOB_PATTERN,
  isJsFilePath,
  isJsMapFilePath
} from './utils';
import {
  BASE_URL_PREFIX,
  API_VERSION_STRING,
  SOURCEMAPS_CONSTANTS,
  DEFAULT_DOMAIN
} from '../utils/constants';
import { throwAsUserFriendlyErrnoException } from '../utils/userFriendlyErrors';
import { discoverJsMapFilePath } from './discoverJsMapFilePath';
import { computeSourceMapId } from './computeSourceMapId';
import { injectFile } from './injectFile';
import { Logger } from '../utils/logger';
import { Spinner } from '../utils/spinner';
import { uploadFile } from '../utils/httpUtils';
import axios from 'axios';
import { formatUploadProgress } from '../utils/stringUtils';
import { wasInjectAlreadyRun } from './wasInjectAlreadyRun';
import { attachApiInterceptor } from '../utils/apiInterceptor';

export type SourceMapInjectOptions = {
  directory: string;
  dryRun?: boolean;
  debug?: boolean;
  include?: string[];
  exclude?: string[];
};

export type SourceMapInjectContext = {
  logger: Logger;
};

export type SourceMapUploadOptions = {
  token: string;
  realm: string;
  directory: string;
  include?: string[];
  exclude?: string[];
  appName?: string;
  appVersion?: string;
  dryRun?: boolean;
  debug?: boolean;
};

export type SourceMapUploadContext = {
  logger: Logger;
  spinner: Spinner;
};

/**
 * Inject sourceMapIds into all applicable JavaScript files inside the given directory.
 *
 * For each JS file in the directory:
 *   1. Determine where its source map file lives
 *   2. Compute the sourceMapId (by hashing its source map file)
 *   3. Inject the sourceMapId into the JS file
 */
export async function runSourcemapInject(options: SourceMapInjectOptions, ctx: SourceMapInjectContext) {
  const { directory, include, exclude } = options;
  const { logger } = ctx;

  /*
   * Read the provided directory to collect a list of all possible files the script will be working with.
   */
  let jsFilePaths;
  let jsMapFilePaths;
  try {
    jsFilePaths = await readdirRecursive(directory, include, exclude);
    jsMapFilePaths = await readdirRecursive(directory, DEFAULT_JS_MAP_GLOB_PATTERN);
  } catch (err) {
    throwDirectoryReadErrorDuringInject(err, directory);
  }

  // don't trust user-provided glob results. apply our own file-type filters before moving on
  jsFilePaths = jsFilePaths.filter(isJsFilePath);
  jsMapFilePaths = jsMapFilePaths.filter(isJsMapFilePath);

  logger.info(`Found ${jsFilePaths.length} JavaScript file(s) in ${directory}`);

  /*
   * Inject a code snippet into each JS file, whenever applicable.
   */
  const injectedJsFilePaths = [];
  for (const jsFilePath of jsFilePaths) {
    const matchingSourceMapFilePath = await discoverJsMapFilePath(jsFilePath, jsMapFilePaths, options, logger);
    if (!matchingSourceMapFilePath) {
      logger.info(`No source map was detected for ${jsFilePath}.  Skipping injection.`);
      continue;
    }

    const sourceMapId = await computeSourceMapId(matchingSourceMapFilePath, options);
    await injectFile(jsFilePath, sourceMapId, options, logger);

    injectedJsFilePaths.push(jsFilePath);
  }

  // If we reach here, the only reason for temporary files to be leftover is if a previous invocation of
  // sourcemaps inject had terminated unexpectedly in the middle of writing to a temp file.
  // But we should make sure to clean up those older files, too, before exiting this successful run.
  await cleanupTemporaryFiles(directory);

  /*
   * Print summary of results
   */
  logger.info(`Finished source map injection for ${injectedJsFilePaths.length} JavaScript file(s) in ${directory}`);
  if (jsFilePaths.length === 0) {
    logger.warn(`No JavaScript files were found.  Verify that the provided directory contains JavaScript files and that any provided file patterns are correct:`);
    logger.warn({
      directory,
      include,
      exclude
    });
  } else if (injectedJsFilePaths.length === 0) {
    logger.warn(`No JavaScript files were injected.  Verify that your build is configured to generate source maps for your JavaScript files.`);
  }

}

/**
 * Upload all source map files in the provided directory.
 *
 * For each source map file in the directory:
 *  1. Compute the sourceMapId (by hashing the file)
 *  2. Upload the file to the appropriate URL
 */
export async function runSourcemapUpload(options: SourceMapUploadOptions, ctx: SourceMapUploadContext) {
  const { logger, spinner } = ctx;
  const { directory, include, exclude, realm, appName, appVersion, token } = options;

  /*
   * Read the provided directory to collect a list of all possible files the script will be working with.
   */
  let jsMapFilePaths;
  try {
    jsMapFilePaths = await readdirRecursive(directory, include, exclude);
  } catch (err) {
    throwDirectoryReadErrorDuringUpload(err, directory);
  }

  // don't trust user-provided glob results.  apply our own file-type filter before moving on
  jsMapFilePaths = jsMapFilePaths.filter(isJsMapFilePath);

  /*
   * Upload files to the server
   */
  let success = 0;

  logger.info('Upload URL: %s', getSourceMapUploadUrl(realm, '{id}'));
  logger.info('Found %s source map(s) to upload', jsMapFilePaths.length);

  if (!options.dryRun) {
    spinner.start('');
  }

  for (let i = 0; i < jsMapFilePaths.length; i++) {
    const filesRemaining = jsMapFilePaths.length - i;
    const path = jsMapFilePaths[i];
    const sourceMapId = await computeSourceMapId(path, { directory });
    const url = getSourceMapUploadUrl(realm, sourceMapId);
    const file = {
      filePath: path,
      fieldName: 'file'
    };

    const parameters = Object.fromEntries([
      ['appName', appName],
      ['appVersion', appVersion],
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
    ].filter(([_, value]) => typeof value !== 'undefined'));

    logger.debug('Uploading %s', path);
    logger.debug('PUT', url);

    const dryRunUploadFile: typeof uploadFile = async () => {
      logger.info('sourceMapId %s would be used to upload %s', sourceMapId, path);
    };
    const uploadFileFn = options.dryRun ? dryRunUploadFile : uploadFile;

    // notify user if we cannot be certain the "sourcemaps inject" command was already run
    const alreadyInjected = await wasInjectAlreadyRun(path, logger);
    if (!alreadyInjected.result) {
      logger.warn(alreadyInjected.message);
    }

    // upload a single file
    try {
      const axiosInstance = axios.create();
      attachApiInterceptor(axiosInstance, logger, url, {
        userFriendlyMessage: 'An error occurred during source map upload.'
      });
      await uploadFileFn({
        url,
        file,
        token,
        onProgress: ({ loaded, total }) => {
          const { totalFormatted } = formatUploadProgress(loaded, total);
          spinner.updateText(`Uploading ${path} | ${totalFormatted} | ${filesRemaining} file(s) remaining`);
        },
        parameters,
      }, axiosInstance);
      success++;
    } catch (e) {
      spinner.stop();
      throw e;
    }
  }
  spinner.stop();

  /*
   * Print summary of results
   */
  if (!options.dryRun) {
    logger.info(`${success} source map(s) were uploaded successfully`);
  }

  if (jsMapFilePaths.length === 0) {
    logger.warn(`No source map files were found. Verify that the provided directory contains source map files and that any provided file patterns are correct:`);
    logger.warn({
      directory,
      include,
      exclude
    });
  }
}

function getSourceMapUploadUrl(realm: string, idPathParam: string): string {
  const API_BASE_URL = `${BASE_URL_PREFIX}.${realm}.${DEFAULT_DOMAIN}`;
  const PATH_FOR_SOURCEMAPS = SOURCEMAPS_CONSTANTS.PATH_FOR_UPLOAD;
  return `${API_BASE_URL}/${API_VERSION_STRING}/${PATH_FOR_SOURCEMAPS}/id/${idPathParam}`;
}

function throwDirectoryReadErrorDuringInject(err: unknown, directory: string): never {
  throwAsUserFriendlyErrnoException(
    err,
    {
      EACCES: `Failed to inject JavaScript files in "${directory} because of missing permissions.\nMake sure that the CLI tool will have "read" and "write" access to the directory and all files inside it, then rerun the inject command.`,
      ENOENT: `Unable to start the inject command because the directory "${directory}" does not exist.\nMake sure the correct path is being passed to --path, then rerun the inject command.`,
      ENOTDIR: `Unable to start the inject command because the path "${directory}" is not a directory.\nMake sure a valid directory path is being passed to --path, then rerun the inject command.`,
    }
  );
}

function throwDirectoryReadErrorDuringUpload(err: unknown, directory: string): never {
  throwAsUserFriendlyErrnoException(
    err,
    {
      EACCES: `Failed to upload the source map files in "${directory} because of missing permissions.\nMake sure that the CLI tool will have "read" and "write" access to the directory and all files inside it, then rerun the upload command.`,
      ENOENT: `Unable to start the upload command because the directory "${directory}" does not exist.\nMake sure the correct path is being passed to --path, then rerun the upload command.`,
      ENOTDIR: `Unable to start the upload command because the path "${directory}" is not a directory.\nMake sure a valid directory path is being passed to --path, then rerun the upload command.`,
    }
  );
}
