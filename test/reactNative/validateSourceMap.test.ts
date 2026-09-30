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


import { validateReactNativeSourceMap } from '../../src/reactNative/validateSourceMap';
import { UserFriendlyError } from '../../src/utils/userFriendlyErrors';

const FIXTURE_DIRECTORY = 'test/fixtures/react-native';

describe('validateReactNativeSourceMap', () => {
  test('accepts a final flat Hermes Source Map v3 file', async () => {
    const result = await validateReactNativeSourceMap({
      sourceMapPath: `${FIXTURE_DIRECTORY}/final-hermes.bundle.map`,
      engine: 'hermes',
      strict: true,
    });

    expect(result.warnings).toEqual([]);
    expect(result.evidence).toMatchObject({
      version: 3,
      sourceCount: 2,
      hasHermesFunctionOffsets: true,
    });
  });

  test('accepts a flat JSC Source Map v3 file', async () => {
    await expect(validateReactNativeSourceMap({
      sourceMapPath: `${FIXTURE_DIRECTORY}/final-jsc.jsbundle.map`,
      engine: 'jsc',
      strict: true,
    })).resolves.toMatchObject({ warnings: [] });
  });

  test.each([
    'index.android.bundle.packager.map',
    'index.android.bundle.compiler.map',
  ])('rejects the known Hermes intermediate %s', async (fileName) => {
    await expect(validateReactNativeSourceMap({
      sourceMapPath: `${FIXTURE_DIRECTORY}/${fileName}`,
      engine: 'hermes',
    })).rejects.toThrow(/intermediate React Native build artifact/);
  });

  test('rejects indexed source maps', async () => {
    await expect(validateReactNativeSourceMap({
      sourceMapPath: `${FIXTURE_DIRECTORY}/indexed.bundle.map`,
      engine: 'jsc',
    })).rejects.toThrow(/sections/);
  });

  test('rejects malformed JSON with a user-friendly error', async () => {
    await expect(validateReactNativeSourceMap({
      sourceMapPath: `${FIXTURE_DIRECTORY}/malformed.bundle.map`,
      engine: 'jsc',
    })).rejects.toBeInstanceOf(UserFriendlyError);
  });

  test('rejects Hermes metadata when the declared engine is JSC', async () => {
    await expect(validateReactNativeSourceMap({
      sourceMapPath: `${FIXTURE_DIRECTORY}/final-hermes.bundle.map`,
      engine: 'jsc',
    })).rejects.toThrow(/--engine is jsc/);
  });

  test('warns for inconclusive Hermes composition evidence and fails in strict mode', async () => {
    const sourceMapPath = `${FIXTURE_DIRECTORY}/final-jsc.jsbundle.map`;

    await expect(validateReactNativeSourceMap({
      sourceMapPath,
      engine: 'hermes',
    })).resolves.toMatchObject({
      warnings: expect.arrayContaining([
        expect.stringContaining('x_hermes_function_offsets')
      ])
    });

    await expect(validateReactNativeSourceMap({
      sourceMapPath,
      engine: 'hermes',
      strict: true,
    })).rejects.toThrow(/strict validation/);
  });
});
