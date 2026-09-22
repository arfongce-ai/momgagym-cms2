// 기존 11개 실패는 넘어가고, 통과 개수가 기준선보다 줄면(=새 회귀) CI를 실패시킵니다.
const fs = require('fs');

const baseline = JSON.parse(fs.readFileSync('.github/test-baseline.json', 'utf8'));
const result = JSON.parse(fs.readFileSync('test-results.json', 'utf8'));

const passed = result.numPassedTests;
const total = result.numTotalTests;

console.log('현재: ' + passed + '/' + total + ' 통과, 기준선: ' + baseline.minPassing + '/' + baseline.total);

if (passed < baseline.minPassing) {
    console.error('회귀 발생: 기준선보다 ' + (baseline.minPassing - passed) + '개 더 실패합니다.');
    process.exit(1);
}

console.log('새로운 회귀 없음.');
