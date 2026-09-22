// src/components/common/KioskVoiceCommand.jsx
// 키오스크 모드 전용 음성 명령 — GlobalVoiceCommand.jsx(버튼식)와 달리 버튼이
// 없다. 화면이 뜨는 즉시 자동으로 "모미야" 상시 감지를 시작해서, 트레이너가
// 회원 스팟 중이라 손이 자유롭지 않은 키오스크의 핵심 시나리오에 맞춘다.
// 명령 처리·음성 응답 로직 자체는 GlobalVoiceCommand.jsx와 동일(같은
// useMomiVoice/useMomiSpeech/processVoiceCommand 조합) — 언제·어떻게
// 켜지는지(자동 vs 클릭)와 화면 표시(상태 표시등 vs 클릭 버튼)만 다르다.
//
// iOS 오디오 잠금 트릭(GlobalVoiceCommand의 unlockSpeech)은 여기서 안 쓴다 —
// 키오스크는 항상 게이밍 노트북(Windows/Chrome)이라 해당 없음.
import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMomiVoice } from '../../hooks/useMomiVoice';
import { useMomiSpeech } from '../../hooks/useMomiSpeech';
import MomiVoiceStage, { STAGE_FADE_MS } from './MomiVoiceStage';
import { useCameraStageActive } from '../../ai-measure/core/cameraStageActive';
import { processVoiceCommand, buildTimerControlMessage } from '../../services/voiceCommandService';
import {
  buildReservationSummary,
  buildCancelSummary,
  buildRescheduleSummary,
  interpretConfirmationReply,
  confirmReservation,
  cancelReservation,
  rescheduleReservation,
} from '../../services/reservationService';
// [momi 쓰기 권한 확장 2026-08-10] GlobalVoiceCommand.jsx와 동일 — 예약류와
// 같은 확인 흐름을 타는 새 쓰기 기능 3종.
import {
  buildAddMemoSummary,
  confirmAddMemberMemo,
  buildAdjustSessionSummary,
  confirmAdjustSessionCount,
  buildUpdateInfoSummary,
  confirmUpdateMemberInfo,
} from '../../services/memberWriteService';
import { useAuth } from '../../contexts/AuthContext';
import { store } from '../../demoData';
import { scopeMembersToTrainer, sortByName } from '../../utils/memberList';
import { getActiveHistory, recordChatTurn, clearHistory } from '../../voice/chatHistory';

