# AI 측정·분석 — 공통 측정 흐름 규약

AI 측정·분석 안의 **모든 측정 모듈**(신체정보·자세·ROM·점프·바벨·보행 및
앞으로 추가되는 측정)은 아래 흐름을 동일하게 따른다.

```
측정 → 측정완료 → 기록 → 확인·저장 → 기록 확인
```

- **측정**: 각 모듈의 측정 화면(카메라/센서/영상/입력).
- **측정완료**: 결과 산출. 이 시점에는 아직 저장하지 않는다.
- **기록**: 공용 `MeasureRecordConfirm` 로 결과 요약을 확인하고,
  움직임(관절 측정) 또는 메모를 남긴다.
- **확인·저장**: `확인 · 저장` 버튼 → 그때 실제 Firestore 저장(자동).
- **기록 확인**: 저장 후 결과 리포트로 전환되어 방금 기록을 확인한다.

## 새 측정 모듈 추가 방법

1. 모듈 훅에 `view` 상태를 둔다: `'measure' | 'record' | 'report'`.
2. 측정완료 콜백에서 결과를 `pending` 에 담고 `setView('record')`.
   (여기서 저장하지 않는다.)
3. `record` 뷰에서 공용 컴포넌트를 렌더한다:

```jsx
import MeasureRecordConfirm from '../components/MeasureRecordConfirm.jsx';

<MeasureRecordConfirm
  title="측정 이름"
  summaryRows={[{ label: '지표', value: '값' }]}
  noteMode            // 자유 메모 (일반 측정)
  // movementMode     // 움직임 셀렉트 (ROM·관절 측정)
  onConfirm={(record) => persist(pending, record)}
  onBack={backToMeasure}
  saving={saveState === 'saving'}
  saved={saveState === 'saved'}
  error={saveState === 'error'}
/>
```

4. `persist` 에서 실제 저장(`onSave`/`onSaveToFirebase`)을 수행하고,
   성공 시 `setView('report')` 로 기록 확인 화면을 띄운다.
5. 폰 뒤로가기 연동: `useHardwareBack((view==='report' && !!report) || view==='record', backToMeasure)`.

## 참고 구현

- `RomSensorGoniometer.jsx` — 움직임 기록(movementMode) 흐름.
- `JumpAnalysisHub.jsx` / `GaitAnalysisHub.jsx` / `BarbellLiftingHub.jsx`
  — 메모 기록(noteMode) 흐름.
- `BodyInfoMeasure.jsx` — 분석=측정완료, 인라인 확인·저장.
