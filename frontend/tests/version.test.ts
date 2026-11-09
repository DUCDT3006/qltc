import assert from 'node:assert/strict';
import { test } from 'node:test';
import { canDownloadRelease, compareVersions, loadLatestRelease } from '../src/components/SettingsModal';

test('compare numeric Android versions, including multi-digit components', () => {
  assert.equal(compareVersions('2.0.2', 'v2.0.3'), -1);
  assert.equal(compareVersions('2.0.3', 'v2.0.3'), 0);
  assert.equal(compareVersions('2.0.4', 'v2.0.3'), 1);
  assert.equal(compareVersions('v2.0.10', 'v2.0.9'), 1);
  assert.equal(compareVersions('v1.9.9', 'v2.0.0'), -1);
  assert.equal(compareVersions('latest', 'v2.0.3'), null);
});

test('only offer an Android update when its version is newer; web can download', () => {
  assert.equal(canDownloadRelease('2.0.2', 'v2.0.3'), true);
  assert.equal(canDownloadRelease('2.0.3', 'v2.0.3'), false);
  assert.equal(canDownloadRelease('2.0.4', 'v2.0.3'), false);
  assert.equal(canDownloadRelease(null, 'v2.0.3'), true);
});

test('do not report an available release when both sources are unavailable', async () => {
  const fail = (async () => { throw new Error('offline'); }) as typeof fetch;
  assert.equal(await loadLatestRelease(fail), null);
});

test('use an available source and choose the newest valid GitHub APK', async () => {
  const fetcher = (async (input: string | URL | Request) => {
    if (String(input).includes('api.github.com')) {
      return Response.json({ tag_name: 'v2.0.10', assets: [{ name: 'app.apk', browser_download_url: 'https://example.com/app.apk' }] });
    }
    return Response.json({ versionName: '2.0.9', latestApkUrl: 'https://example.com/old.apk' });
  }) as typeof fetch;
  assert.deepEqual(await loadLatestRelease(fetcher), { tagName: 'v2.0.10', apkUrl: 'https://example.com/app.apk', body: undefined });
  const githubOnly = (async (input: string | URL | Request) => String(input).includes('api.github.com')
    ? Response.json({ tag_name: 'v2.0.3', assets: [{ name: 'app.apk', browser_download_url: 'https://example.com/app.apk' }] })
    : new Response(null, { status: 503 })) as typeof fetch;
  assert.equal((await loadLatestRelease(githubOnly))?.tagName, 'v2.0.3');
});
