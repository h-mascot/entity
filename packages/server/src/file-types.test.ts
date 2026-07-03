import { describe, expect, it } from 'vitest';
import { contentTypeFromExtension, detectContentType } from './file-types';

describe('file type detection', () => {
  it('resolves common audio and video extensions', () => {
    expect(contentTypeFromExtension('track.mp3')).toBe('audio/mpeg');
    expect(contentTypeFromExtension('voice.m4a')).toBe('audio/mp4');
    expect(contentTypeFromExtension('capture.weba')).toBe('audio/webm');
    expect(contentTypeFromExtension('clip.mp4')).toBe('video/mp4');
    expect(contentTypeFromExtension('movie.mov')).toBe('video/quicktime');
    expect(contentTypeFromExtension('archive.mkv')).toBe('video/x-matroska');
  });

  it('uses media extensions when a generic header is supplied', () => {
    expect(
      detectContentType({
        filePath: 'clip.webm',
        headerContentType: 'application/octet-stream',
      }),
    ).toEqual({
      contentType: 'video/webm',
      isBinary: true,
    });
  });
});
