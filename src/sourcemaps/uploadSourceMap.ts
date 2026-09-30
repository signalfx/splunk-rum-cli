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
import { attachApiInterceptor } from '../utils/apiInterceptor';
import {
  API_VERSION_STRING,
  BASE_URL_PREFIX,
  DEFAULT_DOMAIN,
  SOURCEMAPS_CONSTANTS
} from '../utils/constants';
import { uploadFile } from '../utils/httpUtils';
import { formatUploadProgress } from '../utils/stringUtils';
import type { SourceMapUploadContext } from '.';

export interface UploadSourceMapOptions {
  sourceMapPath: string;
  sourceMapId: string;
  realm: string;
  token: string;
  metadata: Record<string, string | number>;
  dryRun?: boolean;
  progressText?: (totalFormatted: string) => string;
}

export async function uploadSourceMap(
  options: UploadSourceMapOptions,
  context: SourceMapUploadContext
): Promise<void> {
  const { logger, spinner } = context;
  const url = getSourceMapUploadUrl(options.realm, options.sourceMapId);

  logger.debug('Uploading %s', options.sourceMapPath);
  logger.debug('PUT', url);

  if (options.dryRun) {
    logger.info(
      'sourceMapId %s would be used to upload %s',
      options.sourceMapId,
      options.sourceMapPath
    );
    return;
  }

  const axiosInstance = axios.create();
  attachApiInterceptor(axiosInstance, logger, url, {
    userFriendlyMessage: 'An error occurred during source map upload.'
  });
  await uploadFile({
    url,
    file: {
      filePath: options.sourceMapPath,
      fieldName: 'file',
    },
    token: options.token,
    parameters: options.metadata,
    onProgress: ({ loaded, total }) => {
      const { totalFormatted } = formatUploadProgress(loaded, total);
      spinner.updateText(
        options.progressText?.(totalFormatted)
        ?? `Uploading ${options.sourceMapPath} | ${totalFormatted}`
      );
    },
  }, axiosInstance);
}

export function getSourceMapUploadUrl(realm: string, idPathParam: string): string {
  const apiBaseUrl = `${BASE_URL_PREFIX}.${realm}.${DEFAULT_DOMAIN}`;
  return `${apiBaseUrl}/${API_VERSION_STRING}/${SOURCEMAPS_CONSTANTS.PATH_FOR_UPLOAD}/id/${idPathParam}`;
}
