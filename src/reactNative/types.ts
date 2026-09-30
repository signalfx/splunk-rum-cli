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


export type ReactNativePlatform = 'android' | 'ios';
export type ReactNativeJsEngine = 'hermes' | 'jsc';

export interface ReactNativeSourceMapUploadResultV1 {
  schemaVersion: 1;
  platform: ReactNativePlatform;
  jsEngine: ReactNativeJsEngine;
  artifacts: ReactNativePreparedArtifact[];
}

export interface ReactNativePreparedArtifact {
  bundleName: string;
  sourceMapId: string;
  mapIdentityNeedsStaging: boolean;
}

export interface ReactNativeBundleArtifactInput {
  bundleName?: string;
  bundlePath: string;
  sourceMapPath: string;
}

export interface ReactNativeSourceMapUploadOptions {
  platform: ReactNativePlatform;
  engine: ReactNativeJsEngine;
  bundleName?: string;
  bundlePath?: string;
  sourceMapPath?: string;
  artifacts?: ReactNativeBundleArtifactInput[];
  artifactsConfigPath?: string;
  artifactsDirectoryPath?: string;
  realm: string;
  token: string;
  strict?: boolean;
  dryRun?: boolean;
  debug?: boolean;
}
