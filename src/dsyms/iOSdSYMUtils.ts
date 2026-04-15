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

import { tmpdir } from 'os';
import { execSync } from 'child_process';
import { BASE_URL_PREFIX, API_VERSION_STRING, DEFAULT_DOMAIN } from '../utils/constants';
import { Logger } from '../utils/logger';
import { join, resolve, basename, dirname } from 'path';
import { copyFileSync, mkdtempSync, readdirSync, rmSync, statSync } from 'fs';
import { UserFriendlyError, throwAsUserFriendlyErrnoException } from '../utils/userFriendlyErrors';

/**
 * Helper function to generate API URLs.
 */
export const generateUrl = ({
  apiPath,
  realm,
  domain = DEFAULT_DOMAIN,
}: {
  apiPath: string;
  realm: string;
  domain?: string;
}): string => {
  return `${BASE_URL_PREFIX}.${realm}.${domain}/${API_VERSION_STRING}/${apiPath}`;
};

/**
 * Helper functions for locating and zipping dSYMs
 **/
export function validateDSYMsPath(dsymsPath: string): string {
  const absPath = resolve(dsymsPath);

  if (absPath.endsWith('/dSYMs') || absPath === 'dSYMs') {
    try {
      const stats = statSync(absPath);
      if (!stats.isDirectory()) {
        throw new UserFriendlyError(null, `Invalid input: Expected a 'dSYMs/' directory but got a file.`);
      }
    } catch (err) {
      throwAsUserFriendlyErrnoException(err, {
        ENOENT: `Path not found: Ensure the provided directory exists before re-running.`,
      });
    }
    return absPath;
  }

  if (absPath.endsWith('.dSYM.zip') || absPath.endsWith('.dSYMs.zip')) {
    try {
      const stats = statSync(absPath);
      if (!stats.isFile()) {
        throw new UserFriendlyError(null, `Invalid input: Expected a '.dSYM.zip' or '.dSYMs.zip' file.`);
      }
    } catch (err) {
      throwAsUserFriendlyErrnoException(err, {
        ENOENT: `File not found: Ensure the provided file [${absPath}] exists before re-running.`,
      });
    }
    return absPath;
  }

  if (absPath.endsWith('.dSYM')) {
    try {
      const stats = statSync(absPath);
      if (!stats.isDirectory()) {
        throw new UserFriendlyError(null, `Invalid input: Expected a '.dSYM' directory but got a file.`);
      }
    } catch (err) {
      throwAsUserFriendlyErrnoException(err, {
        ENOENT: `Directory not found: Ensure the provided directory exists before re-running.`,
      });
    }
    return absPath;
  }

  throw new UserFriendlyError(null, `Invalid input: Expected a path named 'dSYMs' or ending in '.dSYM', '.dSYMs.zip', or '.dSYM.zip'.`);
}

/**
 * Validate the input path and prepare zipped files.
 */
export function prepareUploadFiles(dsymsPath: string, logger: Logger): { zipFiles: string[]; uploadPath: string } {
  const absPath = validateDSYMsPath(dsymsPath);

  // Get the list of zipped dSYM files
  const { zipFiles, uploadPath } = getZippedDSYMs(absPath, logger);

  // Log files for dry-run mode
  if (zipFiles.length === 0) {
    logger.info(`No files found to upload for directory: ${dsymsPath}.`);
    throw new Error('No files to upload.');
  }

  return { zipFiles, uploadPath };
}

/**
 * Given a dSYMs path, process the input as per the specified format and return
 * the zipped files or copied files as necessary.
 **/
