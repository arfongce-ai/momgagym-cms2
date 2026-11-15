// 고니오메타 화면이 실제로 그려지는지(렌더 중 예외 없음) 확인하는 회귀 테스트.
//  소스 문자열 검사만으로는 "선언 전 변수 사용(TDZ)" 같은 렌더 크래시를 못 잡는다.
import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToString } from 'react-dom/server';
import RomSensorGoniometer from '../ai-measure/menus/RomSensorGoniometer.jsx';

describe('고니오메타 화면 렌더', () => {
  it('첫 화면이 예외 없이 그려진다', () => {
    const html = renderToString(
      React.createElement(RomSensorGoniometer, { jointName: '무릎', jointKey: 'knee', onBack() {}, onComplete() {} }),
    );
    expect(html).toContain('고니오메타');
  });
});
