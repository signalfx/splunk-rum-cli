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

/*
 * Centralized constants for the Splunk RUM CLI.
 */

// Global Constants
export const API_VERSION_STRING = 'v2';
export const BASE_URL_PREFIX = 'https://api';
export const TOKEN_HEADER = 'X-SF-Token';

// Domain Constants
export const DEFAULT_DOMAIN = 'observability.splunkcloud.com';
export const LEGACY_DOMAIN = 'signalfx.com';

// Android-Specific Constants
export const ANDROID_CONSTANTS = {
  PATH_FOR_UPLOAD: 'rum-mfm/proguard',
  PATH_FOR_METADATA: 'rum-mfm/proguard/metadatas',
};

// iOS-Specific Constants
export const IOS_CONSTANTS = {
  PATH_FOR_UPLOAD: 'rum-mfm/dsym',
  PATH_FOR_METADATA: 'rum-mfm/macho/metadatas',
};

// Sourcemaps-Specific Constants
export const SOURCEMAPS_CONSTANTS = {
  PATH_FOR_UPLOAD: 'rum-mfm/source-maps',
  PATH_FOR_METADATA: 'rum-mfm/source-maps/metadatas',
};