export function getZippedDSYMs(dsymsPath: string, logger: Logger): { zipFiles: string[], uploadPath: string } {
  const absPath = validateDSYMsPath(dsymsPath);

  // Create a unique system temp directory for storing zip files
  const uploadPath = mkdtempSync(join(tmpdir(), 'splunk_dSYMs_upload_'));

  if (absPath.endsWith('dSYMs')) {
    const { dSYMDirs, dSYMZipFiles } = scanDSYMsDirectory(absPath);
    const results: string[] = [];

    for (const dSYMDir of dSYMDirs) {
      logger.info(`Zipping dSYM directory ${dSYMDir}`);
      results.push(zipDSYMDirectory(absPath, dSYMDir, uploadPath));
    }

    for (const zipFile of dSYMZipFiles) {
      const srcPath = join(absPath, zipFile);
      const destPath = join(uploadPath, zipFile);
      try {
        copyFileSync(srcPath, destPath);
      } catch (err) {
        throwAsUserFriendlyErrnoException(err, {
          ENOENT: `Failed to copy ${srcPath} to ${destPath}. Please ensure the file exists and is not in use.`,
          EACCES: `Permission denied while copying ${srcPath}. Please check your access rights.`,
        });
      }
      results.push(destPath);
    }

    return { zipFiles: results, uploadPath };
  } else if (absPath.endsWith('.dSYM.zip') || absPath.endsWith('.dSYMs.zip')) {
    const destPath = join(uploadPath, basename(absPath));
    try {
      copyFileSync(absPath, destPath);
    } catch (err) {
      throwAsUserFriendlyErrnoException(err, {
        ENOENT: `Failed to copy ${absPath} to ${destPath}. Please ensure the file exists and is not in use.`,
        EACCES: `Permission denied while copying ${absPath}. Please check your access rights.`,
      });
    }
    return { zipFiles: [destPath], uploadPath };
  } else if (absPath.endsWith('.dSYM')) {
    const zipPath = zipDSYMDirectory(dirname(absPath), basename(absPath), uploadPath);
    return { zipFiles: [zipPath], uploadPath };
  }

  throw new UserFriendlyError(null, `Unexpected error with the provided input path.`);
}

/**
 * Scan the `dSYMs/` directory and return categorized lists of `.dSYM/` directories and `.dSYM.zip` files.
 */
function scanDSYMsDirectory(dsymsPath: string): { dSYMDirs: string[], dSYMZipFiles: string[] } {
  const files = readdirSync(dsymsPath);
  const dSYMDirs: string[] = [];
  const dSYMZipFiles: string[] = [];

  for (const file of files) {
    const fullPath = join(dsymsPath, file);

    try {
      if (file.endsWith('.dSYM') && statSync(fullPath).isDirectory()) {
        dSYMDirs.push(file);
      } else if (file.endsWith('.dSYM.zip') && statSync(fullPath).isFile()) {
        dSYMZipFiles.push(file);
      }
    } catch (err) {
      throwAsUserFriendlyErrnoException(err, {
        ENOENT: `Error accessing file or directory at ${fullPath}. Please ensure it exists and is accessible.`,
      });
    }
  }
  return { dSYMDirs, dSYMZipFiles };
}

/**
 * Zip a single `dSYM/` directory into the provided `uploadPath` directory.
 * Returns the full path of the created `.zip` file.
 */
function zipDSYMDirectory(parentPath: string, dsymDirectory: string, uploadPath: string): string {
  const sourcePath = join(parentPath, dsymDirectory);
  const zipPath = join(uploadPath, `${dsymDirectory}.zip`);

  try {
    execSync(`zip -r '${zipPath}' '${sourcePath}'`, { stdio: 'ignore' });
  } catch (err) {
    throw new UserFriendlyError(err, `Failed to zip ${sourcePath}. Please ensure you have the necessary permissions and that the zip command is available.`);
  }

  return zipPath;
}

/**
 * Remove the temporary upload directory and all files inside it.
 */
export function cleanupTemporaryZips(uploadPath: string): void {
  if (!uploadPath.includes('splunk_dSYMs_upload_')) {
    console.warn(`Warning: refusing to delete '${uploadPath}' as it does not appear to be a temp dSYMs upload directory.`);
    return;
  }
  try {
    rmSync(uploadPath, { recursive: true, force: true });
  } catch (err) {
    console.warn(`Warning: Failed to remove temporary directory '${uploadPath}'.`, err);
  }
}
