import { describe, expect, it } from 'vitest';
import { dataUrlToFile } from '../ai-measure/core/reportShare';

// 1x1 투명 PNG data URL
const PNG_1PX =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const JPEG_DATA = 'data:image/jpeg;base64,/9j/4AAQSkZJRg==';

describe('dataUrlToFile', () => {
  it('data:URL을 File로 변환하고 MIME/이름을 보존한다', () => {
    const file = dataUrlToFile(PNG_1PX, '자세_정면.png');
    expect(file).toBeInstanceOf(File);
    expect(file.name).toBe('자세_정면.png');
    expect(file.type).toBe('image/png');
    expect(file.size).toBeGreaterThan(0);
  });

  it('jpeg MIME를 올바르게 추출한다', () => {
    const file = dataUrlToFile(JPEG_DATA, 'snap.jpg');
    expect(file.type).toBe('image/jpeg');
  });

  it('잘못된 입력은 throw 한다', () => {
    expect(() => dataUrlToFile('', 'x.jpg')).toThrow();
    expect(() => dataUrlToFile('http://example.com/a.png', 'x.jpg')).toThrow();
    expect(() => dataUrlToFile(null, 'x.jpg')).toThrow();
  });
});
