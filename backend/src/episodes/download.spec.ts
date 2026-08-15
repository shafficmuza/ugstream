import * as fs from 'fs';
import * as path from 'path';

/**
 * download() must be play() with a different last step, never a parallel
 * implementation. The moment it re-implements its own checks, the weaker
 * copy becomes the way to reach a video the stronger one refuses — the
 * audience split and the paywall are only as strong as the least-guarded
 * route to the bytes.
 */
describe('offline downloads share the viewing gate', () => {
  const source = fs.readFileSync(path.join(__dirname, 'episodes.service.ts'), 'utf8');

  it('play() and download() both call gateForViewing', () => {
    const calls = source.match(/await this\.gateForViewing\(/g) ?? [];
    expect(calls.length).toBeGreaterThanOrEqual(2);
  });

  it('the gate exists exactly once', () => {
    const defs = source.match(/private async gateForViewing\(/g) ?? [];
    expect(defs).toHaveLength(1);
  });

  it('download() never claims a concurrent-stream slot', () => {
    const start = source.indexOf('async download(');
    const end = source.indexOf('async play(');
    expect(start).toBeGreaterThan(-1);
    const body = source.slice(start, end > start ? end : undefined);
    expect(body).not.toMatch(/claimStream|streamSlot/);
  });

  it('the download token is the downloadable variant, not the playback one', () => {
    const start = source.indexOf('async download(');
    const end = source.indexOf('async play(');
    const body = source.slice(start, end > start ? end : undefined);
    expect(body).toMatch(/signDownloadToken/);
    expect(body).not.toMatch(/signPlaybackToken/);
  });
});