export default function KioskVoiceCommand() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const role = user?.role === 'admin' ? 'admin' : 'trainer';
  const allMembers = useMemo(
    () => sortByName(scopeMembersToTrainer(store.getMembers(), user)),
    [user]
  );
  // [무료 확장 2026-08-11] GlobalVoiceCommand.jsx와 동일 — 세션 조정 규칙기반
  // 매칭의 "트레이너 이름 언급되면 Claude로" 안전장치에 쓴다.
  const allTrainers = useMemo(() => store.getTrainers(), []);
  const [feedback, setFeedback] = useState('');
  const [busy, setBusy] = useState(false);
  const [interimText, setInterimText] = useState('');
  // [화면에서 사라지는 모미 2026-09c] GlobalVoiceCommand.jsx와 완전히 동일한 흐름 —
  // 평소엔 화면에 아무것도 없고, "모미야"라고 부른 순간에만 전체화면 음성인식
  // 그래프가 그라데이션으로 떠올랐다가 명령이 끝나면 사라진다. 상시 감지 기기라
  // 예전처럼 상태 표시등(오브)을 계속 띄워두면 화면을 영구히 차지하게 된다.
  const [micLevel, setMicLevel] = useState(0);
  const [bands, setBands] = useState(null);
  const [confidence, setConfidence] = useState(null);
  const [stagePhase, setStagePhase] = useState(null);
  const stagePhaseRef = useRef(null);
  const stageTimerRef = useRef(null);
  const stageIdleTimerRef = useRef(null);
  const lastShownErrorRef = useRef({ code: null, at: 0 });
  const [closeRequested, setCloseRequested] = useState(false);

  const openStage = useCallback(() => {
    setCloseRequested(false);
    if (stageTimerRef.current) clearTimeout(stageTimerRef.current);
    // [2026-09-22] 앞선 "모미야"가 걸어둔 9.5초 자동 닫힘 타이머가 남아 있으면,
    // 그 사이 시작된 새 대화를 중간에 닫아버린다 — 열 때마다 정리한다.
    if (stageIdleTimerRef.current) clearTimeout(stageIdleTimerRef.current);
    setStagePhase('open');
  }, []);

  const handleRecognitionMeta = useCallback((meta) => {
    setConfidence(meta.confidence > 0 ? meta.confidence : null);
    if (meta.matched) openStage();
  }, [openStage]);

  // 무대가 떠 있는 동안에만 음량·그래프를 state로 올린다(대기 중엔 리렌더 0).
  const handleAudioLevel = useCallback((lv, nextBands) => {
    if (!stagePhaseRef.current) return;
    setMicLevel(lv);
    if (nextBands) setBands(Array.from(nextBands));
  }, []);

  const { speaking, speak } = useMomiSpeech();

  // [2026-08-18] "momi 버튼이 계속 화면을 가린다" — GlobalVoiceCommand.jsx와
  // 동일한 이유. 키오스크는 버튼이 아니라 상시 표시등이라 완전히 숨기진 않고
  // 측정 화면(CameraStage)이 뜬 동안엔 반투명하게만 낮춘다.
  const cameraActive = useCameraStageActive();

  // [예약 생성 프로젝트 2단계 2026-08-08] awaitReply는 useMomiVoice()가 반환하는데,
  // useMomiVoice()는 아래에서 handleCommand를 onCommand로 넘겨받는 쪽이라 같은 렌더
  // 안에서 "handleCommand → runReservationConfirmFlow가 awaitReply를 직접 참조"하는
  // 식으로는 정의 순서가 꼬인다(호출 자체는 나중이라 문제없지만, 순환 의존을 피하려고
  // ref로 다리를 놓는 편이 더 명확함). awaitReply 자체는 useMomiVoice 내부에서
  // deps:[]인 안정적 함수라 ref에 담아두면 항상 최신 값을 가리킨다.
  const awaitReplyRef = useRef(null);

  // [버그 수정 — 명령 겹침 2026-08-09] useMomiVoice.js의 onresult는 onCommand를
  // await 없이 fire-and-forget으로 부른다. 그래서 이전 "모미야, [명령]"이 아직
  // 처리 중(특히 네트워크 응답을 기다리는 동안, awaitReply를 걸기 전)일 때 새
  // "모미야, [명령]"이 겹쳐 들어오면 handleCommand가 두 번 동시에 돌게 된다.
  // 예약 확인 흐름은 awaitReply 슬롯이 훅 안에 딱 하나뿐이라, 두 번째 호출이
  // awaitReply를 걸면 첫 번째 호출이 걸어둔 콜백/타이머가 조용히 덮어써져서
  // 첫 명령의 확인 흐름이 응답을 영영 못 받고 멈춰버린다 — 예약 생성/취소/변경
  // 처럼 실제 데이터를 바꾸는 작업 중간에 이 상태로 남으면 특히 위험하다. 한
  // 번에 한 명령만 처리하도록 막는다.
  const isHandlingRef = useRef(false);

  // [음성 대화형 2026-08-09] "모미야"로 나눈 자유 질문 대화의 맥락 — 실제
  // 관리 로직은 voice/chatHistory.js(순수 함수, 별도 테스트됨)에 있고 여기선
  // ref 두 개만 들고 있는다.
  const chatHistoryRef = useRef([]);
  const lastChatAtRef = useRef(null);

  // [예약 생성 프로젝트 3단계 2026-08-09] 요약 말하기 → awaitReply → 확인/취소/
  // 불명확 분기라는 뼈대는 "예약 만들기 확인"과 "예약 취소 확인"이 완전히 같다
  // — 실제로 할 일(onConfirm)과 문구만 다르다. 그 부분만 인자로 받는 공통
  // 함수로 뽑아서 두 흐름이 따로 벌어지지 않게 한다.
  const runVoiceConfirmFlow = useCallback(
    ({ summary, onConfirm, onCancelMessage }) => {
      return new Promise((resolve) => {
        const awaitReply = awaitReplyRef.current;
        if (!awaitReply) {
          // 이론상 마운트 직후가 아니면 항상 있어야 하지만, 방어적으로 처리.
          const msg = '지금은 확인을 받을 수 없어요. 다시 말씀해주세요.';
          setFeedback(msg);
          speak(msg);
          setTimeout(() => setFeedback(''), 5000);
          resolve();
          return;
        }

        setFeedback(summary);
        speak(summary);

        awaitReply((heard) => {
          const decision = interpretConfirmationReply(heard);
          if (decision === 'confirm') {
            Promise.resolve()
              .then(onConfirm)
              .then((okMessage) => {
                setFeedback(okMessage);
                speak(okMessage);
                setTimeout(() => setFeedback(''), 5000);
              })
              .catch((e) => {
                const fail = '죄송해요, 처리 중 오류가 났어요.';
                setFeedback(fail);
                console.warn('[모미] 확인 작업 실패:', e?.message || e);
                speak(fail);
                setTimeout(() => setFeedback(''), 8000);
              })
              .finally(resolve);
          } else if (decision === 'cancel') {
            setFeedback(onCancelMessage);
            speak(onCancelMessage);
            setTimeout(() => setFeedback(''), 4000);
            resolve();
          } else {
            // unclear·timeout — 판단 근거가 없을 땐 진행하지 않는 쪽이 안전하다
            // (데이터를 쓰거나 지우는 작업은 애매하면 항상 사람에게 다시 확인받는다).
            const msg = '못 알아들어서 진행하지 않았어요. 다시 말씀해주세요.';
            setFeedback(msg);
            speak(msg);
            setTimeout(() => setFeedback(''), 5000);
            resolve();
          }
        }, 12000);
      });
    },
    [speak]
  );

  // 안내만 하고 확인 없이 바로 끝내는 경우(대상 특정 실패 등) 공통 처리.
  const announceAndFinish = useCallback(
    (message, timeoutMs = 6000) => {
      setFeedback(message);
      speak(message);
      setTimeout(() => setFeedback(''), timeoutMs);
      return Promise.resolve();
    },
    [speak]
  );

  // [예약 생성 프로젝트 2단계 2026-08-08] propose_reservation 결과(아직 저장 안 됨)를
  // 받으면 요약을 말해주고 확인을 기다린 뒤에만 실제로 저장한다.
  const runReservationConfirmFlow = useCallback(
    (propose) => {
      const { draft, warnings } = propose;
      // date/startTime/trainerId 중 하나라도 없으면 draft 자체가 저장 불가능한
      // 상태라, 확인을 받는 것 자체가 의미 없다 — 바로 안내하고 끝낸다.
      const hasBlockingIssue = !draft?.date || !draft?.startTime || !draft?.trainerId;
      if (hasBlockingIssue) {
        return announceAndFinish(
          warnings?.[0] || '예약 정보가 부족해서 진행할 수 없어요. 회원·트레이너·일시를 다시 말씀해주세요.'
        );
      }
      return runVoiceConfirmFlow({
        summary: buildReservationSummary(propose),
        onConfirm: () =>
          confirmReservation(draft).then(
            () => `${draft.memberName ? draft.memberName + '님 ' : ''}${draft.date} ${draft.startTime} 예약을 등록했어요.`
          ),
        onCancelMessage: '알겠습니다, 예약은 만들지 않을게요.',
      });
    },
    [runVoiceConfirmFlow, announceAndFinish]
  );

  // [예약 생성 프로젝트 3단계 2026-08-09] propose_cancel_reservation 결과(아직
  // 안 지워짐)를 받으면 대상을 요약해 확인받고, 확인 후에만 실제로 취소한다.
  // 대상을 하나로 특정 못 했으면(여러 건/없음) 확인 자체를 안 받고 바로 안내한다
  // — 되돌릴 수 없는 삭제라 애매하면 절대 진행하지 않는다.
  const runCancelConfirmFlow = useCallback(
    (propose) => {
      const { schedule, warnings } = propose;
      if (!propose.ready || !schedule) {
        return announceAndFinish(warnings?.[0] || '취소할 예약을 찾지 못했어요.');
      }
      return runVoiceConfirmFlow({
        summary: buildCancelSummary(propose),
        onConfirm: () =>
          cancelReservation(schedule.id).then(
            () => `${schedule.memberName ? schedule.memberName + '님 ' : ''}${schedule.date} ${schedule.startTime} 예약을 취소했어요.`
          ),
        onCancelMessage: '알겠습니다, 예약은 그대로 둘게요.',
      });
    },
    [runVoiceConfirmFlow, announceAndFinish]
  );

  // [예약 생성 프로젝트 4단계 2026-08-09] propose_reschedule_reservation 결과
  // (아직 안 바뀜)를 받으면 "OO 일시 → 새 일시"를 요약해 확인받고, 확인 후에만
  // 실제로 옮긴다. 옮길 대상 자체를 특정 못 했으면(여러 건/없음) 확인 없이 바로
  // 안내한다. 새 시간대 충돌 경고는(있다면) 소프트 경고라 여기서 막지 않고
  // buildRescheduleSummary가 문구에 이어 붙여 트레이너가 듣고 최종 판단한다.
  const runRescheduleConfirmFlow = useCallback(
    (propose) => {
      const { schedule, newDraft, warnings } = propose;
      if (!schedule || !newDraft) {
        return announceAndFinish(warnings?.[0] || '옮길 예약을 찾지 못했어요.');
      }
      return runVoiceConfirmFlow({
        summary: buildRescheduleSummary(propose),
        onConfirm: () =>
          rescheduleReservation(schedule.id, newDraft).then(
            () => `${schedule.memberName ? schedule.memberName + '님 ' : ''}예약을 ${newDraft.date} ${newDraft.startTime}로 옮겼어요.`
          ),
        onCancelMessage: '알겠습니다, 예약은 그대로 둘게요.',
      });
    },
    [runVoiceConfirmFlow, announceAndFinish]
  );

  // [momi 쓰기 권한 확장 2026-08-10] GlobalVoiceCommand.jsx와 동일한 이유·동일한
  // 3개 확인 흐름(메모 추가/세션 조정/기본정보 수정).
  const runMemoAddConfirmFlow = useCallback(
    (propose) => {
      const { member, memoText, warnings } = propose;
      if (!member || !memoText) {
        return announceAndFinish(warnings?.[0] || '메모를 추가할 회원이나 내용을 다시 말씀해주세요.');
      }
      return runVoiceConfirmFlow({
        summary: buildAddMemoSummary(propose),
        onConfirm: () => confirmAddMemberMemo({ member, memoText }).then(() => `${member.name}님 메모에 추가했어요.`),
        onCancelMessage: '알겠습니다, 메모는 추가하지 않을게요.',
      });
    },
    [runVoiceConfirmFlow, announceAndFinish]
  );

  const runSessionAdjustConfirmFlow = useCallback(
    (propose) => {
      const { member, trainerId, delta, warnings } = propose;
      if (!propose.ready || !member || !trainerId || !delta) {
        return announceAndFinish(warnings?.[0] || '세션을 조정할 회원·트레이너·횟수를 다시 말씀해주세요.');
      }
      return runVoiceConfirmFlow({
        summary: buildAdjustSessionSummary(propose),
        onConfirm: () =>
          confirmAdjustSessionCount({ member, trainerId, delta }).then(
            () => `${member.name}님 세션을 ${delta > 0 ? delta + '회 추가' : Math.abs(delta) + '회 차감'}했어요.`
          ),
        onCancelMessage: '알겠습니다, 세션은 그대로 둘게요.',
      });
    },
    [runVoiceConfirmFlow, announceAndFinish]
  );

  const runMemberInfoUpdateConfirmFlow = useCallback(
    (propose) => {
      const { member, field, newValue, warnings } = propose;
      if (!member || !field || !newValue) {
        return announceAndFinish(warnings?.[0] || '수정할 회원·정보·새 값을 다시 말씀해주세요.');
      }
      return runVoiceConfirmFlow({
        summary: buildUpdateInfoSummary(propose),
        onConfirm: () =>
          confirmUpdateMemberInfo({ member, field, newValue }).then(() => `${member.name}님 ${propose.fieldLabel}를 바꿨어요.`),
        onCancelMessage: '알겠습니다, 정보는 그대로 둘게요.',
      });
    },
    [runVoiceConfirmFlow, announceAndFinish]
  );

  const handleCommand = useCallback(
    async (transcript) => {
      if (isHandlingRef.current) {
        // [버그 수정 — 명령 겹침 2026-08-09] 위 isHandlingRef 선언부 설명 참고.
        // 이전 명령이 끝날 때까지 새 명령은 받지 않는다(조용히 무시하지만
        // 원인 파악용으로 콘솔엔 남긴다).
        console.warn('[모미] 이전 명령이 아직 처리 중이라 이번 명령은 건너뜁니다:', transcript);
        return;
      }
      isHandlingRef.current = true;
      setInterimText('');
      setBusy(true);
      // [요청 흐름 2026-08-08] "모미야"→"네, 선생님"→(명령)→명령 인지 확인→
      // 실행/응답. GlobalVoiceCommand.jsx와 동일 패턴.
      setFeedback('네, 확인했어요.');
      speak('네, 확인했어요.');
      let message = '';
      // [진단용 2026-08-08] "키오스크에서 반응이 없다"는 문의 대응 — 실패 원인을
      // 화면에도 보여준다. GlobalVoiceCommand.jsx와 동일 패턴.
      let diagDetail = '';
      let handledSeparately = false;
      try {
        const result = await processVoiceCommand({
          transcript,
          role,
          currentUser: user,
          allMembers,
          allTrainers,
          // 화면이 이미 구독해 둔 Firestore 캐시를 재사용하므로 추가 읽기 비용이 없다.
          allSchedules: store.getSchedules(),
          allPayments: store.getAllPayments(),
          navigate,
          mode: 'kiosk', // [예약 생성 프로젝트 2026-08-08] 키오스크=공용 기기, trainerName(말로 지정)만 신뢰.
          // [음성 대화형 2026-08-09] 직전 자유 질문 왕복을 함께 보내서 "그럼
          // 그건요?" 같은 후속 질문을 Claude가 이어서 알아듣게 한다.
          history: getActiveHistory(chatHistoryRef, lastChatAtRef),
        });
        if (result.type === 'reservation_propose') {
          handledSeparately = true;
          clearHistory(chatHistoryRef, lastChatAtRef); // 실제 액션으로 넘어갔으니 잡담 맥락은 정리.
          await runReservationConfirmFlow(result.propose);
        } else if (result.type === 'reservation_cancel_propose') {
          handledSeparately = true;
          clearHistory(chatHistoryRef, lastChatAtRef);
          await runCancelConfirmFlow(result.propose);
        } else if (result.type === 'reservation_reschedule_propose') {
          handledSeparately = true;
          clearHistory(chatHistoryRef, lastChatAtRef);
          await runRescheduleConfirmFlow(result.propose);
        } else if (result.type === 'memo_add_propose') {
          handledSeparately = true;
          clearHistory(chatHistoryRef, lastChatAtRef);
          await runMemoAddConfirmFlow(result.propose);
        } else if (result.type === 'session_adjust_propose') {
          handledSeparately = true;
          clearHistory(chatHistoryRef, lastChatAtRef);
          await runSessionAdjustConfirmFlow(result.propose);
        } else if (result.type === 'member_info_update_propose') {
          handledSeparately = true;
          clearHistory(chatHistoryRef, lastChatAtRef);
          await runMemberInfoUpdateConfirmFlow(result.propose);
        } else if (result.type === 'timer_control') {
          // [음성 타이머 제어 2026-08-09] GlobalVoiceCommand.jsx와 동일 — 확인
          // 없이 바로 실행됐으니 결과만 안내한다.
          clearHistory(chatHistoryRef, lastChatAtRef);
          message = buildTimerControlMessage(result.cmd);
        } else if (result.type === 'chat') {
          message = result.text;
          recordChatTurn(chatHistoryRef, lastChatAtRef, transcript, result.text);
        } else {
          // type === 'navigate' — 화면을 실제로 옮겼으니 잡담 맥락은 정리.
          clearHistory(chatHistoryRef, lastChatAtRef);
          message = result.matchedMember
            ? `${result.matchedMember.name}님으로 이동할게요.`
            : '이동할게요.';
        }
      } catch (e) {
        message = '죄송해요, 잘 처리하지 못했어요. 다시 말씀해주세요.';
        diagDetail = e?.message || String(e);
        console.warn('[모미] 명령 처리 실패:', diagDetail);
      } finally {
        setBusy(false);
        if (!handledSeparately) {
          setFeedback(message);
          speak(message);
          setTimeout(() => setFeedback(''), 5000);
        }
        isHandlingRef.current = false;
        // [화면에서 사라지는 모미 2026-09c] 명령 처리가 끝났다 → 답을 보여준 뒤
        // 무대를 닫는다(아래 effect가 말이 끝날 때까지 기다린다).
        setCloseRequested(true);
      }
    },
    [
      role, user, allMembers, navigate, speak,
      runReservationConfirmFlow, runCancelConfirmFlow, runRescheduleConfirmFlow,
      runMemoAddConfirmFlow, runSessionAdjustConfirmFlow, runMemberInfoUpdateConfirmFlow,
    ]
  );

  const handleWakeOnly = useCallback(() => {
    const message = '네, 선생님.';
    setFeedback(message);
    speak(message);
    setTimeout(() => setFeedback(''), 3000);
    // [화면에서 사라지는 모미 2026-09c] "모미야"를 부른 순간 = 대화 시작 →
    // 그라데이션으로 떠오른다. 명령이 안 오면(웨이크워드 대기창 8초) 혼자
    // 사라져서 키오스크 화면을 돌려준다.
    openStage();
    if (stageIdleTimerRef.current) clearTimeout(stageIdleTimerRef.current);
    stageIdleTimerRef.current = setTimeout(() => setCloseRequested(true), 9500);
  }, [speak, openStage]);

  // [버그 수정 — 상시 반응 오인 2026-08-12] "모미야를 부르기 전에도 계속
  // 반응한다"는 문의. 실제로 명령이 잘못 실행된 건 아니었다(웨이크워드 판정
  // 자체는 정상) — 원인은 이 콜백이 화면 우상단에 "[진단] 들림: ..." 문구를
  // 5초씩 띄우던 것. 상시 감지라 웨이크워드 없는 모든 발화(=트레이너·회원의
  // 일반 대화)가 전부 여기로 들어오는데, 그걸 매번 화면에 노출시키다 보니
  // "계속 반응하는 것처럼" 보였고, 회원 대화 내용이 화면에 뜨는 프라이버시
  // 문제도 겹쳐 있었다. 애초에 이 문구는 "모미야가 반응이 없다"는 문의를
  // 원격으로 진단하려고(2026-08-08) 넣은 것인데, 실사용 단계에 들어오니
  // 부작용이 더 커졌다 — 화면 노출은 끄고, useMomiVoice.js가 이미 모든
  // 발화를 남기는 console.log('[모미] 들린 말:', ...)로 필요시 진단한다.
  const handleMismatch = useCallback((heard) => {}, []);

  const handleErrorOccurred = useCallback((errorCode) => {
    const KNOWN = {
      'not-allowed': '마이크 권한이 거부돼 있어요.',
      'audio-capture': '마이크 장치를 못 찾았어요.',
      network: '인터넷 연결을 확인해주세요.',
      // [버그 수정 2026-08-09] useMomiVoice.js가 재시작을 두 번(즉시+0.3초 뒤)
      // 시도해도 둘 다 실패했을 때만 온다 — 흔치 않은 경우라 새로고침을 안내한다.
      'restart-failed': '음성 인식이 멈췄어요. 화면을 새로고침해주세요.',
    };
    const readable = KNOWN[errorCode] || '음성 인식에 잠시 문제가 생겼어요. 다시 말씀해 주세요.';
    setFeedback(readable);
    // 마이크가 실제로 죽은 경우(restart-failed)는 놓치면 안 되니 더 오래 보여준다.
    const showMs = errorCode === 'restart-failed' ? 15000 : 4000;
    setTimeout(() => setFeedback(''), showMs);
    // [2026-09-22] 모미는 평소 화면에 아무것도 없어서, 권한 거부·마이크 없음·네트워크
    // 오류가 나도 예전엔 전혀 보이지 않았다("불러도 대답이 없다"로만 느껴짐). 오류는
    // 무대를 띄워(빨간 오류 상태) 이유를 보여주고, 표시 시간이 끝나면 닫는다.
    // 권한 거부·네트워크 끊김처럼 재시작할 때마다 같은 오류가 반복되는 경우, 매번
    // 화면 전체를 덮으면 키오스크를 못 쓴다 — 같은 오류는 1분에 한 번만 띄운다.
    const now = Date.now();
    const last = lastShownErrorRef.current;
    if (last.code === errorCode && now - last.at < 60000) return;
    lastShownErrorRef.current = { code: errorCode, at: now };
    openStage();
    stageIdleTimerRef.current = setTimeout(() => setCloseRequested(true), showMs);
  }, [openStage]);

  const { supported, startListening, awaitReply } = useMomiVoice({
    onCommand: handleCommand,
    onWakeOnly: handleWakeOnly,
    onMismatch: handleMismatch,
    onInterim: setInterimText,
    onErrorOccurred: handleErrorOccurred,
    onRecognitionMeta: handleRecognitionMeta,
    // [2026-09-22] 그래프용 측정 마이크는 무대가 떠 있을 때만 연다 — 대기 중(대부분의
    // 시간)엔 인식용 마이크 하나만 쓰게 해서 두 스트림이 부딪칠 여지를 없앤다.
    onAudioLevel: stagePhase ? handleAudioLevel : undefined,
  });

  // awaitReply는 useMomiVoice() 내부에서 deps:[]로 만들어진 안정적 함수라 사실상
  // 마운트 시 한 번만 바뀐다 — ref에 담아 runReservationConfirmFlow가 순환 의존
  // 없이 항상 최신 값을 참조하게 한다(위 awaitReplyRef 선언부 설명 참고).
  useEffect(() => {
    awaitReplyRef.current = awaitReply;
  }, [awaitReply]);

  // [자동 시작] 버튼 클릭을 기다리지 않고 마운트되자마자 감지를 시작한다.
  // useMomiVoice 내부의 onend 자동 재시작(shouldRestartRef)이 계속 이어붙여주므로
  // 이후로도 계속 "상시 감지" 상태가 유지된다.
  // [2026-08-08] 시작 즉시 "상시 감지를 시작합니다"로 알려주던 진단용 확인은
  // 뺐다 — TTS 정상 동작을 실기기로 이미 확인했고(웨이크워드 오인식이 진짜
  // 원인이었음, useMomiVoice.js 참고), 요청하신 흐름엔 "모미야" 앞에 아무
  // 발화가 없어야 해서다.
  useEffect(() => {
    if (supported) startListening();
  }, [supported, startListening]);

  // 무대가 떠 있는지를 ref로도 들고 있는다 — 음량 콜백이 매 프레임 참조한다.
  useEffect(() => {
    stagePhaseRef.current = stagePhase;
    if (!stagePhase) {
      setMicLevel(0);
      setBands(null);
    }
  }, [stagePhase]);

  // 측정 카메라 화면이 뜨면 무대를 즉시 내린다(화면을 가리면 안 된다).
  useEffect(() => {
    if (cameraActive) setStagePhase(null);
  }, [cameraActive]);

  // [화면에서 사라지는 모미 2026-09c] 닫기 요청이 들어와도 모미가 답을 말하는
  // 중이거나 처리 중이면 기다렸다가, 답을 읽을 시간을 잠깐 준 뒤 사라진다.
  useEffect(() => {
    if (!closeRequested || stagePhase !== 'open') return undefined;
    if (busy || speaking) return undefined;
    const hold = setTimeout(() => {
      setStagePhase('closing');
      stageTimerRef.current = setTimeout(() => {
        setStagePhase(null);
        setCloseRequested(false);
      }, STAGE_FADE_MS);
    }, 1400);
    return () => clearTimeout(hold);
  }, [closeRequested, stagePhase, busy, speaking]);

  // 화면을 벗어날 때 무대 타이머도 같이 정리한다.
  useEffect(() => () => {
    if (stageTimerRef.current) clearTimeout(stageTimerRef.current);
    if (stageIdleTimerRef.current) clearTimeout(stageIdleTimerRef.current);
  }, []);

  if (!supported) {
    // [진단용 2026-08-08] "키오스크에서 반응이 없다"는 문의 대응 — 예전엔 미지원
    // 브라우저면 그냥 아무것도 안 그려서(return null), 반응이 없는 게 "미지원
    // 때문"인지 "지원은 하는데 다른 문제"인지 화면만 보고는 구분이 안 됐다.
    // 최소한 이유는 보이게 한다.
    return (
      <div
        style={{
          position: 'fixed',
          top: 16,
          right: 16,
          zIndex: 1000,
          opacity: cameraActive ? 0.22 : 1,
          // [momi 버튼이 무게 다이얼을 가림 2026-08-19] GlobalVoiceCommand.jsx와
          // 동일한 이유 — 클릭 대상이 아닌 상태 표시등이라도 zIndex가 높으면
          // 여전히 아래 카메라 스테이지 컨트롤의 탭을 가로챈다.
          pointerEvents: cameraActive ? 'none' : 'auto',
          transition: 'opacity 0.3s',
          padding: '8px 12px',
          borderRadius: 8,
          background: 'rgba(0,0,0,0.85)',
          color: '#fbbf24',
          fontSize: 13,
          fontWeight: 500,
          maxWidth: 240,
        }}
      >
        이 브라우저는 음성인식(SpeechRecognition)을 지원하지 않아요.
      </div>
    );
  }

  const hasError = /권한|못 찾|연결|멈췄|문제/.test(feedback);
  const stageState = hasError ? 'error' : speaking ? 'speaking' : busy ? 'thinking' : 'listening';

  // [화면에서 사라지는 모미 2026-09c] 평소엔 정말로 아무것도 그리지 않는다 —
  // 상시 감지 표시등(오브)도, 코너 HUD도 없앴다. "모미야"로 부른 순간에만
  // 전체화면 음성인식 그래프가 그라데이션으로 떠오르고, 명령이 끝나면 사라진다.
  if (!stagePhase) return null;

  return (
    <MomiVoiceStage
      phase={stagePhase}
      state={stageState}
      text={feedback || (interimText ? `“${interimText}”` : '')}
      confidence={confidence}
      level={micLevel}
      bands={bands}
    />
  );
}
